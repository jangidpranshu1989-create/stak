// Site assets: user photo uploads (assets/uploads/*) + relevant real photos by keyword (/api/img?q=...).
// No image generation: photos come from openly-licensed libraries (Openverse → Wikimedia Commons / rawpixel …),
// resolved once per query and cached, with a soft gradient placeholder as the fallback.
const { db, rid, kvGet, kvSet } = require("./db");

const getAsset = (pid, p) => db.get("SELECT * FROM assets WHERE project_id=? AND path=?", pid, p);
const listAssets = (pid) => db.all("SELECT path,mime,kind,prompt,created FROM assets WHERE project_id=? ORDER BY created", pid);
async function putAsset(pid, p, mime, data, kind, prompt = "") {
  await db.run(`INSERT INTO assets(project_id,path,mime,data,kind,prompt,created) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(project_id,path) DO UPDATE SET mime=excluded.mime,data=excluded.data,kind=excluded.kind,prompt=excluded.prompt,created=excluded.created`,
  pid, p, mime, data, kind, prompt, Date.now());
}

function placeholderSvg(seedText, w = 1600, h = 1000, label = "") {
  const seed = [...String(seedText)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const hue = seed % 360;
  const t = String(label || "").replace(/[<&>"]/g, "").slice(0, 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,72%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},50%,46%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${t ? `<text x="50%" y="52%" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${Math.round(Math.min(w, h) / 14)}" fill="rgba(255,255,255,.85)">${t}</text>` : ""}</svg>`;
}

// ---- keyword photos --------------------------------------------------------
const thumbOf = (u, w) => {
  // Wikimedia originals are huge; use the thumbnail service
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/.exec(u);
  if (m && !/\.(svg|tiff?|pdf|webm|ogv)$/i.test(m[3])) return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${m[3]}/${Math.min(1600, Math.max(320, w))}px-${m[3]}`;
  return u;
};
const inflight = new Map();
const UA = "StakBuilder/4.0 (https://github.com/jangidpranshu1989-create/stak)";
// Wikimedia Commons search — reliable free fallback (real photos, CC licensed)
async function commons(query, aspect, w) {
  try {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query + " filetype:bitmap")}&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=${Math.min(1600, Math.max(320, w))}&format=json&origin=*`;
    const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const pages = Object.values(j?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const ok = pages.map((p) => p.imageinfo?.[0]).filter((ii) => ii && ii.mime === "image/jpeg" && ii.width >= 640 && ii.thumburl);
    const fit = ok.filter((ii) => { const r = ii.width / ii.height; return aspect === "wide" ? r > 1.2 : aspect === "tall" ? r < 0.9 : r > 0.75 && r < 1.4; });
    return (fit.length >= 2 ? fit : ok).map((ii) => ii.thumburl);
  } catch (e) { console.warn("[img] commons", query, e.message); return []; }
}

async function photoFor(q, w = 1200, h = 800, n = 0) {
  const query = String(q || "").toLowerCase().replace(/[^\p{L}\p{N} ,-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!query) return null;
  const aspect = w / Math.max(1, h) > 1.25 ? "wide" : w / Math.max(1, h) < 0.8 ? "tall" : "square";
  const key = `img:${aspect}:${query}`;
  let list = null;
  const cached = await kvGet(key).catch(() => null);
  if (cached) { try { list = JSON.parse(cached); } catch {} }
  if (!list) {
    if (!inflight.has(key)) inflight.set(key, (async () => {
      const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=12&license_type=commercial&mature=false&aspect_ratio=${aspect}&size=large,medium`;
      let out = [];
      try {
      try {
        const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
        const j = await r.json();
        out = (j.results || []).filter((x) => x.url && /^https:\/\//.test(x.url) && !/\.(svg|gif|tiff?)$/i.test(x.url)).map((x) => x.url);
      } catch (e) { console.warn("[img] openverse", query, e.message); }
      // Commons is full of named public figures — never use it for people/portrait photos
      if (!out.length && !/\b(portrait|person|people|man|woman|men|women|girl|boy|face|avatar|team|customer|client|doctor|teacher|trainer|chef|student|headshot)\b/.test(query)) out = await commons(query, aspect, w);
      if (out.length) await kvSet(key, JSON.stringify(out)).catch(() => {});
      return out;
      } finally { setTimeout(() => inflight.delete(key), 1000); }
    })());
    list = await inflight.get(key);
  }
  if (!list.length) {
    // too specific → retry with fewer keywords ("yoga meditation woman jaipur" → "yoga meditation" → "yoga")
    const words = query.split(" ");
    if (words.length > 1) return photoFor(words.slice(0, words.length > 2 ? 2 : 1).join(" "), w, h, n);
    return null;
  }
  return thumbOf(list[Math.abs(Number(n) || 0) % list.length], w);
}

// user uploads -------------------------------------------------------------
const UPLOAD_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
async function saveUpload(pid, name, dataUrl) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!m || !UPLOAD_TYPES[m[1]]) return { error: "Only JPG, PNG, WebP, GIF or AVIF images are supported" };
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 4 * 1024 * 1024) return { error: "Image is too large (max 4 MB)" };
  const count = Number((await db.get("SELECT COUNT(*) AS c FROM assets WHERE project_id=? AND kind='upload'", pid)).c);
  if (count >= 60) return { error: "Upload limit reached for this project (60 images)" };
  const base = String(name || "photo").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "photo";
  const p = `assets/uploads/${base}-${rid(5).toLowerCase()}.${UPLOAD_TYPES[m[1]]}`;
  await putAsset(pid, p, m[1], buf, "upload", String(name || "").slice(0, 120));
  return { path: p, size: buf.length };
}

function providerChain() { return ["openverse"]; }

module.exports = { getAsset, listAssets, putAsset, placeholderSvg, saveUpload, photoFor, providerChain };
