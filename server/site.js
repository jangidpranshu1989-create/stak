// Parsing model output, applying patches, verifying & auto-fixing generated sites
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const RUNTIME = {
  "stak.js": fs.readFileSync(path.join(__dirname, "runtime/stak.js"), "utf8"),
  "stak-motion.js": fs.readFileSync(path.join(__dirname, "runtime/stak-motion.js"), "utf8"),
  "stak-ui.css": fs.readFileSync(path.join(__dirname, "runtime/stak-ui.css"), "utf8"),
  "stak-ui.js": fs.readFileSync(path.join(__dirname, "runtime/stak-ui.js"), "utf8"),
};
// The UI kit is copied INTO the project as real files (so preview, download and deploy all work
// without frontend changes). It is always refreshed from the server copy and never sent to the model.
const KIT = ["stak-ui.css", "stak-ui.js"];
function withKit(files) {
  const out = { ...files };
  const all = Object.entries(out).filter(([k]) => !KIT.includes(k)).map(([, v]) => v).join("\n");
  for (const k of KIT) { if (all.includes(k)) out[k] = RUNTIME[k]; else delete out[k]; }
  return out;
}

const cleanFile = (s) => {
  let t = String(s || "");
  t = t.replace(/^\s*```[\w-]*\s*\n/, "").replace(/\n```\s*$/, "");
  return t.replace(/^\n+/, "").replace(/\s+$/, "") + "\n";
};
const safePath = (p) => /^[\w\-./]+$/.test(p) && !p.includes("..") && !p.startsWith("/") && p.length < 80;

function parseFiles(text) {
  const files = {};
  const re = /<stak-file path="([^"]+)">\n?([\s\S]*?)<\/stak-file>/g;
  let m;
  while ((m = re.exec(text))) if (safePath(m[1])) files[m[1]] = cleanFile(m[2]);
  return files;
}
function parsePatches(text) {
  const out = [];
  const re = /<stak-patch path="([^"]+)">\n?([\s\S]*?)<\/stak-patch>/g;
  let m;
  while ((m = re.exec(text))) {
    const blocks = [];
    const br = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
    let b;
    while ((b = br.exec(m[2]))) blocks.push({ search: b[1], replace: b[2] });
    if (safePath(m[1])) out.push({ path: m[1], blocks });
  }
  return out;
}
function summaryOf(text) {
  const m = String(text).match(/<stak-summary>([\s\S]*?)(<\/stak-summary>|$)/);
  return m ? m[1].trim() : "";
}

// apply a SEARCH/REPLACE block with exact, then whitespace-tolerant matching
function applyBlock(src, { search, replace }) {
  if (!search.trim()) return { ok: false, src };
  if (src.includes(search)) return { ok: true, src: src.replace(search, () => replace) };
  const norm = (s) => s.split("\n").map((l) => l.trim()).join("\n");
  const lines = src.split("\n"), sl = search.split("\n").map((l) => l.trim());
  while (sl.length && !sl[0]) sl.shift();
  while (sl.length && !sl[sl.length - 1]) sl.pop();
  if (!sl.length) return { ok: false, src };
  for (let i = 0; i + sl.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < sl.length; j++) if (lines[i + j].trim() !== sl[j]) { ok = false; break; }
    if (ok) {
      const before = lines.slice(0, i), after = lines.slice(i + sl.length);
      return { ok: true, src: [...before, replace, ...after].join("\n") };
    }
  }
  void norm;
  return { ok: false, src };
}

const defaultLogo = (title) => {
  const ch = (String(title || "S").trim()[0] || "S").toUpperCase().replace(/[<&>"]/g, "S");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a45"/><stop offset="1" stop-color="#e2366b"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="32" font-weight="700" fill="#fff" text-anchor="middle">${ch}</text></svg>\n`;
};
// PWA manifest and service worker removed — they cause SecurityErrors in sandboxed preview iframes.
// Stak Cloud SDK (stak.db, stak.auth) provides all persistence; no Service Worker needed.

function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) if (!/\bsrc=/.test(m[1]) && !/type=["'](module|application\/ld\+json|importmap|text\/template)/i.test(m[1]) && m[2].trim()) out.push(m[2]);
  return out;
}
function syntaxError(code) {
  if (/^\s*(import|export)\s/m.test(code)) return null; // ES modules: skip
  try { new vm.Script(code); return null; } catch (e) { return e.message; }
}


// Runtime smoke test: run each classic script in a stubbed browser and catch real ReferenceErrors
// (typos, missing values like `{ price, ... }`, use-before-define) that a syntax check can't see.
let BROWSER_GLOBALS = new Set();
try { BROWSER_GLOBALS = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, "runtime/browser-globals.json"), "utf8"))); } catch {}
["stak", "ui", "STAK", "StakMotion", "lucide", "Chart", "L", "gsap", "ScrollTrigger", "AOS", "Swiper", "confetti", "dayjs", "marked", "DOMPurify", "anime", "THREE", "Alpine", "htmx", "d3", "luxon", "flatpickr", "Toastify",
  "QRCode", "QRious", "JsBarcode", "Html5Qrcode", "jsPDF", "jspdf", "html2canvas", "Papa", "XLSX", "JSZip", "saveAs", "Fuse", "Sortable", "Howl", "Howler", "Tone", "p5", "Phaser", "PIXI", "Matter", "katex", "hljs", "Prism", "mermaid", "echarts", "ApexCharts", "Plotly", "moment", "_", "axios", "io", "Peer", "Quill", "SignaturePad", "Cropper", "Tesseract", "CryptoJS", "bcrypt", "uuid", "nanoid", "emoji", "Typed", "Splide", "lottie", "Lenis", "Motion", "tsParticles", "particlesJS", "Granim", "Vivus", "zxcvbn", "math", "Decimal", "Big", "numeral", "Pickr", "iro", "chroma", "ColorThief", "Vibrant"].forEach((n) => BROWSER_GLOBALS.add(n));
// pages that load external libraries (CDN <script src>) may use globals we don't know; ignore PascalCase/ALLCAPS names then
const externalScripts = (files) => Object.entries(files).filter(([p]) => /\.html?$/.test(p)).some(([, c]) => /<script\b[^>]*src=["']https?:\/\//i.test(c));
const looksLibGlobal = (n) => /^[A-Z][A-Za-z0-9]*$/.test(n) || /^[A-Z0-9_]{2,}$/.test(n) || /^[a-z]{1,3}$/.test(n);
function declaredNames(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of src.matchAll(/\b(?:window|self|globalThis)\.([A-Za-z_$][\w$]*)\s*=/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bid=["']([A-Za-z_$][\w$]*)["']/g)) out.add(m[1]); // named-element globals
  return out;
}
const ACTIVE = new Map(); // context ReferenceError ctor -> report fn (attributes async rejections to the right check)
process.on("unhandledRejection", (e) => {
  for (const [Ctor, report] of ACTIVE) if (e instanceof Ctor) { report(e); return; }
  console.warn("[unhandledRejection]", e && e.message || e);
});
async function runtimeErrors(files) {
  const scripts = Object.entries(files).filter(([p, c]) => p.endsWith(".js") && p !== "sw.js" && !/^\s*(import|export)\s/m.test(c) && !syntaxError(c));
  if (!scripts.length) return [];
  const errs = [];
  for (const [p, c] of scripts) {
    // names from OTHER files (shared globals) + window.X assignments + element ids; same-file declarations are in scope already
    const others = Object.entries(files).filter(([q]) => q !== p).map(([, x]) => x).join("\n");
    const known = new Set([...BROWSER_GLOBALS, ...declaredNames(others)]);
    const ext = externalScripts(files);
    for (const m of c.matchAll(/\b(?:window|self|globalThis)\.([A-Za-z_$][\w$]*)\s*=/g)) known.add(m[1]);
    const cbs = [];
    const stub = new Proxy(function () {}, {
      get: (t, k) => k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === "length" ? 0 : k === Symbol.iterator ? function* () {} : (k === "addEventListener" || k === "on") ? (_, fn) => { if (typeof fn === "function") cbs.push(fn); } : k === "toString" ? () => "" : stub,
      apply: () => stub, construct: () => stub, has: () => true, set: () => true,
    });
    const sandbox = {};
    const ctx = vm.createContext(sandbox);
    const builtin = new Set(vm.runInContext("Object.getOwnPropertyNames(globalThis)", ctx));
    for (const n of BROWSER_GLOBALS) if (!builtin.has(n) && !n.startsWith("__")) sandbox[n] = stub;
    sandbox.window = sandbox.self = sandbox.globalThis_ = stub;
    const queue = (fn) => { if (typeof fn === "function") cbs.push(fn); return 1; };
    Object.assign(sandbox, { setTimeout: queue, setInterval: queue, requestAnimationFrame: queue, queueMicrotask: queue, requestIdleCallback: queue, __cbs: cbs, __stub: stub });
    const report = (e) => {
      const msg = String(e && e.message || e);
      const m = msg.match(/^([A-Za-z_$][\w$]*) is not defined$/);
      if (e && e.name === "ReferenceError" && (!m || (!known.has(m[1]) && !(ext && looksLibGlobal(m[1]))))) { errs.push({ file: p, problem: `JavaScript runtime error: ${msg} — define it or fix the typo/missing value` }); return true; }
      return false;
    };
    let hit = false;
    const once = (e) => { if (!hit && report(e)) hit = true; };
    sandbox.__rep = (e) => once(e);
    const RefErr = vm.runInContext("ReferenceError", ctx);
    ACTIVE.set(RefErr, once);
    try {
      try { vm.runInContext(c, ctx, { timeout: 800 }); } catch (e) { once(e); }
      // also call every top-level function directly (stubs make real call chains stop early)
      const fnNames = [...new Set([...c.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]))].slice(0, 80);
      if (!hit) for (const n of fnNames) { try { const f = vm.runInContext(`typeof ${n} === "function" ? ${n} : null`, ctx, { timeout: 200 }); if (f) cbs.push(f); } catch (e) { void e; } }
      for (let round = 0; round < 4 && !hit; round++) {
        try { vm.runInContext("for (let i = 0; i < __cbs.length && i < 80; i++) { const f = __cbs[i]; __cbs[i] = null; if (!f) continue; try { const r = f(__stub); if (r && typeof r.catch === 'function') r.catch(e => { if (e && e.name === 'ReferenceError') __rep(e); }); } catch (e) { if (e && e.name === 'ReferenceError') throw e; } }", ctx, { timeout: 1500 }); } catch (e) { once(e); }
        await new Promise((r) => setTimeout(r, 15));
      }
    } finally { ACTIVE.delete(RefErr); }
  }
  return errs;
}

// Elements the JS looks up by id that no HTML (or JS template) ever creates → "Cannot read properties of null"
function domRefIssues(files) {
  const html = Object.entries(files).filter(([p]) => /\.html?$/.test(p)).map(([, c]) => c).join("\n");
  const js = Object.entries(files).filter(([p]) => p.endsWith(".js") && !/^stak(-ui|-motion)?\.js$/.test(p)).map(([p, c]) => [p, c]);
  const all = html + "\n" + js.map(([, c]) => c).join("\n");
  const ids = new Set();
  for (const m of all.matchAll(/\bid\s*=\s*\\?["'`]([\w\-:.]+)\\?["'`]/g)) ids.add(m[1]);
  for (const m of all.matchAll(/\.id\s*=\s*["'`]([\w\-:.]+)["'`]/g)) ids.add(m[1]);
  for (const m of all.matchAll(/setAttribute\(\s*["']id["']\s*,\s*["'`]([\w\-:.]+)/g)) ids.add(m[1]);
  if (/\bid\s*=\s*["'`]?\$\{/.test(all)) return []; // ids built dynamically — can't judge statically
  const out = [];
  for (const [p, c] of js) {
    const missing = new Set();
    const re = /(?:getElementById\(\s*["']([\w\-:.]+)["']\s*\)|(?:querySelector|\$)\(\s*["']#([\w\-]+)["']\s*\))(\??\.)?/g;
    let m;
    while ((m = re.exec(c))) { const id = m[1] || m[2]; if (!ids.has(id)) missing.add(id); }
    if (missing.size) out.push({ file: p, problem: `JavaScript looks up element id(s) that don't exist in the HTML: ${[...missing].slice(0, 8).map((x) => "#" + x).join(", ")} — this throws "Cannot read properties of null" and breaks the whole script`, fix: "Add those elements to index.html with exactly these ids, or fix the ids in app.js; guard optional elements with ?.", kind: "dom" });
  }
  return out;
}

// verify + auto-fix. Returns { files, fixed, remaining:[{file,problem}], images }
function verify(files, title) {
  files = { ...files };
  let fixed = 0;
  const remaining = [];
  if (!files["index.html"]) return { files, fixed, remaining: [{ file: "index.html", problem: "index.html is missing" }], images: 0 };
  let html = files["index.html"];
  if (!/<html[\s>]/i.test(html)) { html = `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title || "App"}</title></head>\n<body>\n${html}\n</body>\n</html>\n`; fixed++; }
  if (!/<meta[^>]+name=["']viewport/i.test(html)) { html = html.replace(/<head([^>]*)>/i, `<head$1>\n<meta name="viewport" content="width=device-width, initial-scale=1">`); fixed++; }
  if (files["styles.css"] && !/href=["']\.?\/?styles\.css/i.test(html)) { html = html.replace(/<\/head>/i, `<link rel="stylesheet" href="styles.css">\n</head>`); fixed++; }
  const usesStak = (s) => /\bstak\.(auth|db|ai|fetch|files|secrets|ready|web)\b/.test(s || "");
  const anyStak = Object.entries(files).some(([p, c]) => (p.endsWith(".js") || p.endsWith(".html")) && p !== "sw.js" && usesStak(c));
  if (anyStak && !/src=["']\.?\/?stak\.js/i.test(html)) {
    if (/<script\b[^>]*src=["']\.?\/?app\.js/i.test(html)) html = html.replace(/<script\b[^>]*src=["']\.?\/?app\.js/i, (m) => `<script src="stak.js"></script>\n${m}`);
    else html = html.replace(/<\/head>/i, `<script src="stak.js"></script>\n</head>`);
    fixed++;
  }
  if (files["app.js"] && !/src=["']\.?\/?app\.js/i.test(html)) { html = html.replace(/<\/body>/i, `<script src="app.js" defer></script>\n</body>`); fixed++; }
  // Logo (required for favicon)
  if (!files["logo.svg"] || !/<svg[\s>]/i.test(files["logo.svg"])) { files["logo.svg"] = defaultLogo(title); fixed++; }
  // NO PWA: manifest.json and sw.js cause SecurityErrors in sandboxed preview iframes
  // The Stak Cloud SDK (stak.js) provides all persistence via stak.db, stak.auth — no Service Worker needed.
  if (!/rel=["'](shortcut )?icon/i.test(html)) { html = html.replace(/<\/head>/i, `<link rel="icon" href="logo.svg" type="image/svg+xml">\n</head>`); fixed++; }
  // CDN builds that only work in Node/bundlers (CommonJS "require is not defined" in browsers) → browser builds
  const CDN_FIX = [
    [/(highlight\.js@[\w.\-]+)\/lib\/(common|index|core)(\.min)?\.js/gi, "@highlightjs/cdn-assets@11.9.0/highlight.min.js"],
    [/npm\/marked@([\w.\-]+)\/lib\/marked\.cjs/gi, "npm/marked@$1/marked.min.js"],
  ];
  for (const [re, to] of CDN_FIX) { const n = html.replace(re, to); if (n !== html) { html = n; fixed++; } }
  html = html.replace(/<script\b([^>]*)src=["']https?:\/\/[^"']*\/dist\/[^"']*\.(?:cjs|esm|mjs)\.js["'][^>]*>\s*<\/script>/gi, (m) => (fixed++, `<!-- removed non-browser build: ${m.replace(/--/g, "")} -->`));
  files["index.html"] = html;
  // JS syntax
  for (const [p, c] of Object.entries(files)) {
    if (!p.endsWith(".js")) continue;
    const err = syntaxError(c);
    if (err) remaining.push({ file: p, problem: `JavaScript syntax error: ${err}` });
  }
  for (const [p, c] of Object.entries(files)) {
    if (!/\.html?$/.test(p)) continue;
    inlineScripts(c).forEach((s) => { const err = syntaxError(s); if (err) remaining.push({ file: p, problem: `Inline <script> syntax error: ${err}` }); });
    // internal page links
    const re = /href=["']\.?\/?([\w\-/]+\.html)(#[^"']*)?["']/gi;
    let m;
    let html2 = c, linkFixed = 0;
    while ((m = re.exec(c))) if (!files[m[1]] && !files[m[1].replace(/^\//, "")]) { html2 = html2.split(m[0]).join(`href="${m[2] || "#"}"`); linkFixed++; }
    if (linkFixed) { files[p] = html2; fixed += linkFixed; }
    if (/<\/html>/i.test(c) === false && p === "index.html") remaining.push({ file: p, problem: "HTML document looks truncated (no closing </html>)" });
  }
  const css = files["styles.css"];
  if (css) { const o = (css.match(/{/g) || []).length, cl = (css.match(/}/g) || []).length; if (o !== cl) remaining.push({ file: "styles.css", problem: `Unbalanced braces in CSS ({=${o}, }=${cl}) — file may be truncated` }); }
  const images = Object.entries(files).filter(([p]) => /\.html?$/.test(p)).reduce((n, [, c]) => n + (c.match(/<img\b/gi) || []).length, 0);
  // dedupe
  const seen = new Set();
  const rem = remaining.filter((r) => { const k = r.file + r.problem; if (seen.has(k)) return false; seen.add(k); return true; });
  return { files, fixed, remaining: rem, images };
}

const MIME = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", svg: "image/svg+xml", webmanifest: "application/manifest+json", txt: "text/plain; charset=utf-8",
};
const mimeOf = (p) => MIME[(p.split(".").pop() || "").toLowerCase()] || "application/octet-stream";


// Served sites run as an opaque (sandboxed) origin. Give them working storage (persisted in window.name),
// a no-op service worker and cookie stubs so normal app code never crashes.
const SANDBOX_SHIM = `<script>(function(){function mk(ns){var d={};try{d=(JSON.parse(window.name||"{}")||{})[ns]||{}}catch(_){}function sv(){try{var a={};try{a=JSON.parse(window.name||"{}")||{}}catch(_){}a[ns]=d;window.name=JSON.stringify(a)}catch(_){}}return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v);sv()},removeItem:function(k){delete d[k];sv()},clear:function(){d={};sv()},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
try{window.localStorage.getItem("x")}catch(e){try{Object.defineProperty(window,"localStorage",{value:mk("ls"),configurable:true})}catch(_){}}
try{window.sessionStorage.getItem("x")}catch(e){try{Object.defineProperty(window,"sessionStorage",{value:mk("ss"),configurable:true})}catch(_){}}
try{navigator.serviceWorker}catch(e){try{var sw={register:function(){return Promise.resolve({unregister:function(){return Promise.resolve(true)}})},getRegistrations:function(){return Promise.resolve([])},getRegistration:function(){return Promise.resolve(undefined)},ready:new Promise(function(){}),controller:null,addEventListener:function(){},removeEventListener:function(){}};Object.defineProperty(Navigator.prototype,"serviceWorker",{get:function(){return sw},configurable:true})}catch(_){}}
try{document.cookie}catch(e){try{Object.defineProperty(Document.prototype,"cookie",{get:function(){return""},set:function(){},configurable:true})}catch(_){}}})();</script>`;
function withShim(html) {
  if (html.includes("Object.defineProperty(window,\"localStorage\"")) return html;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, (m) => `${m}\n${SANDBOX_SHIM}`) : SANDBOX_SHIM + html;
}

// injected only into /api/site HTML: lets the Stak editor pick elements (visual edit) and see runtime errors.
// Inert unless the page is framed AND the parent asks for it.
const PREVIEW_AGENT = `<script>(function(){if(window.parent===window)return;var P=window.parent,on=false,box=null,last=null;
function post(m){try{P.postMessage(m,'*')}catch(_){}}
window.addEventListener('error',function(e){post({__stak:'error',message:String(e.message||'Error'),source:String(e.filename||'').split('/').pop(),line:e.lineno||0})});
window.addEventListener('unhandledrejection',function(e){var r=e.reason;post({__stak:'error',message:String(r&&r.message||r||'Unhandled promise rejection')})});
function sel(el){var parts=[];while(el&&el.nodeType===1&&parts.length<5&&el!==document.body){var s=el.tagName.toLowerCase();if(el.id){parts.unshift(s+'#'+el.id);break}var c=(el.className&&typeof el.className==='string')?el.className.trim().split(/\\s+/).slice(0,2).join('.'):'';if(c)s+='.'+c;var p=el.parentElement;if(p){var same=[].filter.call(p.children,function(x){return x.tagName===el.tagName});if(same.length>1)s+=':nth-of-type('+(same.indexOf(el)+1)+')'}parts.unshift(s);el=p}return parts.join(' > ')}
function ensure(){if(box)return box;box=document.createElement('div');box.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #f26b1d;background:rgba(242,107,29,.08);border-radius:4px;transition:all .06s;display:none';document.documentElement.appendChild(box);return box}
function over(e){if(!on)return;var t=e.target;if(!t||t===box)return;last=t;var r=t.getBoundingClientRect(),b=ensure();b.style.display='block';b.style.left=r.left+'px';b.style.top=r.top+'px';b.style.width=r.width+'px';b.style.height=r.height+'px'}
function click(e){if(!on)return;e.preventDefault();e.stopPropagation();var t=last||e.target;var label=(t.getAttribute('aria-label')||t.textContent||t.tagName).trim().replace(/\\s+/g,' ').slice(0,60);post({__stak:'select',selector:sel(t),html:t.outerHTML.slice(0,2400),label:label||t.tagName.toLowerCase()});}
document.addEventListener('mouseover',over,true);document.addEventListener('click',click,true);
window.addEventListener('message',function(e){var d=e.data||{};if(e.source!==P)return;if(d.__stak==='pick'){on=!!d.on;if(!on&&box)box.style.display='none';document.documentElement.style.cursor=on?'crosshair':''}});
})();</script>`;
function withPreviewAgent(html) { return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, (m) => `${m}\n${PREVIEW_AGENT}`) : PREVIEW_AGENT + html; }

// for exported sites: tell the SDK where its backend lives
function withConfig(html, projectId, api) {
  if (!api) return html;
  const tag = `<script>window.STAK=${JSON.stringify({ project: projectId, api }).replace(/</g, "\\u003c")};</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>\n${tag}`) : tag + html;
}

// ---------------------------------------------------------------- intent check
// Catches the v2 failure mode: user asked for an app/tool/game and got a marketing page.
const MARKETING = [
  [/class=["'][^"']*\bhero\b/i, "hero section"], [/id=["']pricing|class=["'][^"']*\bprice-card|>\s*(pricing|plans)\s*</i, "pricing section"],
  [/testimonial/i, "testimonials"], [/id=["']features|>\s*features\s*</i, "features section"], [/newsletter|subscribe to our/i, "newsletter"],
  [/>\s*(get started|start free|try it free|sign up free|book a demo)\s*</i, "marketing CTA"], [/id=["']faq|>\s*(faq|frequently asked)/i, "FAQ"],
  [/trusted by|loved by|what our (users|customers)/i, "social proof"],
];
function intentIssues(files, kind, prompt = "") {
  const out = [];
  const html = String(files["index.html"] || "");
  const js = Object.entries(files).filter(([p]) => p.endsWith(".js") && !["stak-ui.js", "stak.js", "stak-motion.js"].includes(p)).map(([, c]) => c).join("\n") + inlineScripts(html).join("\n");
  const add = (problem) => out.push({ file: "index.html", problem, kind: "intent" });
  if (kind && kind !== "site") {
    const hits = MARKETING.filter(([re]) => re.test(html)).map(([, l]) => l);
    if (hits.length >= 3) add(`This should be a working ${kind}, but index.html looks like a marketing landing page (${hits.join(", ")}). Remove the marketing sections and make the first screen the working ${kind} itself.`);
    const controls = (html.match(/<(input|textarea|select|button|canvas)\b/gi) || []).length + (js.match(/createElement\(["'](input|textarea|button|canvas)/g) || []).length;
    if (controls < 2) add(`A ${kind} needs interactive controls on the first screen, but index.html has almost none.`);
  }
  if (kind === "app" && /chat ?bot|assistant|\bchat\b|ai tutor|companion/i.test(prompt)) {
    if (!/<textarea|<input[^>]+(type=["']text|placeholder)/i.test(html + js)) add("Chatbot has no message input (textarea/input) on the first screen.");
    if (!/stak\.ai\.(chat|ask)/.test(js)) out.push({ file: "app.js", problem: "Chatbot never calls stak.ai.chat / stak.ai.ask, so it cannot actually reply. Use stak.ai.chat with onToken streaming.", kind: "intent" });
  }
  if (kind === "game" && !/<canvas|class=["'][^"']*(board|grid|cell|tile)|getContext\(/i.test(html + js)) add("Game has no canvas or game board.");
  if (kind === "tool" && !/addEventListener\(["'](input|change|click|submit)|on(input|change|click)=/i.test(js + html)) out.push({ file: "app.js", problem: "Tool never reacts to user input (no input/change/click handlers).", kind: "intent" });
  // starter content written from the browser fails for visitors when create is admin-only → empty pages
  const rules = readRules(files).rules?.collections || {};
  const seedRe = /if\s*\(\s*!\s*\(?\s*\w+(?:\.length)?\s*\)?\s*\)\s*\{[\s\S]{0,1500}?(?:const|let|var)\s+\w*seed\w*\s*=\s*\[|for\s*\(\s*const\s+\w+\s+of\s+\w*seed\w*\s*\)\s*await\s+\w+\.add\(|if\s*\(\s*!\s*\w+(?:\.length|\.items\.length)\s*\)\s*\{[^}]{0,400}?\bfor\s*\([^)]*\)\s*(?:\{\s*)?await\s+stak\.db\.(?:add|set|put)\(/i;
  if (seedRe.test(js)) out.push({ file: "app.js", problem: "Starter content is seeded from app.js — visitors are not allowed to write admin collections, so the page shows up empty.", fix: "Move the starter items into stak.seed.json ({\"collection\":[…]}) and delete the seeding code; just list() and render.", kind: "data", severity: "medium" });
  // the core screen of an app/tool/game must not be hidden behind a sign-in dialog unless accounts were requested
  if (kind && kind !== "site" && !/login|log in|sign ?in|sign ?up|account|users?\b|member|admin|auth/i.test(prompt)) {
    if (/else\s*\{?\s*(?:\w+\(\)\s*;?\s*)?[^}]{0,80}(?:showModal\(\)|showAuth\w*\(\))|if\s*\(\s*!\s*(?:stak\.)?auth\.user\s*\)\s*\{?[^}]{0,120}(?:showModal|showAuth|return)/.test(js) && /signIn\(/.test(js))
      out.push({ file: "app.js", problem: "The main screen is blocked behind a sign-in dialog, but the user never asked for accounts.", fix: "Let anonymous visitors use the product right away (owner rules work per device without sign-in); keep sign-in optional.", kind: "intent", severity: "medium" });
  }
  return out;
}

// stak.seed.json → { col: [docs] } (server inserts once into empty collections)
function readSeed(files) {
  const raw = files["stak.seed.json"];
  if (!raw) return null;
  try {
    const j = JSON.parse(raw), out = {};
    for (const [k, v] of Object.entries(j && typeof j === "object" ? j : {})) {
      if (!/^[\w-]{1,40}$/.test(k) || !Array.isArray(v)) continue;
      out[k] = v.filter((d) => d && typeof d === "object" && !Array.isArray(d)).slice(0, 200).map((d) => { const c = { ...d }; for (const x of ["id", "owner", "created", "updated"]) delete c[x]; return c; });
    }
    return out;
  } catch { return null; }
}

// stak.rules.json must be valid; returns parsed rules or null
function readRules(files) {
  const raw = files["stak.rules.json"];
  if (!raw) return { rules: null, issues: [] };
  try {
    const j = JSON.parse(raw);
    const OK = new Set(["public", "auth", "owner", "admin"]);
    const cols = j && typeof j.collections === "object" ? j.collections : {};
    const clean = { collections: {} };
    for (const [k, v] of Object.entries(cols)) {
      if (!/^[\w-]{1,40}$/.test(k) || !v || typeof v !== "object") continue;
      clean.collections[k] = {};
      for (const op of ["read", "create", "update", "delete"]) if (OK.has(v[op])) clean.collections[k][op] = v[op];
    }
    return { rules: clean, issues: [] };
  } catch (e) { return { rules: null, issues: [{ file: "stak.rules.json", problem: `stak.rules.json is not valid JSON: ${e.message}` }] }; }
}

async function verifyFull(files, title, { kind, prompt } = {}) {
  const v = verify(files, title);
  try { v.remaining.push(...await runtimeErrors(v.files)); } catch (e) { console.warn("[runtime-check]", e.message); }
  try { v.remaining.push(...domRefIssues(v.files)); } catch (e) { console.warn("[dom-check]", e.message); }
  if (kind) v.remaining.push(...intentIssues(v.files, kind, prompt));
  const r = readRules(v.files);
  v.remaining.push(...r.issues);
  v.rules = r.rules;
  return v;
}

module.exports = { domRefIssues, withPreviewAgent, intentIssues, readRules, readSeed, verifyFull, runtimeErrors, RUNTIME, KIT, withKit, parseFiles, parsePatches, summaryOf, applyBlock, verify, mimeOf, withConfig, withShim, cleanFile, safePath };
