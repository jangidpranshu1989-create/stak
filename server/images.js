// Site assets: user photo uploads + real, free-licensed photos resolved from Wikimedia Commons.
//
// The build prompt tells the model to write  <img src="photo:cozy cafe interior with wooden tables" alt="…">
// (or CSS url("photo:…")). After the build we search Wikimedia Commons (no key needed), download a
// right-sized thumbnail, store it as a project asset (assets/img/<slug>.jpg) and rewrite the reference.
// No more broken/fake Unsplash URLs; images are stable, cached and shipped inside the ZIP export.
const { db, rid } = require("./db");

const UA = "StakBuilder/3.0 (https://github.com/jangidpranshu1989-create/stak; photo resolver)";
const MAX_PHOTOS = Number(process.env.STAK_PHOTOS_PER_BUILD) || 10;

const getAsset = (pid, p) => db.prepare("SELECT * FROM assets WHERE project_id=? AND path=?").get(pid, p);
const listAssets = (pid) => db.prepare("SELECT path,mime,kind,prompt,length(data) size,created FROM assets WHERE project_id=? ORDER BY created").all(pid);
function putAsset(pid, p, mime, data, kind, prompt = "") {
  db.prepare("INSERT INTO assets(project_id,path,mime,data,kind,prompt,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,path) DO UPDATE SET mime=excluded.mime,data=excluded.data,kind=excluded.kind,prompt=excluded.prompt,created=excluded.created")
    .run(pid, p, mime, data, kind, String(prompt).slice(0, 300), Date.now());
}

function placeholderSvg(p) {
  const seed = [...String(p)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const h = seed % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},28%,82%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},30%,68%)"/></linearGradient></defs><rect width="1600" height="1200" fill="url(#g)"/></svg>`;
}

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

// ---------------------------------------------------------------- photo: resolver
const sniff = (b) => (b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b.slice(8, 12).toString() === "WEBP" ? "image/webp" : null);
const slug = (q) => String(q).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "photo";
const STOP = /^(a|an|the|and|with|for|of|in|on|at|to|photo|photograph|image|picture|shot|style|soft|light|natural|ultra|realistic|professional|sharp|focus|warm|cinematic|detailed|high|quality|beautiful|modern|stunning|hero|background)$/;
const words = (q) => String(q).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.test(w));

async function commonsSearch(query, width) {
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    action: "query", generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "8",
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(width), format: "json", origin: "*",
  });
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) return [];
  const j = await r.json();
  const pages = Object.values(j?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.map((p) => ({ title: p.title, info: p.imageinfo?.[0] })).filter((x) => x.info && /jpe?g|png|webp/i.test(x.info.mime || "") && x.info.thumburl && x.info.width >= 900)
    .map((x) => ({
      title: x.title, url: x.info.thumburl, w: x.info.width, h: x.info.height,
      license: x.info.extmetadata?.LicenseShortName?.value || "", author: String(x.info.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").trim().slice(0, 80),
      page: x.info.descriptionurl,
    }));
}

async function findPhoto(query, { landscape = true } = {}) {
  const w = words(query);
  const tries = [w.slice(0, 5).join(" "), w.slice(0, 3).join(" "), w.slice(0, 2).join(" ")].filter((x, i, a) => x && a.indexOf(x) === i);
  for (const q of tries) {
    let list = [];
    try { list = await commonsSearch(q, 1400); } catch { list = []; }
    if (!list.length) continue;
    const ok = list.filter((x) => !/(logo|map|diagram|chart|flag|coat of arms|icon|svg|screenshot|poster)/i.test(x.title));
    const pick = (landscape ? ok.find((x) => x.w >= x.h * 1.15) : null) || ok[0];
    if (pick) return pick;
  }
  return null;
}

async function download(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("download " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) throw new Error("too large");
  const mime = sniff(buf);
  if (!mime) throw new Error("not an image");
  return { buf, mime };
}

const PHOTO_RE = /(["'(])photo:([^"')<>\n]{3,140})(["')])/g;
function photoRefs(files) {
  const set = new Map();
  for (const [p, c] of Object.entries(files)) {
    if (!/\.(html?|css|js)$/.test(p)) continue;
    for (const m of String(c).matchAll(PHOTO_RE)) set.set(m[2].trim(), true);
  }
  return [...set.keys()];
}

// resolve every photo:<query> reference in the project. Returns { files, resolved, credits }
async function resolvePhotos(pid, files, { onProgress = () => {}, signal } = {}) {
  const queries = photoRefs(files).slice(0, MAX_PHOTOS * 2);
  if (!queries.length) return { files, resolved: 0, credits: [] };
  const map = new Map(), credits = [];
  let done = 0;
  const work = queries.slice(0, MAX_PHOTOS);
  const run = async (q) => {
    if (signal?.aborted) return;
    const path = `assets/img/${slug(q)}.jpg`;
    const cached = getAsset(pid, path);
    if (cached) { map.set(q, path); return; }
    try {
      const hit = await findPhoto(q);
      if (hit) {
        const { buf, mime } = await download(hit.url);
        const real = path.replace(/\.jpg$/, mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg");
        putAsset(pid, real, mime, buf, "photo", `${q} | ${hit.title} | ${hit.license} | ${hit.author} | ${hit.page}`);
        map.set(q, real);
        credits.push({ query: q, title: hit.title.replace(/^File:/, ""), license: hit.license, author: hit.author, page: hit.page });
      }
    } catch (e) { console.warn("[photos]", q, e.message); }
    finally { onProgress(++done, work.length); }
  };
  for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map(run));
  const out = {};
  for (const [p, c] of Object.entries(files)) {
    if (!/\.(html?|css|js)$/.test(p)) { out[p] = c; continue; }
    const prefix = p.endsWith(".css") && p.includes("/") ? "../" : "";
    out[p] = String(c).replace(PHOTO_RE, (all, a, q, b) => {
      const hit = map.get(q.trim());
      return `${a}${hit ? prefix + hit : `${prefix}assets/img/${slug(q)}.svg`}${b}`;
    });
  }
  return { files: out, resolved: map.size, credits };
}

module.exports = { getAsset, listAssets, putAsset, placeholderSvg, saveUpload, resolvePhotos, photoRefs, findPhoto };
