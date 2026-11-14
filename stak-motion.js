/* Stak Motion — Framer-grade motion, interaction & 3D kit for Stak sites.
   Usage: <script src="stak-motion.js" defer></script>  — then use data-attributes:
   data-reveal="up|fade|blur|scale|left|right|clip", data-delay="120", data-stagger (parent),
   data-split="words|chars|lines", data-count="1200", data-magnetic, data-tilt, data-spotlight,
   data-parallax="0.2", data-marquee, data-rotate="a|b|c", data-smooth (on <html> or <body>),
   data-scroll-progress, data-hscroll, <stak-scene variant="blob|particles|waves|globe|rings">.
   Utility classes: sm-mesh, sm-grain, sm-glass, sm-beam, sm-shine, sm-grid, sm-glow, sm-float.
   Content is ALWAYS visible without JS or with prefers-reduced-motion. */
(function () {
  if (window.StakMotion) return;
  var doc = document, root = doc.documentElement;
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var fine = false;
  try { fine = matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}

  var CSS = [
    ':root{--sm-ease:cubic-bezier(.16,1,.3,1);--sm-c1:#7c3aed;--sm-c2:#ec4899;--sm-c3:#f97316;--sm-c4:#06b6d4}',
    'html.sm-on [data-reveal]:not(.sm-in){opacity:0}',
    'html.sm-on [data-reveal="up"]:not(.sm-in),html.sm-on [data-reveal=""]:not(.sm-in){transform:translate3d(0,28px,0)}',
    'html.sm-on [data-reveal="left"]:not(.sm-in){transform:translate3d(-36px,0,0)}',
    'html.sm-on [data-reveal="right"]:not(.sm-in){transform:translate3d(36px,0,0)}',
    'html.sm-on [data-reveal="scale"]:not(.sm-in){transform:scale(.94)}',
    'html.sm-on [data-reveal="blur"]:not(.sm-in){filter:blur(14px);transform:translate3d(0,14px,0)}',
    'html.sm-on [data-reveal="clip"]:not(.sm-in){clip-path:inset(0 0 100% 0);opacity:1}',
    'html.sm-on [data-reveal]{transition:opacity .9s var(--sm-ease),transform 1s var(--sm-ease),filter 1s var(--sm-ease),clip-path 1.1s var(--sm-ease);transition-delay:var(--sm-d,0ms);will-change:opacity,transform}',
    'html.sm-on [data-reveal].sm-done{will-change:auto}',
    '.sm-w{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.08em;margin-bottom:-.08em}',
    '.sm-w>span{display:inline-block}',
    'html.sm-on [data-split]:not(.sm-in) .sm-w>span{transform:translate3d(0,108%,0) rotate(4deg);opacity:0}',
    'html.sm-on [data-split] .sm-w>span{transition:transform 1s var(--sm-ease),opacity .7s var(--sm-ease);transition-delay:calc(var(--sm-d,0ms) + var(--i,0) * 38ms)}',
    '[data-split="chars"] .sm-w>span{transition-delay:calc(var(--sm-d,0ms) + var(--i,0) * 18ms)!important}',
    '[data-magnetic]{transition:transform .5s var(--sm-ease);will-change:transform}',
    '[data-tilt]{transform-style:preserve-3d;transition:transform .6s var(--sm-ease);will-change:transform;position:relative}',
    '[data-tilt].sm-tilting{transition:transform .08s linear}',
    '[data-tilt]>.sm-glare{position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(600px circle at var(--gx,50%) var(--gy,50%),rgba(255,255,255,.18),transparent 40%);opacity:0;transition:opacity .4s}',
    '[data-tilt].sm-tilting>.sm-glare{opacity:1}',
    '[data-spotlight]{position:relative;isolation:isolate}',
    '[data-spotlight]::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;opacity:0;transition:opacity .4s;background:radial-gradient(520px circle at var(--mx,50%) var(--my,50%),var(--sm-spot,rgba(255,255,255,.09)),transparent 42%)}',
    '[data-spotlight]::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;padding:1px;opacity:0;transition:opacity .4s;background:radial-gradient(360px circle at var(--mx,50%) var(--my,50%),var(--sm-spot-border,rgba(255,255,255,.45)),transparent 45%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}',
    '[data-spotlight]:hover::before,[data-spotlight]:hover::after,[data-spotlight].sm-lit::before,[data-spotlight].sm-lit::after{opacity:1}',
    '[data-marquee]{overflow:hidden;display:flex;-webkit-mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)}',
    '.sm-track{display:flex;flex-shrink:0;gap:var(--sm-gap,3rem);padding-right:var(--sm-gap,3rem);min-width:max-content;animation:sm-marq var(--sm-speed,32s) linear infinite}',
    '[data-marquee][data-direction="right"] .sm-track{animation-direction:reverse}',
    '[data-marquee]:hover .sm-track{animation-play-state:paused}',
    '@keyframes sm-marq{to{transform:translate3d(-100%,0,0)}}',
    '[data-rotate]{display:inline-grid;vertical-align:bottom}',
    '[data-rotate]>span{grid-area:1/1;transition:opacity .5s var(--sm-ease),transform .6s var(--sm-ease),filter .5s;white-space:nowrap}',
    '[data-rotate]>span:not(.sm-cur){opacity:0;transform:translate3d(0,.5em,0);filter:blur(6px)}',
    '[data-rotate]>span.sm-out{transform:translate3d(0,-.5em,0)}',
    '.sm-progress{position:fixed;left:0;top:0;height:3px;width:100%;transform-origin:0 50%;transform:scaleX(0);z-index:9999;background:linear-gradient(90deg,var(--sm-c1),var(--sm-c2),var(--sm-c3));pointer-events:none}',
    '.sm-mesh{position:relative;isolation:isolate;overflow:hidden}',
    '.sm-mesh::before,.sm-mesh::after{content:"";position:absolute;z-index:-1;width:70vmax;height:70vmax;border-radius:50%;filter:blur(80px);opacity:.55;pointer-events:none;animation:sm-drift 18s ease-in-out infinite alternate}',
    '.sm-mesh::before{left:-20vmax;top:-30vmax;background:radial-gradient(circle,var(--sm-c1),transparent 62%)}',
    '.sm-mesh::after{right:-25vmax;bottom:-35vmax;background:radial-gradient(circle,var(--sm-c2),transparent 62%);animation-duration:22s;animation-direction:alternate-reverse}',
    '@keyframes sm-drift{0%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(8vmax,4vmax,0) scale(1.12)}100%{transform:translate3d(-4vmax,8vmax,0) scale(.95)}}',
    '.sm-grain{position:relative}',
    '.sm-grain::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:1;opacity:.07;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.85%27 numOctaves=%273%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")}',
    '.sm-glass{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 20px 60px -20px rgba(0,0,0,.45)}',
    '@property --sm-a{syntax:"<angle>";initial-value:0deg;inherits:false}',
    '.sm-beam{position:relative;isolation:isolate}',
    '.sm-beam::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;z-index:-1;background:conic-gradient(from var(--sm-a),transparent 0 70%,var(--sm-c3),var(--sm-c2),var(--sm-c1),transparent);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:sm-spin 4s linear infinite}',
    '@keyframes sm-spin{to{--sm-a:360deg}}',
    '.sm-shine{background:linear-gradient(110deg,currentColor 35%,rgba(255,255,255,.95) 50%,currentColor 65%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:sm-shine 4.5s linear infinite}',
    '@keyframes sm-shine{from{background-position:150% 0}to{background-position:-100% 0}}',
    '.sm-gradient-text{background:linear-gradient(100deg,var(--sm-c1),var(--sm-c2) 45%,var(--sm-c3));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}',
    '.sm-grid{position:relative}',
    '.sm-grid::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(var(--sm-grid-c,rgba(255,255,255,.06)) 1px,transparent 1px),linear-gradient(90deg,var(--sm-grid-c,rgba(255,255,255,.06)) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000,transparent 75%);mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000,transparent 75%)}',
    '.sm-glow{box-shadow:0 0 0 1px rgba(255,255,255,.08),0 10px 40px -10px var(--sm-c1),0 0 80px -20px var(--sm-c2)}',
    '.sm-float{animation:sm-float 6s ease-in-out infinite}',
    '@keyframes sm-float{50%{transform:translate3d(0,-14px,0)}}',
    '[data-hscroll]{position:relative}',
    '[data-hscroll]>.sm-sticky{position:sticky;top:0;height:100vh;height:100svh;overflow:hidden;display:flex;align-items:center}',
    '[data-hscroll] .sm-htrack{display:flex;gap:var(--sm-gap,2rem);will-change:transform;padding-inline:max(1.25rem,5vw)}',
    'stak-scene{display:block;position:relative;width:100%;height:100%;min-height:240px;overflow:hidden}',
    'stak-scene>canvas{position:absolute;inset:0;width:100%!important;height:100%!important;display:block;opacity:0;transition:opacity 1.2s var(--sm-ease)}',
    'stak-scene.sm-live>canvas{opacity:1}',
    'stak-scene.sm-fallback{background:radial-gradient(circle at 50% 45%,var(--sm-c2),transparent 55%),radial-gradient(circle at 35% 60%,var(--sm-c1),transparent 50%),radial-gradient(circle at 65% 60%,var(--sm-c3),transparent 50%);filter:blur(30px);opacity:.75}',
    '.sm-cursor{position:fixed;left:0;top:0;width:420px;height:420px;margin:-210px 0 0 -210px;border-radius:50%;pointer-events:none;z-index:0;background:radial-gradient(circle,var(--sm-cursor,rgba(124,58,237,.16)),transparent 60%);transition:opacity .4s;will-change:transform}',
    '@media (prefers-reduced-motion:reduce){.sm-track,.sm-mesh::before,.sm-mesh::after,.sm-beam::before,.sm-shine,.sm-float{animation:none!important}[data-magnetic],[data-tilt]{transform:none!important}}'
  ].join('\n');

  function injectCss() {
    if (doc.getElementById('sm-css')) return;
    var s = doc.createElement('style'); s.id = 'sm-css'; s.textContent = CSS;
    (doc.head || root).appendChild(s);
  }
  injectCss();
  if (!reduce) root.classList.add('sm-on');

  function $$(sel, ctx) { try { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); } catch (e) { return []; } }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function mark(el, k) { if (el['__sm' + k]) return false; el['__sm' + k] = 1; return true; }

  /* ---------- reveal ---------- */
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target; io.unobserve(el);
      el.classList.add('sm-in');
      setTimeout(function () { el.classList.add('sm-done'); }, 1400 + num(el.style.getPropertyValue('--sm-d'), 0));
      if (el.hasAttribute('data-count')) countUp(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }) : null;

  function reveal(el) {
    if (!mark(el, 'rv')) return;
    var d = el.getAttribute('data-delay'); if (d) el.style.setProperty('--sm-d', num(d, 0) + 'ms');
    if (!io || reduce) { el.classList.add('sm-in', 'sm-done'); if (el.hasAttribute('data-count')) countUp(el); return; }
    io.observe(el);
  }
  function stagger(p) {
    if (!mark(p, 'st')) return;
    var step = num(p.getAttribute('data-stagger'), 70) || 70;
    var kids = Array.prototype.slice.call(p.children);
    kids.forEach(function (k, i) {
      if (!k.hasAttribute('data-reveal')) k.setAttribute('data-reveal', p.getAttribute('data-stagger-type') || 'up');
      if (!k.getAttribute('data-delay')) k.setAttribute('data-delay', String(i * step));
    });
  }

  /* ---------- split text ---------- */
  function split(el) {
    if (!mark(el, 'sp')) return;
    var mode = el.getAttribute('data-split') || 'words';
    var i = 0;
    function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var parts = n.textContent.split(/(\s+)/);
          var frag = doc.createDocumentFragment();
          parts.forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.appendChild(doc.createTextNode(' ')); return; }
            if (mode === 'chars') {
              var word = doc.createElement('span'); word.style.display = 'inline-block'; word.style.whiteSpace = 'nowrap';
              Array.from(w).forEach(function (ch) { word.appendChild(box(ch, i++)); });
              frag.appendChild(word);
            } else frag.appendChild(box(w, i++));
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1 && !/^(BR|SVG|IMG)$/i.test(n.tagName)) walk(n);
      });
    }
    function box(t, idx) {
      var o = doc.createElement('span'); o.className = 'sm-w';
      var s = doc.createElement('span'); s.textContent = t; s.style.setProperty('--i', idx);
      o.appendChild(s); return o;
    }
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', (el.textContent || '').trim().replace(/\s+/g, ' '));
    walk(el);
    reveal(el);
  }

  /* ---------- counters ---------- */
  function countUp(el) {
    if (!mark(el, 'ct')) return;
    var to = num(el.getAttribute('data-count'), 0), dec = num(el.getAttribute('data-decimals'), (String(to).split('.')[1] || '').length);
    var pre = el.getAttribute('data-prefix') || '', suf = el.getAttribute('data-suffix') || '';
    var dur = num(el.getAttribute('data-duration'), 1600), t0 = 0;
    var fmt = function (v) { try { return pre + v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; } catch (e) { return pre + v.toFixed(dec) + suf; } };
    if (reduce) { el.textContent = fmt(to); return; }
    function f(t) { if (!t0) t0 = t; var p = Math.min(1, (t - t0) / dur); var e = 1 - Math.pow(1 - p, 4); el.textContent = fmt(to * e); if (p < 1) requestAnimationFrame(f); }
    requestAnimationFrame(f);
  }

  /* ---------- magnetic ---------- */
  function magnetic(el) {
    if (!mark(el, 'mg') || !fine || reduce) return;
    var s = num(el.getAttribute('data-magnetic'), 0.35) || 0.35;
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.transform = 'translate3d(' + ((e.clientX - r.left - r.width / 2) * s) + 'px,' + ((e.clientY - r.top - r.height / 2) * s) + 'px,0)';
    });
    el.addEventListener('pointerleave', function () { el.style.transform = ''; });
  }

  /* ---------- tilt ---------- */
  function tilt(el) {
    if (!mark(el, 'tl') || !fine || reduce) return;
    var max = num(el.getAttribute('data-tilt'), 10) || 10;
    var g = doc.createElement('span'); g.className = 'sm-glare'; el.appendChild(g);
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.classList.add('sm-tilting');
      el.style.transform = 'perspective(900px) rotateX(' + ((0.5 - y) * max) + 'deg) rotateY(' + ((x - 0.5) * max) + 'deg) scale3d(1.02,1.02,1.02)';
      el.style.setProperty('--gx', x * 100 + '%'); el.style.setProperty('--gy', y * 100 + '%');
    });
    el.addEventListener('pointerleave', function () { el.classList.remove('sm-tilting'); el.style.transform = ''; });
  }

  /* ---------- spotlight ---------- */
  function spotlight(el) {
    if (!mark(el, 'sl')) return;
    var targets = el.children.length && el.hasAttribute('data-spotlight-group') ? Array.prototype.slice.call(el.children) : [el];
    (el.hasAttribute('data-spotlight-group') ? el : el).addEventListener('pointermove', function (e) {
      targets.forEach(function (t) { var r = t.getBoundingClientRect(); t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
    });
  }

  /* ---------- marquee ---------- */
  function marquee(el) {
    if (!mark(el, 'mq')) return;
    var sp = el.getAttribute('data-speed'); if (sp) el.style.setProperty('--sm-speed', num(sp, 32) + 's');
    var track = doc.createElement('div'); track.className = 'sm-track';
    while (el.firstChild) track.appendChild(el.firstChild);
    el.appendChild(track);
    var clone = track.cloneNode(true); clone.setAttribute('aria-hidden', 'true');
    $$('a,button,input', clone).forEach(function (n) { n.setAttribute('tabindex', '-1'); });
    el.appendChild(clone);
  }

  /* ---------- rotating words ---------- */
  function rotator(el) {
    if (!mark(el, 'ro')) return;
    var words = (el.getAttribute('data-rotate') || '').split('|').filter(Boolean); if (words.length < 2) return;
    el.textContent = '';
    var spans = words.map(function (w, i) { var s = doc.createElement('span'); s.textContent = w; if (i) s.setAttribute('aria-hidden', 'true'); else s.className = 'sm-cur'; el.appendChild(s); return s; });
    if (reduce) return;
    var i = 0, ms = num(el.getAttribute('data-interval'), 2200);
    setInterval(function () {
      var cur = spans[i]; cur.classList.remove('sm-cur'); cur.classList.add('sm-out');
      setTimeout(function () { cur.classList.remove('sm-out'); }, 600);
      i = (i + 1) % spans.length; spans[i].classList.add('sm-cur');
    }, ms);
  }

  /* ---------- scroll-linked: parallax, progress, hscroll ---------- */
  var par = [], hs = [], prog = null, ticking = false;
  function parallax(el) { if (!mark(el, 'px') || reduce) return; par.push(el); onScroll(); }
  function hscroll(el) {
    if (!mark(el, 'hs')) return;
    var track = el.querySelector('.sm-htrack');
    if (!track) { track = doc.createElement('div'); track.className = 'sm-htrack'; while (el.firstChild) track.appendChild(el.firstChild); }
    var sticky = doc.createElement('div'); sticky.className = 'sm-sticky'; sticky.appendChild(track); el.appendChild(sticky);
    var item = { el: el, track: track };
    function size() { var w = track.scrollWidth - innerWidth; item.dist = Math.max(0, w); el.style.height = (innerHeight + item.dist) + 'px'; if (innerWidth < 720 || reduce) { el.style.height = ''; sticky.style.position = 'static'; sticky.style.height = 'auto'; track.style.overflowX = 'auto'; track.style.transform = ''; item.off = true; } else { sticky.style.position = ''; sticky.style.height = ''; track.style.overflowX = ''; item.off = false; } }
    item.size = size; size(); hs.push(item);
  }
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var vh = innerHeight;
      par.forEach(function (el) { var r = el.getBoundingClientRect(); if (r.bottom < -200 || r.top > vh + 200) return; var s = num(el.getAttribute('data-parallax'), 0.2); var c = r.top + r.height / 2 - vh / 2; el.style.transform = 'translate3d(0,' + (-c * s).toFixed(1) + 'px,0)'; });
      hs.forEach(function (h) { if (h.off) return; var r = h.el.getBoundingClientRect(); var p = Math.min(1, Math.max(0, -r.top / Math.max(1, h.dist))); h.track.style.transform = 'translate3d(' + (-p * h.dist) + 'px,0,0)'; });
      if (prog) { var max = root.scrollHeight - vh; prog.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, scrollY / max) : 0) + ')'; }
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', function () { hs.forEach(function (h) { h.size(); }); onScroll(); });

  /* ---------- smooth scroll (Lenis) + cursor glow ---------- */
  var lenis = null;
  function smooth() {
    if (reduce || smooth.done) return; smooth.done = 1;
    import('https://cdn.jsdelivr.net/npm/lenis@1.1.13/+esm').then(function (m) {
      var L = m.default || m.Lenis; lenis = new L({ lerp: 0.1, smoothWheel: true });
      window.lenis = lenis; lenis.on('scroll', onScroll);
      (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
    }).catch(function () {});
  }
  function cursor() {
    if (!fine || reduce || cursor.done) return; cursor.done = 1;
    var c = doc.createElement('div'); c.className = 'sm-cursor'; c.setAttribute('aria-hidden', 'true'); doc.body.appendChild(c);
    addEventListener('pointermove', function (e) { c.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)'; }, { passive: true });
  }

  /* ---------- 3D scenes (Three.js, lazy) ---------- */
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  var threeP = null;
  function three() { return threeP || (threeP = import(THREE_URL)); }
  var NOISE = 'vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}' +
    'float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);' +
    'vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);' +
    'vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);' +
    'vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}';

  function cssColor(el, attr, varName, dflt) {
    var v = el.getAttribute(attr);
    if (!v) { try { v = getComputedStyle(el).getPropertyValue(varName).trim(); } catch (e) {} }
    return v || dflt;
  }

  function buildScene(T, host, variant, c1, c2, c3) {
    var scene = new T.Scene(), cam = new T.PerspectiveCamera(45, 1, 0.1, 100), objs = [], upd = [];
    cam.position.set(0, 0, 5.2);
    var C1 = new T.Color(c1), C2 = new T.Color(c2), C3 = new T.Color(c3);
    if (variant === 'particles' || variant === 'galaxy') {
      var N = innerWidth < 720 ? 5000 : 11000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      for (var i = 0; i < N; i++) {
        var r = Math.pow(Math.random(), 0.6) * 3.2, br = i % 3, a = r * 1.6 + (br * Math.PI * 2) / 3 + (Math.random() - 0.5) * 0.5;
        pos[i * 3] = Math.cos(a) * r + (Math.random() - 0.5) * 0.35; pos[i * 3 + 1] = (Math.random() - 0.5) * 0.45 * (1.2 - r / 3.2); pos[i * 3 + 2] = Math.sin(a) * r + (Math.random() - 0.5) * 0.35;
        var cc = C1.clone().lerp(C2, r / 3.2).lerp(C3, Math.random() * 0.3); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
      }
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3));
      var pts = new T.Points(g, new T.PointsMaterial({ size: 0.022, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: T.AdditiveBlending }));
      pts.rotation.x = 0.55; scene.add(pts); objs.push(pts);
      upd.push(function (t) { pts.rotation.y = t * 0.06; });
    } else if (variant === 'waves') {
      var geo = new T.PlaneGeometry(14, 8, 150, 90);
      var mat = new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uT: { value: 0 }, uC1: { value: C1 }, uC2: { value: C2 } },
        vertexShader: 'uniform float uT;varying float vH;varying vec2 vU;void main(){vU=uv;vec3 p=position;float h=sin(p.x*.9+uT*.8)*.28+sin(p.y*1.3+uT*.6)*.22+sin((p.x+p.y)*.6+uT)*.18;p.z+=h;vH=h;vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=2.2*(6./-mv.z);gl_Position=projectionMatrix*mv;}',
        fragmentShader: 'uniform vec3 uC1;uniform vec3 uC2;varying float vH;varying vec2 vU;void main(){vec2 c=gl_PointCoord-.5;if(length(c)>.5)discard;float edge=smoothstep(0.,.25,vU.y)*smoothstep(1.,.6,vU.y)*smoothstep(0.,.2,vU.x)*smoothstep(1.,.8,vU.x);gl_FragColor=vec4(mix(uC1,uC2,vH*1.6+.5),edge*.9);}' });
      var w = new T.Points(geo, mat); w.rotation.x = -1.15; w.position.y = -0.9; scene.add(w); objs.push(w);
      upd.push(function (t) { mat.uniforms.uT.value = t; });
    } else if (variant === 'globe') {
      var M = innerWidth < 720 ? 2600 : 5200, gp = new Float32Array(M * 3), phi = Math.PI * (3 - Math.sqrt(5));
      for (var k = 0; k < M; k++) { var y = 1 - (k / (M - 1)) * 2, rr = Math.sqrt(1 - y * y), th = phi * k; gp[k * 3] = Math.cos(th) * rr * 1.7; gp[k * 3 + 1] = y * 1.7; gp[k * 3 + 2] = Math.sin(th) * rr * 1.7; }
      var gg = new T.BufferGeometry(); gg.setAttribute('position', new T.BufferAttribute(gp, 3));
      var globe = new T.Points(gg, new T.PointsMaterial({ size: 0.018, color: C1, transparent: true, opacity: 0.9 }));
      var atm = new T.Mesh(new T.SphereGeometry(1.72, 64, 64), new T.ShaderMaterial({ transparent: true, side: T.BackSide, blending: T.AdditiveBlending, depthWrite: false, uniforms: { uC: { value: C2 } },
        vertexShader: 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position*1.18,1.);}',
        fragmentShader: 'uniform vec3 uC;varying vec3 vN;void main(){float i=pow(.75-dot(vN,vec3(0.,0.,1.)),3.);gl_FragColor=vec4(uC,1.)*i;}' }));
      var grp = new T.Group(); grp.add(globe); grp.add(atm); grp.rotation.z = 0.35; scene.add(grp); objs.push(grp);
      var arcs = new T.Group();
      for (var a2 = 0; a2 < 7; a2++) { var s1 = new T.Vector3().setFromSphericalCoords(1.7, Math.random() * Math.PI, Math.random() * Math.PI * 2), s2 = new T.Vector3().setFromSphericalCoords(1.7, Math.random() * Math.PI, Math.random() * Math.PI * 2); var mid = s1.clone().add(s2).multiplyScalar(0.5).normalize().multiplyScalar(2.4); var curve = new T.QuadraticBezierCurve3(s1, mid, s2); arcs.add(new T.Line(new T.BufferGeometry().setFromPoints(curve.getPoints(60)), new T.LineBasicMaterial({ color: C3, transparent: true, opacity: 0.7 }))); }
      globe.add(arcs);
      upd.push(function (t) { globe.rotation.y = t * 0.12; });
    } else {
      // blob / orb / rings: noise-displaced iridescent sphere (rings adds orbiting torus)
      var detail = innerWidth < 720 ? 48 : 96;
      var sg = new T.IcosahedronGeometry(1.45, Math.min(detail, 64));
      var sm = new T.ShaderMaterial({ uniforms: { uT: { value: 0 }, uC1: { value: C1 }, uC2: { value: C2 }, uC3: { value: C3 }, uAmp: { value: variant === 'orb' ? 0.12 : 0.32 } },
        vertexShader: NOISE + 'uniform float uT;uniform float uAmp;varying vec3 vN;varying float vD;varying vec3 vV;void main(){float d=snoise(normal*1.3+uT*.25)*uAmp;vD=d;vec3 p=position+normal*d;vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(p,1.);vV=-mv.xyz;gl_Position=projectionMatrix*mv;}',
        fragmentShader: 'uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uC3;uniform float uT;varying vec3 vN;varying float vD;varying vec3 vV;void main(){vec3 v=normalize(vV);float f=pow(1.-max(dot(vN,v),0.),2.2);vec3 c=mix(uC1,uC2,smoothstep(-.3,.35,vD+vN.y*.35));c=mix(c,uC3,smoothstep(.2,.9,vN.x*.5+.5)*.55);c+=f*.65;c+=pow(max(dot(reflect(-v,vN),normalize(vec3(.4,.8,.6))),0.),24.)*.5;gl_FragColor=vec4(c,1.);}' });
      var blob = new T.Mesh(sg, sm); scene.add(blob); objs.push(blob);
      upd.push(function (t) { sm.uniforms.uT.value = t; blob.rotation.y = t * 0.1; blob.rotation.z = t * 0.05; });
      if (variant === 'rings') {
        [2.15, 2.55].forEach(function (rad, n) { var tor = new T.Mesh(new T.TorusGeometry(rad, 0.012, 16, 220), new T.MeshBasicMaterial({ color: n ? C3 : C2, transparent: true, opacity: 0.8 })); tor.rotation.x = 1.2 + n * 0.3; tor.rotation.y = n * 0.5; scene.add(tor); upd.push(function (t) { tor.rotation.z = t * (n ? -0.15 : 0.2); }); });
      }
    }
    return { scene: scene, cam: cam, objs: objs, upd: upd };
  }

  function defineScene() {
    if (!window.customElements || customElements.get('stak-scene')) return;
    class Scene extends HTMLElement { connectedCallback() { mount(this); } }
    function mount(hostEl) {
      var host = hostEl; if (host.__init) return; host.__init = 1;
      host.setAttribute('aria-hidden', 'true');
      var variant = (host.getAttribute('variant') || 'blob').toLowerCase();
      var c1 = cssColor(host, 'color', '--sm-c1', '#7c3aed'), c2 = cssColor(host, 'color2', '--sm-c2', '#ec4899'), c3 = cssColor(host, 'color3', '--sm-c3', '#f97316');
      var test; try { test = doc.createElement('canvas').getContext('webgl2') || doc.createElement('canvas').getContext('webgl'); } catch (e) {}
      if (!test) { host.classList.add('sm-fallback'); return; }
      three().then(function (T) {
        var renderer;
        try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { host.classList.add('sm-fallback'); return; }
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
        host.appendChild(renderer.domElement);
        var S = buildScene(T, host, variant, c1, c2, c3), mx = 0, my = 0, tx = 0, ty = 0, visible = true, t0 = performance.now(), sc = num(host.getAttribute('scale'), 1);
        S.objs.forEach(function (o) { o.scale.setScalar(sc); });
        function size() { var w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); S.cam.aspect = w / h; S.cam.position.z = w / h < 0.8 ? 7 : 5.2; S.cam.updateProjectionMatrix(); }
        size(); try { new ResizeObserver(size).observe(host); } catch (e) { addEventListener('resize', size); }
        if (host.getAttribute('interactive') !== 'false') addEventListener('pointermove', function (e) { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
        if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) loop(); }).observe(host);
        var raf = 0, sp = num(host.getAttribute('speed'), 1);
        function frame() {
          var t = (performance.now() - t0) / 1000 * sp;
          tx += (mx - tx) * 0.05; ty += (my - ty) * 0.05;
          S.upd.forEach(function (u) { u(t); });
          S.scene.rotation.y = tx * 0.5; S.scene.rotation.x = ty * 0.35;
          renderer.render(S.scene, S.cam);
        }
        function loop() { cancelAnimationFrame(raf); if (!visible || reduce) return; frame(); raf = requestAnimationFrame(loop); }
        frame(); host.classList.add('sm-live'); loop();
        host.addEventListener('webglcontextlost', function () { host.classList.add('sm-fallback'); });
      }).catch(function () { host.classList.add('sm-fallback'); });
    }
    customElements.define('stak-scene', Scene);
  }

  /* ---------- scan ---------- */
  function scan(ctx) {
    ctx = ctx || doc;
    $$('[data-stagger]', ctx).forEach(stagger);
    $$('[data-split]', ctx).forEach(split);
    $$('[data-reveal]', ctx).forEach(reveal);
    $$('[data-count]:not([data-reveal])', ctx).forEach(function (el) { el.setAttribute('data-reveal', 'fade'); reveal(el); });
    $$('[data-magnetic]', ctx).forEach(magnetic);
    $$('[data-tilt]', ctx).forEach(tilt);
    $$('[data-spotlight],[data-spotlight-group]', ctx).forEach(spotlight);
    $$('[data-marquee]', ctx).forEach(marquee);
    $$('[data-rotate]', ctx).forEach(rotator);
    $$('[data-parallax]', ctx).forEach(parallax);
    $$('[data-hscroll]', ctx).forEach(hscroll);
    if (!prog) { var p = doc.querySelector('[data-scroll-progress]'); if (p) { prog = p; p.classList.add('sm-progress'); onScroll(); } }
    if (root.hasAttribute('data-smooth') || (doc.body && doc.body.hasAttribute('data-smooth'))) smooth();
    if (doc.body && doc.body.hasAttribute('data-cursor')) cursor();
  }
  var pend = 0;
  function boot() {
    defineScene(); scan(doc);
    try { new MutationObserver(function () { if (pend) return; pend = requestAnimationFrame(function () { pend = 0; scan(doc); }); }).observe(doc.body, { childList: true, subtree: true }); } catch (e) {}
    // Safety net: never leave content hidden if something blocks the observer
    setTimeout(function () { $$('[data-reveal]:not(.sm-in)').forEach(function (el) { var r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('sm-in'); }); }, 2500);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();

  window.StakMotion = {
    refresh: function (el) { scan(el || doc); },
    scrollTo: function (target) { var el = typeof target === 'string' ? doc.querySelector(target) : target; if (!el) return; if (lenis) lenis.scrollTo(el, { offset: -72 }); else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); },
    reduced: reduce
  };
})();
