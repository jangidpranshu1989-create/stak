/* Stak icons — Lucide (ISC). <i data-icon="timer" class="size-5"></i> or Icon('timer') → SVG string. Works for HTML added later too. */
(function () {
  var P = __ICONS__;
  function body(n) { var b = P[n]; return typeof b === "string" && b.charAt(0) !== "<" ? P[b] : b; }
  function Icon(n, size) { var b = body(n) || body("circle"); var s = size || 24;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="stak-icon">' + b + "</svg>"; }
  Icon.has = function (n) { return !!body(n); }; Icon.names = Object.keys(P);
  function paint(root) { if (!root || !root.querySelectorAll) return; var els = root.matches && root.matches("[data-icon]") ? [root] : [];
    els = els.concat(Array.prototype.slice.call(root.querySelectorAll("[data-icon]")));
    els.forEach(function (e) { var n = e.getAttribute("data-icon"); if (e.__icon === n) return; e.__icon = n; e.innerHTML = Icon(n, Number(e.getAttribute("data-size")) || undefined); }); }
  window.Icon = window.Icon || Icon;
  function start() { paint(document.body); try { new MutationObserver(function (ms) { ms.forEach(function (m) { if (m.type === "attributes") { m.target.__icon = null; paint(m.target); } else m.addedNodes.forEach(function (n) { n.nodeType === 1 && paint(n); }); }); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-icon"] }); } catch (e) {} }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
