// Stak v4 UI patches — keeps the original UI, adds: a real Stop button, "Install app" (Android APK), no model picker.
(function () {
  "use strict";
  var nativeFetch = window.fetch.bind(window);
  var job = null, base = "", authz = null, stopping = false;
  var isApp = /StakAndroid/i.test(navigator.userAgent);

  function hdrs(init) {
    var h = init && init.headers;
    if (!h) return null;
    if (typeof h.get === "function") return h.get("Authorization");
    return h.Authorization || h.authorization || null;
  }
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = ((init && init.method) || "GET").toUpperCase();
    var p = nativeFetch(input, init);
    try {
      var m = /^(.*?)\/api\/jobs\/([A-Za-z0-9]+)(?:\?|$)/.exec(url);
      var start = /^(.*?)\/api\/projects(?:\/[A-Za-z0-9]+\/(?:answers|messages|retry))?$/.exec(url);
      if (m && method === "GET") {
        p.then(function (r) { return r.clone().json(); }).then(function (j) {
          if (j && j.status === "running") { set(m[2], m[1], hdrs(init)); }
          else if (job === m[2]) clear();
        }).catch(function () {});
      } else if (start && method === "POST") {
        p.then(function (r) { return r.ok ? r.clone().json() : null; }).then(function (j) {
          if (j && j.jobId) set(j.jobId, start[1], hdrs(init));
        }).catch(function () {});
      }
    } catch (e) {}
    return p;
  };

  // ---------------------------------------------------------------- Stop
  var btn = document.createElement("button");
  btn.className = "stk-stop"; btn.type = "button"; btn.hidden = true;
  btn.setAttribute("data-testid", "button-stop");
  btn.innerHTML = '<i></i><span>Stop</span>';
  btn.addEventListener("click", stop);
  function mount() { if (!btn.isConnected && document.body) document.body.appendChild(btn); }
  function label() {
    var hi = /^(hi|hinglish)/.test(document.documentElement.lang || "") || /hinglish|hi/.test(localStorage.getItem("stak_lang") || "");
    return stopping ? (hi ? "Rok rahe hain…" : "Stopping…") : (hi ? "Stop karo" : "Stop generating");
  }
  function set(id, b, a) {
    if (job !== id) { stopping = false; try { window.StakAndroid && window.StakAndroid.jobStarted(); } catch (e) {} }
    job = id; base = b || ""; if (a) authz = a;
    mount(); btn.hidden = false; btn.querySelector("span").textContent = label();
    if (stopping) btn.setAttribute("data-busy", ""); else btn.removeAttribute("data-busy");
  }
  function clear() { try { window.StakAndroid && window.StakAndroid.refreshWidgets(); } catch (e) {} job = null; stopping = false; btn.hidden = true; btn.removeAttribute("data-busy"); }
  function stop() {
    if (!job || stopping) return;
    stopping = true; set(job, base, authz);
    var h = { "Content-Type": "application/json" };
    if (authz) h.Authorization = authz;
    var id = job;
    nativeFetch(base + "/api/jobs/" + id + "/stop", { method: "POST", headers: h, body: "{}" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); })
      .catch(function () { stopping = false; set(id, base, authz); });
    // safety: hide after 8 s even if the poll loop already ended
    setTimeout(function () { if (job === id && stopping) clear(); }, 8000);
  }
  // Esc also stops while generating
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && job && !document.querySelector("[role=dialog]")) stop(); });

  // ---------------------------------------------------------------- Install app (Android APK)
  var APK = "./stak.apk";
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7.5v7m0 0-3-3m3 3 3-3M10 18.5h4"/></svg>';
  function isAndroid() { return /Android/i.test(navigator.userAgent); }
  function addInstall() {
    if (isApp) return;
    var nc = document.querySelector('[data-testid="button-new-chat"]');
    if (nc && !document.querySelector(".stk-apk")) {
      var a = document.createElement("a");
      a.className = "stk-apk"; a.href = APK; a.setAttribute("download", "Stak.apk"); a.setAttribute("data-testid", "link-install-apk");
      a.innerHTML = ICON + '<span>Install app<small>Android · widgets + alerts</small></span>';
      var row = nc.closest("div") || nc.parentElement;
      row.parentElement.insertBefore(a, row.nextSibling);
    }
    var tpl = document.querySelector('[data-testid="section-templates"]');
    var home = tpl && tpl.parentElement;
    if (home && !document.querySelector(".stk-apk-pill")) {
      var w = document.createElement("div"); w.className = "stk-apk-wrap";
      w.innerHTML = '<a class="stk-apk-pill" data-testid="button-install-apk" href="' + APK + '" download="Stak.apk">' + ICON + '<span>' + (isAndroid() ? "Install the Stak app" : "Get the Android app") + '</span></a>';
      home.insertBefore(w, tpl);
    }
  }
  var mo = new MutationObserver(function () { addInstall(); if (job) mount(); });
  function boot() { mount(); addInstall(); mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
