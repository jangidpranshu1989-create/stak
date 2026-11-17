/* Stak Pro app kit — storage, toasts, confirm dialog, theme, formatting */
(function(){
  var mem = {}, LS = null;
  try { LS = window['local' + 'Storage']; LS.setItem('__t', '1'); LS.removeItem('__t'); } catch (e) { LS = null; }
  var NS = (window.APP && window.APP.id) || 'app';
  var store = {
    get: function(k, d){ try { var v = LS ? LS.getItem(NS + ':' + k) : mem[k]; return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function(k, v){ var s = JSON.stringify(v); try { if (LS) LS.setItem(NS + ':' + k, s); else mem[k] = s; } catch (e) { mem[k] = s; } },
    del: function(k){ try { LS ? LS.removeItem(NS + ':' + k) : delete mem[k]; } catch (e) {} },
    persistent: !!LS
  };
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r){ return (r || document).querySelector(s); }
  function $$(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  var toastsEl = null;
  function toast(msg, o){
    o = o || {};
    if (!toastsEl){ toastsEl = document.createElement('div'); toastsEl.className = 'toasts'; toastsEl.setAttribute('role', 'status'); toastsEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastsEl); }
    var t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = (o.icon ? Icon(o.icon, 16) : '') + '<span>' + esc(msg) + '</span>' + (o.action ? '<button type="button">' + esc(o.action) + '</button>' : '');
    toastsEl.appendChild(t);
    var gone = false, close = function(){ if (gone) return; gone = true; t.classList.add('out'); setTimeout(function(){ t.remove(); }, 220); };
    if (o.action) t.querySelector('button').onclick = function(){ close(); o.onAction && o.onAction(); };
    setTimeout(close, o.duration || (o.action ? 5000 : 2600));
    return close;
  }

  var dlg = null, ov = null;
  function confirmDialog(o){
    return new Promise(function(res){
      if (!dlg){
        ov = document.createElement('div'); ov.className = 'overlay';
        dlg = document.createElement('div'); dlg.className = 'dialog'; dlg.setAttribute('role', 'alertdialog'); dlg.setAttribute('aria-modal', 'true');
        document.body.appendChild(ov); document.body.appendChild(dlg);
      }
      dlg.innerHTML = '<h3>' + esc(o.title || 'Are you sure?') + '</h3><p>' + esc(o.body || '') + '</p><div class="row"><button class="btn btn-secondary" data-a="0">' + esc(o.cancel || 'Cancel') + '</button><button class="btn ' + (o.danger === false ? 'btn-primary' : 'btn-danger') + '" data-a="1">' + esc(o.ok || 'Delete') + '</button></div>';
      var done = function(v){ dlg.classList.remove('open'); ov.classList.remove('open'); document.removeEventListener('keydown', key); res(v); };
      var key = function(e){ if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', key);
      ov.onclick = function(){ done(false); };
      $$('button', dlg).forEach(function(b){ b.onclick = function(){ done(b.getAttribute('data-a') === '1'); }; });
      requestAnimationFrame(function(){ ov.classList.add('open'); dlg.classList.add('open'); $('[data-a="1"]', dlg).focus(); });
    });
  }

  var theme = {
    get: function(){ return document.documentElement.getAttribute('data-theme') || 'light'; },
    set: function(t){ document.documentElement.setAttribute('data-theme', t); store.set('theme', t); var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', getComputedStyle(document.body).backgroundColor); },
    toggle: function(){ theme.set(theme.get() === 'dark' ? 'light' : 'dark'); return theme.get(); },
    init: function(def){ var saved = store.get('theme'); var t = saved || def || 'light'; if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; document.documentElement.setAttribute('data-theme', t); }
  };

  var LOCALE = (window.APP && window.APP.locale) || 'en-IN';
  function money(n, cur, opts){
    cur = cur || (window.APP && window.APP.currency) || 'INR';
    try { return new Intl.NumberFormat(LOCALE, Object.assign({ style: 'currency', currency: cur, maximumFractionDigits: Math.abs(n) % 1 ? 2 : 0 }, opts || {})).format(n || 0); }
    catch (e) { return cur + ' ' + (n || 0); }
  }
  function compact(n){ try { return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0); } catch (e) { return String(n); } }
  function num(n){ try { return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(n || 0); } catch (e) { return String(n); } }
  function date(d, o){ try { return new Date(d).toLocaleDateString(LOCALE, o || { day: 'numeric', month: 'short' }); } catch (e) { return String(d); } }
  function relTime(t){
    var s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago'; return date(t);
  }
  function today(){ var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function download(name, text, type){ var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function copy(text){
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(fallback);
    return Promise.resolve(fallback());
    function fallback(){ var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); }
  }
  window.Kit = { store: store, esc: esc, $: $, $$: $$, uid: uid, toast: toast, confirm: confirmDialog, theme: theme, money: money, compact: compact, num: num, date: date, relTime: relTime, today: today, download: download, copy: copy };
})();
