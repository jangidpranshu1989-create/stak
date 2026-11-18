// Generated apps never run on the Stak origin.
// Hosting proxies (e.g. pplx.app) force `X-Frame-Options: DENY` and drop our CSP sandbox, so /api/site URLs
// can't be framed and would otherwise execute on the same origin as Stak. Instead:
//   - browser navigations to /api/site/<id>/… get a tiny trusted viewer page (below);
//   - the viewer fetches the raw app HTML (X-Stak-Raw: 1) and renders it in a sandboxed srcdoc iframe
//     without allow-same-origin → opaque origin, no access to Stak tokens, cookies or storage.
// The same approach is used by the builder's preview pane (client/src/lib/sitedoc.ts).

/* eslint-disable no-var */
// Runs inside the sandboxed app document: keeps in-app links working without framing /api/site URLs.
function navAgent() {
  if (window.parent === window) return;
  var m = String(document.baseURI).match(/^(.*\/api\/site\/[\w]+\/)/);
  if (!m) return;
  var R = m[1];
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var raw = a.getAttribute("href") || "";
    if (/^(javascript:|mailto:|tel:|sms:|data:|blob:)/i.test(raw) || a.hasAttribute("download")) return;
    if (raw.charAt(0) === "#") {
      e.preventDefault();
      if (raw.charAt(1) === "/") { location.hash = raw; return; }
      var id = raw.slice(1), t = null;
      try { t = id && (document.getElementById(decodeURIComponent(id)) || document.getElementsByName(id)[0]); } catch (_) {}
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    var u = a.href;
    if (u.indexOf(R) === 0) { e.preventDefault(); window.parent.postMessage({ __stak: "nav", path: u.slice(R.length) }, "*"); return; }
    if (/^https?:/i.test(u)) { e.preventDefault(); window.open(u, "_blank", "noopener"); }
  });
}

// Runs in the trusted top-level viewer page.
function viewer() {
  var f = document.getElementById("f");
  var m = location.href.split("#")[0].split("?")[0].match(/^(.*\/api\/site\/([\w]+)\/)(.*)$/);
  if (!m) return;
  var R = m[1], PID = m[2], KEY = "stak_site_" + PID, API = R.replace(/\/api\/site\/.*$/, "") + "/api/rt/" + PID;
  function J(v) { return JSON.stringify(v).replace(/</g, "\\u003c"); }
  function store() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function build(h, url) {
    var dir = url.replace(/[^/]*$/, "");
    var inj = '<base href="' + dir.replace(/"/g, "%22") + '"><script>window.STAK={project:' + J(PID) + ",api:" + J(API) + "};window.__STAK_STORE__={ls:" + J(store()) + "}<\/script>";
    return /<head(\s[^>]*)?>/i.test(h) ? h.replace(/<head(\s[^>]*)?>/i, function (x) { return x + inj; }) : inj + h;
  }
  function load(p) {
    var c = (p || "").split("#")[0].split("?")[0];
    if (!c || /\/$/.test(c)) c += "index.html";
    if (c.indexOf("..") > -1) c = "index.html";
    fetch(R + c, { headers: { "X-Stak-Raw": "1" }, cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
      .then(function (h) { f.srcdoc = build(h, R + c); })
      .catch(function () { f.srcdoc = '<div style="font:15px/1.5 system-ui,sans-serif;padding:32px;color:#555">This page could not be loaded. Check your connection and try again.</div>'; });
  }
  addEventListener("message", function (e) {
    if (e.source !== f.contentWindow) return;
    var d = e.data || {};
    if (d.__stak === "store" && d.ns === "ls" && d.data && typeof d.data === "object") {
      try { var s = JSON.stringify(d.data); if (s.length < 1500000) localStorage.setItem(KEY, s); } catch (_) {}
    } else if (d.__stak === "nav" && typeof d.path === "string" && /^[\w\-./%]*([?#].*)?$/.test(d.path)) {
      history.pushState(null, "", R + d.path); load(d.path);
    }
  });
  addEventListener("popstate", function () { load(location.href.split("?")[0].split("#")[0].slice(R.length)); });
  load(m[3]);
}

const NAV_AGENT = `<script>(${navAgent.toString()})();</script>`;
function withNav(html) {
  return /<head(\s[^>]*)?>/i.test(html) ? html.replace(/<head(\s[^>]*)?>/i, (x) => `${x}\n${NAV_AGENT}`) : NAV_AGENT + html;
}
const esc = (v) => String(v || "App").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
function viewerPage(title) {
  const t = esc(title);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${t}</title><meta name="robots" content="noindex"><style>html,body{margin:0;height:100%;background:#fff}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;display:block}</style></head><body><iframe id="f" title="${t}" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" allow="clipboard-write; camera; microphone; geolocation"></iframe><script>(${viewer.toString()})();</script></body></html>`;
}

module.exports = { withNav, viewerPage };
