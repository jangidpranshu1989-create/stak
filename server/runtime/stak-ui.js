/* Stak UI behaviours — pairs with stak-ui.css. No dependencies.
   Theme:     <button data-theme-toggle class="btn btn-ghost btn-icon theme-toggle">…</button>   (persists, respects OS)
   Mobile nav:<button data-nav-toggle aria-controls="mnav">  +  <nav id="mnav" class="mobile-nav">
   Tabs:      <div data-tabs><div class="tabs-list" role="tablist"><button class="tab" data-tab="a">A</button>…</div><div class="tab-panel" data-panel="a">…</div></div>
   Dialog:    <button data-dialog-open="d1">  <dialog id="d1" class="dialog">…<button data-dialog-close>
   Dropdown:  <div class="dropdown"><button data-dropdown>…</button><div class="dropdown-menu">…</div></div>
   JS API:    ui.toast("Saved", {type:"success", title:"Done"}); ui.loading(btn, true); ui.timeAgo(ts); ui.theme.set("dark")
              ui.validate(form) -> boolean (uses native constraints, sets aria-invalid + .field-error) */
(function () {
  var d = document, root = d.documentElement, KEY = "stak-theme";
  var theme = {
    get: function () { return root.classList.contains("dark") ? "dark" : "light"; },
    set: function (t) { root.classList.toggle("dark", t === "dark"); root.setAttribute("data-theme", t); try { localStorage.setItem(KEY, t); } catch (e) {}
      var m = d.querySelector('meta[name="theme-color"]'); if (m && m.dataset[t]) m.content = m.dataset[t]; },
    toggle: function () { theme.set(theme.get() === "dark" ? "light" : "dark"); }
  };
  try { var saved = localStorage.getItem(KEY); if (saved) theme.set(saved); else if (root.dataset.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches) theme.set("dark"); } catch (e) {}

  var toaster;
  function toast(msg, o) { o = o || {};
    if (!toaster) { toaster = d.createElement("div"); toaster.className = "toaster"; toaster.setAttribute("role", "status"); toaster.setAttribute("aria-live", "polite"); d.body.appendChild(toaster); }
    var t = d.createElement("div"); t.className = "toast"; t.dataset.type = o.type || "info";
    t.innerHTML = '<div>' + (o.title ? '<div class="toast-title"></div>' : '') + '<div class="toast-msg"></div></div>';
    if (o.title) t.querySelector(".toast-title").textContent = o.title; t.querySelector(".toast-msg").textContent = msg;
    toaster.appendChild(t); setTimeout(function () { t.style.transition = "opacity .3s"; t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 300); }, o.duration || 3500);
    return t; }
  function loading(btn, on) { if (!btn) return; btn.dataset.loading = on ? "true" : "false"; btn.disabled = !!on; btn.setAttribute("aria-busy", on ? "true" : "false"); }
  function timeAgo(ts) { var s = Math.round((Date.now() - new Date(ts).getTime()) / 1000); if (s < 10) return "just now"; if (s < 60) return s + "s ago"; var m = Math.round(s / 60); if (m < 60) return m + "m ago"; var h = Math.round(m / 60); if (h < 24) return h + "h ago"; return Math.round(h / 24) + "d ago"; }
  function validate(form) { var ok = true;
    form.querySelectorAll("input,select,textarea").forEach(function (el) { var f = el.closest(".field"), err = f && f.querySelector(".field-error");
      if (!el.checkValidity()) { ok = false; el.setAttribute("aria-invalid", "true"); if (f && !err) { err = d.createElement("div"); err.className = "field-error"; f.appendChild(err); } if (err) err.textContent = el.validationMessage; }
      else { el.removeAttribute("aria-invalid"); if (err) err.textContent = ""; } });
    if (!ok) { var first = form.querySelector('[aria-invalid="true"]'); first && first.focus(); } return ok; }

  d.addEventListener("click", function (e) {
    var t = e.target.closest("[data-theme-toggle],[data-nav-toggle],[data-dialog-open],[data-dialog-close],[data-dropdown],.tab,.mobile-nav a");
    d.querySelectorAll('.dropdown[data-open="true"]').forEach(function (x) { if (!x.contains(e.target)) x.dataset.open = "false"; });
    if (!t) return;
    if (t.hasAttribute("data-theme-toggle")) theme.toggle();
    else if (t.hasAttribute("data-nav-toggle")) { var n = d.getElementById(t.getAttribute("aria-controls")) || d.querySelector(".mobile-nav"); if (n) { var open = n.dataset.open !== "true"; n.dataset.open = open; t.setAttribute("aria-expanded", open); } }
    else if (t.matches(".mobile-nav a")) { var mn = t.closest(".mobile-nav"); mn.dataset.open = "false"; }
    else if (t.hasAttribute("data-dialog-open")) { var dl = d.getElementById(t.getAttribute("data-dialog-open")); dl && dl.showModal && dl.showModal(); }
    else if (t.hasAttribute("data-dialog-close")) { var c = t.closest("dialog"); c && c.close(); }
    else if (t.hasAttribute("data-dropdown")) { var dd = t.closest(".dropdown"); dd.dataset.open = dd.dataset.open !== "true"; t.setAttribute("aria-expanded", dd.dataset.open); }
    else if (t.classList.contains("tab")) { var w = t.closest("[data-tabs]"); if (!w) return; var id = t.dataset.tab;
      w.querySelectorAll(".tab").forEach(function (b) { b.setAttribute("aria-selected", b === t); b.setAttribute("tabindex", b === t ? "0" : "-1"); });
      w.querySelectorAll(".tab-panel").forEach(function (p) { p.hidden = p.dataset.panel !== id; }); }
  });
  d.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { d.querySelectorAll('.dropdown[data-open="true"],.mobile-nav[data-open="true"]').forEach(function (x) { x.dataset.open = "false"; }); }
    var t = e.target; if (!t.classList || !t.classList.contains("tab") || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    var tabs = [].slice.call(t.closest(".tabs-list").querySelectorAll(".tab")), i = tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : -1);
    var n = tabs[(i + tabs.length) % tabs.length]; n.focus(); n.click();
  });
  d.addEventListener("click", function (e) { var dl = e.target; if (dl.tagName === "DIALOG" && dl.classList.contains("dialog")) { var r = dl.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dl.close(); } });
  function init() { d.querySelectorAll("[data-tabs]").forEach(function (w) { var first = w.querySelector('.tab[aria-selected="true"]') || w.querySelector(".tab"); first && first.click(); });
    d.querySelectorAll(".tabs-list").forEach(function (l) { l.setAttribute("role", "tablist"); l.querySelectorAll(".tab").forEach(function (b) { b.setAttribute("role", "tab"); }); }); }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", init); else init();
  window.ui = { toast: toast, loading: loading, timeAgo: timeAgo, validate: validate, theme: theme };
})();
