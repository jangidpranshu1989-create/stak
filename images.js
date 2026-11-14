// Site images: user uploads + AI-generated photos.
// Provider chain: NVIDIA FLUX (flux-3-image-klein → flux.1-dev → flux.1-schnell) → any OpenAI-compatible /images/generations
// → Perplexity SDK (sandbox only) → Pexels/Unsplash search (only if keys set) → soft placeholder.
// Assets live in the `assets` table and are served at /api/site/:id/assets/... and /api/rt/:id/assets/...
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { db, rid } = require("./db");

const CFG = require("./config");
const MAX_AI_IMAGES = CFG.imagesPerBuild; // per build/edit (default 16)
const CONCURRENCY = 4;
const ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3"];

const getAsset = (pid, p) => db.prepare("SELECT * FROM assets WHERE project_id=? AND path=?").get(pid, p);
const listAssets = (pid) => db.prepare("SELECT path,mime,kind,prompt,length(data) size,created FROM assets WHERE project_id=? ORDER BY created").all(pid);
function putAsset(pid, p, mime, data, kind, prompt = "") {
  db.prepare(`INSERT INTO assets(project_id,path,mime,data,kind,prompt,created) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(project_id,path) DO UPDATE SET mime=excluded.mime,data=excluded.data,kind=excluded.kind,prompt=excluded.prompt,created=excluded.created`)
    .run(pid, p, mime, data, kind, prompt, Date.now());
}

// shown while an AI image is still being generated (or if generation failed)
function placeholderSvg(p) {
  const seed = [...String(p)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const h = seed % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},28%,82%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},30%,68%)"/></linearGradient></defs><rect width="1600" height="1200" fill="url(#g)"/></svg>`;
}

// <stak-image path="assets/img/hero.jpg" aspect="16:9">prompt</stak-image>  (attribute order free, prompt may also be in prompt="")
function parseImageSpecs(text) {
  const out = [];
  const seen = new Set();
  const re = /<stak-image\b([^>]*?)(?:\/>|>([\s\S]*?)<\/stak-image>)/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const attr = (n) => (m[1].match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`)) || [])[1] || "";
    let p = (attr("path") || attr("src")).trim().replace(/^\.?\//, "");
    const prompt = (m[2] || attr("prompt") || attr("alt")).trim();
    if (!/^assets\/img\/[\w\-]+(?:\/[\w\-]+)*\.(jpe?g|png|webp)$/i.test(p) || seen.has(p) || !prompt) continue;
    seen.add(p);
    const aspect = attr("aspect") || attr("ratio");
    out.push({ path: p, aspect: ASPECTS.includes(aspect) ? aspect : /hero|banner|cover/i.test(p) ? "16:9" : "4:3", prompt: prompt.slice(0, 1200) });
  }
  return out.slice(0, MAX_AI_IMAGES);
}

// safety net: images referenced in files (assets/img/*) without a declaration get a prompt from alt text + project context
function inferImageSpecs(files, declared, project) {
  const have = new Set(declared.map((d) => d.path));
  const out = [];
  const all = Object.entries(files).filter(([k]) => /\.(html?|css|js)$/.test(k));
  const refs = new Set();
  for (const [, c] of all) for (const m of c.matchAll(/assets\/img\/[\w\-]+(?:\/[\w\-]+)*\.(?:jpe?g|png|webp)/gi)) refs.add(m[0]);
  for (const p of refs) {
    if (have.has(p) || (project.id && getAsset(project.id, p))) continue;
    let alt = "";
    for (const [, c] of all) {
      const esc = p.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const tag = c.match(new RegExp(`<img\\b[^>]*${esc}[^>]*>`, "i"));
      const a = tag && tag[0].match(/\balt=["']([^"']{3,})["']/i);
      if (a) { alt = a[1]; break; }
    }
    const slug = p.split("/").pop().replace(/\.\w+$/, "").replace(/[-_]+/g, " ");
    out.push({
      path: p, aspect: /hero|banner|cover/i.test(p) ? "16:9" : "4:3",
      prompt: `${alt || slug}. Context: ${scenePrompt(`${project.title || ""} — ${String(project.prompt || "").slice(0, 300)}`)}`,
    });
  }
  return [...declared, ...out].slice(0, MAX_AI_IMAGES);
}
const stripImageSpecs = (t) => String(t).replace(/<stak-image\b[\s\S]*?<\/stak-image>\s*/g, "");

function runPy(req, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const ch = spawn("python3", [path.join(__dirname, "imagegen.py")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const t = setTimeout(() => { ch.kill("SIGKILL"); resolve({ ok: false, error: "timeout" }); }, timeoutMs);
    ch.stdout.on("data", (d) => (out += d));
    ch.on("error", (e) => { clearTimeout(t); resolve({ ok: false, error: e.message }); });
    ch.on("close", () => { clearTimeout(t); try { resolve(JSON.parse(out.trim().split("\n").pop())); } catch { resolve({ ok: false, error: "bad output" }); } });
    ch.stdin.end(JSON.stringify(req));
  });
}

const STYLE = "A single real-world photograph taken with a professional camera (35mm or 85mm lens), ultra realistic, natural light, sharp focus, true-to-life colour, editorial quality. Absolutely NOT a website, screenshot, user interface, mockup, device screen, poster, collage or graphic design. No text, no letters, no watermark, no logos, no borders.";
// Image models take "website"/"portfolio site" literally and draw screenshots — keep only the subject.
function scenePrompt(s) {
  return String(s || "")
    .replace(/\b(responsive |modern |beautiful |simple |full[- ]stack |single[- ]page |one[- ]page )?(web ?sites?|web ?apps?|landing ?pages?|web ?pages?|home ?pages?|sites?|pwa|apps?|dashboards?|ui|ux|admin panels?|booking forms?|contact forms?|forms?|sections?|navbar|footer|cta)\b/gi, " ")
    .replace(/\b(with|and|for|of)\s+(?=[,.;]|$)/gi, " ")
    .replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
}
// FLUX-friendly sizes (multiples of 64, ~1 MP)
const SIZES = { "16:9": [1344, 768], "4:3": [1152, 864], "1:1": [1024, 1024], "3:4": [864, 1152], "9:16": [768, 1344], "3:2": [1216, 832], "2:3": [832, 1216] };
const OPENAI_SIZES = { "16:9": "1536x1024", "3:2": "1536x1024", "4:3": "1536x1024", "1:1": "1024x1024", "3:4": "1024x1536", "2:3": "1024x1536", "9:16": "1024x1536" };
const sniff = (b) => b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b.slice(8, 12).toString() === "WEBP" ? "image/webp" : "image/jpeg";
const timeoutFetch = (url, opts, ms) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms); return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t)); };
const authH = (p) => (p.proxyKey ? { "x-api-key": p.proxyKey } : { Authorization: `Bearer ${p.apiKey}` });

// --- providers: each returns a Buffer or throws ---
async function viaNvidia(model, prompt, aspect) {
  const p = CFG.images.nvidia; const [width, height] = SIZES[aspect] || SIZES["4:3"];
  const body = { prompt: prompt.slice(0, 2000), width, height, seed: 0, steps: /schnell/.test(model) ? 4 : /klein/.test(model) ? 28 : 30 };
  if (/flux\.1-dev/.test(model)) { body.mode = "base"; body.cfg_scale = 3.5; }
  const r = await timeoutFetch(`${p.baseUrl}/${model}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...authH(p) }, body: JSON.stringify(body) }, 90000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.detail || j.title || j.message || ""}`.trim());
  const a = (j.artifacts || j.data || [])[0];
  if (!a || (a.finishReason && a.finishReason !== "SUCCESS")) throw new Error(a?.finishReason === "CONTENT_FILTERED" ? "filtered" : "no image");
  return Buffer.from(a.base64 || a.b64_json, "base64");
}
async function viaOpenAI(prompt, aspect) {
  const p = CFG.images.openai;
  const r = await timeoutFetch(`${p.baseUrl}/images/generations`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` }, body: JSON.stringify({ model: p.model, prompt: prompt.slice(0, 3000), n: 1, size: OPENAI_SIZES[aspect] || "1024x1024", response_format: /gpt-image/.test(p.model) ? undefined : "b64_json" }) }, 120000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ""}`);
  const d = (j.data || [])[0] || {};
  if (d.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d.url) { const x = await timeoutFetch(d.url, {}, 30000); return Buffer.from(await x.arrayBuffer()); }
  throw new Error("no image");
}
async function viaPplx(model, prompt, aspect) {
  const tmp = path.join(os.tmpdir(), `stak-img-${rid(8)}.jpg`);
  const r = await runPy({ prompt, aspect, model, out: tmp, maxw: 1600 });
  if (!r.ok || !fs.existsSync(tmp)) throw new Error(r.error || "failed");
  const buf = fs.readFileSync(tmp); fs.unlink(tmp, () => {}); return buf;
}
// curated real photos (only when a stock key is configured) — relevant search, never random
const keywords = (s) => String(s).toLowerCase().replace(/photograph for[\s\S]*$/, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|with|for|photo|photograph|image|picture|shot|style|soft|light|natural|ultra|realistic|professional|sharp|focus|warm|cinematic|detailed|high|quality)$/.test(w)).slice(0, 6).join(" ");
async function viaPexels(prompt, aspect) {
  const q = keywords(prompt); if (!q) throw new Error("no query");
  const orient = /16:9|3:2|4:3/.test(aspect) ? "landscape" : /9:16|2:3|3:4/.test(aspect) ? "portrait" : "square";
  const r = await timeoutFetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1&orientation=${orient}`, { headers: { Authorization: CFG.images.pexels.apiKey } }, 15000);
  const j = await r.json(); const ph = j.photos?.[0]; if (!ph) throw new Error("no match");
  const x = await timeoutFetch(ph.src.large2x || ph.src.large, {}, 30000); return Buffer.from(await x.arrayBuffer());
}
async function viaUnsplash(prompt, aspect) {
  const q = keywords(prompt); if (!q) throw new Error("no query");
  const orient = /16:9|3:2|4:3/.test(aspect) ? "landscape" : /9:16|2:3|3:4/.test(aspect) ? "portrait" : "squarish";
  const r = await timeoutFetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=1&orientation=${orient}`, { headers: { Authorization: `Client-ID ${CFG.images.unsplash.apiKey}` } }, 15000);
  const j = await r.json(); const ph = j.results?.[0]; if (!ph) throw new Error("no match");
  const x = await timeoutFetch(`${ph.urls.raw}&w=1600&q=82&fm=jpg`, {}, 30000); return Buffer.from(await x.arrayBuffer());
}
function providerChain() {
  const c = [];
  if (CFG.images.nvidia) for (const m of CFG.images.nvidia.models) c.push({ name: `nvidia:${m}`, run: (p, a) => viaNvidia(m, p, a) });
  if (CFG.images.openai) c.push({ name: `openai:${CFG.images.openai.model}`, run: viaOpenAI });
  if (CFG.images.pplx) for (const m of CFG.images.pplx.models) c.push({ name: `pplx:${m}`, run: (p, a) => viaPplx(m, p, a) });
  if (CFG.images.pexels) c.push({ name: "pexels", run: viaPexels, stock: true });
  if (CFG.images.unsplash) c.push({ name: "unsplash", run: viaUnsplash, stock: true });
  return c;
}
const imageCooldown = new Map();
const available = () => providerChain().length > 0;

async function generateOne(pid, spec) {
  let last = "no image provider configured";
  for (const pr of providerChain()) {
    if ((imageCooldown.get(pr.name) || 0) > Date.now()) continue;
    try {
      const prompt = pr.stock ? scenePrompt(spec.prompt) : `${scenePrompt(spec.prompt)}\n\n${STYLE}`;
      let buf;
      try { buf = await pr.run(prompt, spec.aspect); }
      catch (e) { if (/filtered|429|5\d\d|timeout|abort/i.test(e.message) && !pr.stock) buf = await pr.run(prompt + " Tasteful, family-friendly.", spec.aspect); else throw e; }
      if (!buf || buf.length < 2000) throw new Error("empty image");
      putAsset(pid, spec.path, sniff(buf), buf, "ai", spec.prompt);
      return pr.name;
    } catch (e) {
      last = `${pr.name}: ${e.message}`;
      if (/^(401|403|404)/.test(e.message)) imageCooldown.set(pr.name, Date.now() + 10 * 60e3);
    }
  }
  console.warn("[images] failed", spec.path, last);
  return null;
}

// generates the images that are new or whose prompt changed. onProgress(done,total)
async function generateImages(pid, specs, onProgress = () => {}) {
  const todo = specs.filter((s) => { const a = getAsset(pid, s.path); return !a || a.kind !== "ai" || a.prompt !== s.prompt; });
  let done = 0, ok = 0, i = 0; const usedBy = {};
  onProgress(0, todo.length);
  const worker = async () => {
    while (i < todo.length) {
      const s = todo[i++];
      const by = await generateOne(pid, s);
      if (by) { ok++; usedBy[by] = (usedBy[by] || 0) + 1; }
      onProgress(++done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { generated: ok, failed: todo.length - ok, total: specs.length, usedBy };
}

// user uploads -------------------------------------------------------------
const UPLOAD_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
function saveUpload(pid, name, dataUrl) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!m || !UPLOAD_TYPES[m[1]]) return { error: "Only JPG, PNG, WebP, GIF or AVIF images are supported" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 6 * 1024 * 1024) return { error: "Image is too large (max 6 MB)" };
  const count = db.prepare("SELECT COUNT(*) c FROM assets WHERE project_id=? AND kind='upload'").get(pid).c;
  if (count >= 60) return { error: "Upload limit reached for this project (60 images)" };
  const base = String(name || "photo").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "photo";
  const p = `assets/uploads/${base}-${rid(5).toLowerCase()}.${UPLOAD_TYPES[m[1]]}`;
  putAsset(pid, p, m[1], buf, "upload", String(name || "").slice(0, 120));
  return { path: p, size: buf.length };
}

// Models sometimes hot-link random stock/placeholder images. Replace them with local AI images
// (assets/img/auto-N.jpg) so every photo is on-brand, relevant and owned by the site.
const STOCK_RE = /https?:\/\/(?:images\.unsplash\.com|source\.unsplash\.com|unsplash\.com\/photos|picsum\.photos|placehold\.co|placehold\.it|via\.placeholder\.com|placekitten\.com|loremflickr\.com|dummyimage\.com|images\.pexels\.com|fakeimg\.pl|placeimg\.com|lorempixel\.com|cdn\.pixabay\.com|pixabay\.com\/get|i\.pravatar\.cc|randomuser\.me\/api\/portraits)[^"'\s)<>]*/gi;
function externalizeStock(files, project) {
  const map = new Map(); const specs = []; let n = 0;
  const used = new Set(Object.values(files).join("\n").match(/assets\/img\/auto-\d+\.jpg/g) || []);
  const next = () => { let p; do { p = `assets/img/auto-${++n}.jpg`; } while (used.has(p)); used.add(p); return p; };
  const out = {};
  for (const [f, c] of Object.entries(files)) {
    if (!/\.(html?|css|js|json)$/i.test(f)) { out[f] = c; continue; }
    out[f] = c.replace(STOCK_RE, (url, off, whole) => {
      if (map.has(url)) return map.get(url);
      const p = next(); map.set(url, p);
      const near = whole.slice(Math.max(0, off - 400), off + url.length + 300);
      const ts = whole.lastIndexOf("<", off), te = whole.indexOf(">", off);
      const tag = ts >= 0 && te > off && !whole.slice(ts, off).includes(">") ? whole.slice(ts, te + 1) : "";
      const alt = (tag.match(/\balt=["']([^"']{3,140})["']/i) || tag.match(/\baria-label=["']([^"']{3,140})["']/i) || [])[1] || "";
      const avatar = /pravatar|randomuser|avatar|portrait|testimonial/i.test(url + near);
      const q = decodeURIComponent((url.match(/[?&](?:q|query|text)=([^&]+)/) || url.match(/loremflickr\.com\/\d+\/\d+\/([^/?]+)/) || [])[1] || "").replace(/[+,]/g, " ");
      specs.push({ path: p, aspect: avatar ? "1:1" : /hero|banner|cover/i.test(near) ? "16:9" : "4:3", prompt: `${alt || q || (avatar ? "Friendly natural headshot portrait of a happy customer" : "Beautiful photo")}. Context: ${scenePrompt(`${project.title || ""} — ${String(project.prompt || "").slice(0, 240)}`)}` });
      return p;
    });
  }
  return { files: out, specs };
}

module.exports = { scenePrompt, getAsset, listAssets, putAsset, placeholderSvg, parseImageSpecs, inferImageSpecs, stripImageSpecs, generateImages, saveUpload, MAX_AI_IMAGES, available, providerChain, externalizeStock };
