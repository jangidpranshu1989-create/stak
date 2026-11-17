/* Website interactions — sticky header, mobile menu, tabs, reveal, lead form */
(function(){
  var A = window.APP || {}, K = window.Kit, $ = K.$, $$ = K.$$, T = A.text || {};
  if (A.accentFg) document.documentElement.style.setProperty('--accent-fg', A.accentFg);
  var hdr = $('#hdr'), burger = $('#burger');
  var onScroll = function(){ hdr.classList.toggle('solid', scrollY > 8); };
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  if (burger) burger.addEventListener('click', function(){ var o = hdr.classList.toggle('open'); burger.setAttribute('aria-expanded', o); burger.innerHTML = Icon(o ? 'x' : 'menu', 20); });
  $$('#drawer a').forEach(function(a){ a.addEventListener('click', function(){ hdr.classList.remove('open'); if (burger){ burger.setAttribute('aria-expanded', 'false'); burger.innerHTML = Icon('menu', 20); } }); });
  $$('.tabs').forEach(function(tabs){
    var sec = tabs.closest('section');
    tabs.addEventListener('click', function(e){ var b = e.target.closest('[data-tab]'); if (!b) return; var k = b.getAttribute('data-tab');
      $$('[data-tab]', tabs).forEach(function(x){ x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      $$('[data-panel]', sec).forEach(function(p){ p.classList.toggle('hidden', p.getAttribute('data-panel') !== k); $$('.reveal', p).forEach(function(r){ r.classList.add('in'); }); }); });
  });
  if ('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    $$('.reveal').forEach(function(el, i){ el.style.transitionDelay = (i % 4) * 60 + 'ms'; io.observe(el); });
    setTimeout(function(){ $$('.reveal').forEach(function(el){ if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in'); }); }, 60);
  } else $$('.reveal').forEach(function(el){ el.classList.add('in'); });

  var form = $('#leadForm'), note = $('#formNote');
  if (form) form.addEventListener('submit', function(e){
    e.preventDefault();
    var data = {}; $$('input,textarea,select', form).forEach(function(el){ data[el.name] = el.value.trim(); el.classList.remove('invalid'); });
    var bad = $$('[required]', form).filter(function(el){ return !el.value.trim(); });
    if (data.phone && !/^[+\d][\d\s-]{6,}$/.test(data.phone)){ var p = form.querySelector('[name=phone]'); if (bad.indexOf(p) < 0) bad.push(p); }
    if (bad.length){ bad.forEach(function(el){ el.classList.add('invalid'); }); bad[0].focus(); show(T.required || 'Please fill in the required fields', true); return; }
    var btn = form.querySelector('button[type=submit]'), label = btn.textContent; btn.disabled = true; btn.textContent = T.sending || 'Sending…';
    data.page = location.pathname; data.at = new Date().toISOString();
    var p = window.stak && stak.db ? stak.db.collection('leads').add(data) : Promise.reject(new Error('offline'));
    p.then(function(){ form.reset(); show(T.thanks || 'Thank you! We will get back to you shortly.'); K.toast(T.thanks || 'Sent', { icon: 'check' }); },
      function(){ show(T.error || 'Could not send. Please call us instead.', true); })
     .then(function(){ btn.disabled = false; btn.textContent = label; });
  });
  function show(msg, bad){ if (!note) return; note.textContent = msg; note.classList.toggle('bad', !!bad); note.classList.remove('hidden'); }
})();
