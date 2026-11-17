/* Stak Cloud SDK — auth, database, AI, API proxy & uploads for your app */
(function(){
  if (window.stak && window.stak.__v) return;
  var cfg = window.STAK || {};
  var PID = cfg.project || '';
  var BASE = cfg.api || '';
  if (!BASE) {
    var href = location.href, i = href.indexOf('/api/site/');
    if (i > -1) { var rest = href.slice(i + 10); PID = PID || rest.split('/')[0]; BASE = href.slice(0, i) + '/api/rt/' + PID; }
  }
  var bridge = !!cfg.bridge && window.parent !== window;
  var KEY = 'stak_session_' + PID, token = null, user = null, admin = false, listeners = [];
  var LS = null; try { LS = window['loc' + 'alStorage']; LS.getItem('x'); } catch (e) { LS = null; }
  try { var saved = LS && JSON.parse(LS.getItem(KEY) || 'null'); if (saved) { token = saved.token; user = saved.user; } } catch (e) {}
  // anonymous device id: lets visitors own their docs (e.g. chat history) without signing up
  var ANON = null; try { ANON = LS && LS.getItem(KEY + '_anon'); } catch (e) {}
  if (!ANON) { ANON = 'a' + Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2); try { LS && LS.setItem(KEY + '_anon', ANON); } catch (e) {} }
  function persist(){ try { LS && (token ? LS.setItem(KEY, JSON.stringify({ token: token, user: user })) : LS.removeItem(KEY)); } catch (e) {} listeners.forEach(function(f){ try { f(user); } catch (e) {} }); }
  // builder preview: the Stak editor hands the app a short-lived, project-scoped admin token so the owner sees admin screens
  var PREVIEW = null, inFrame = window.parent !== window;
  var previewReady = new Promise(function(res){
    if (!inFrame) return res();
    var done = false, fin = function(){ if (!done) { done = true; res(); } };
    window.addEventListener('message', function(e){ var d = e.data || {}; if (e.source === window.parent && d.__stak === 'preview-admin' && typeof d.token === 'string') { PREVIEW = d.token; fin(); } });
    try { window.parent.postMessage({ __stak: 'hello', project: PID }, '*'); } catch (e) {}
    setTimeout(fin, 450);
  });
  var seq = 0, pending = {};
  if (bridge) window.addEventListener('message', function(e){
    var d = e.data || {}; var p = pending[d.id]; if (!p) return;
    if (d.__stak === 'rt-chunk') { p.onChunk && p.onChunk(d.text); }
    else if (d.__stak === 'rt-res') { delete pending[d.id]; p.resolve({ status: d.status, text: d.body }); }
  });
  function raw(method, path, body, onChunk){
    var headers = { 'Content-Type': 'application/json', 'X-Stak-Anon': ANON }; if (token) headers.Authorization = 'Bearer ' + token; if (PREVIEW) headers['X-Stak-Preview'] = PREVIEW;
    if (bridge) return new Promise(function(resolve){ var id = 'r' + (++seq); pending[id] = { resolve: resolve, onChunk: onChunk }; parent.postMessage({ __stak: 'rt', id: id, method: method, path: path, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), stream: !!onChunk }, '*'); });
    if (!BASE) return Promise.resolve({ status: 0, text: JSON.stringify({ message: 'Stak Cloud is available when the app runs on Stak' }) });
    return fetch(BASE + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(function(r){
      if (onChunk && r.body && r.ok) { var rd = r.body.getReader(), dec = new TextDecoder(), all = '';
        return (function pump(){ return rd.read().then(function(x){ if (x.done) return { status: r.status, text: all }; var t = dec.decode(x.value, { stream: true }); all += t; onChunk(t); return pump(); }); })(); }
      return r.text().then(function(t){ return { status: r.status, text: t }; });
    });
  }
  function call(method, path, body){
    return raw(method, path, body).then(function(r){ var d = null; try { d = r.text ? JSON.parse(r.text) : null; } catch (e) { d = { message: r.text }; }
      if (r.status < 200 || r.status >= 300) { var err = new Error((d && d.message) || ('Request failed (' + r.status + ')')); err.status = r.status; err.data = d; throw err; } return d; });
  }
  function qs(o){ var p = []; for (var k in o) if (o[k] !== undefined && o[k] !== null) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(typeof o[k] === 'object' ? JSON.stringify(o[k]) : o[k])); return p.length ? '?' + p.join('&') : ''; }
  var stak = {
    __v: 3, project: PID,
    auth: {
      get user(){ return user; },
      get isAdmin(){ return admin || !!(user && user.role === 'admin'); },
      get role(){ return admin ? 'admin' : (user && user.role) || (user ? 'user' : 'anon'); },
      signUp: function(o){ return call('POST', '/auth/signup', o).then(function(r){ token = r.token; user = r.user; admin = admin || !!r.admin; persist(); return user; }); },
      signIn: function(o){ return call('POST', '/auth/login', o).then(function(r){ token = r.token; user = r.user; admin = admin || !!r.admin; persist(); return user; }); },
      signOut: function(){ var p = token ? call('POST', '/auth/logout').catch(function(){}) : Promise.resolve(); token = null; user = null; admin = false; persist(); return p.then(function(){ return stak.auth.refresh().catch(function(){}); }); },
      refresh: function(){ return call('GET', '/auth/me').then(function(r){ user = r.user; admin = !!r.admin; if (!user) token = null; persist(); return user; }); },
      update: function(o){ return call('PATCH', '/auth/me', o).then(function(r){ user = r.user; persist(); return user; }); },
      onChange: function(f){ listeners.push(f); try { f(user); } catch (e) {} return function(){ listeners = listeners.filter(function(x){ return x !== f; }); }; }
    },
    db: { collection: function(name){ var b = '/db/' + encodeURIComponent(name); return {
      list: function(o){ o = o || {}; return call('GET', b + qs({ where: o.where, sort: o.sort, limit: o.limit, mine: o.mine ? 1 : undefined, q: o.search })); },
      get: function(id){ return call('GET', b + '/' + encodeURIComponent(id)); },
      add: function(doc){ return call('POST', b, doc); },
      update: function(id, patch){ return call('PATCH', b + '/' + encodeURIComponent(id), patch); },
      remove: function(id){ return call('DELETE', b + '/' + encodeURIComponent(id)); },
      subscribe: function(cb, o){ o = o || {}; var stop = false, last = null, timer = null;
        function tick(){ if (stop) return; if (typeof document !== 'undefined' && document.hidden) { timer = setTimeout(tick, 1500); return; }
          call('GET', b + qs({ where: o.where, sort: o.sort, limit: o.limit, mine: o.mine ? 1 : undefined, q: o.search })).then(function(items){ var s = JSON.stringify(items); if (s !== last) { last = s; try { cb(items); } catch (e) {} } }).catch(function(e){ o.onError && o.onError(e); }).then(function(){ if (!stop) timer = setTimeout(tick, Math.max(1000, o.interval || 2500)); }); }
        tick(); return function(){ stop = true; clearTimeout(timer); }; }
    }; } },
    ai: {
      chat: function(o){ o = o || {}; var body = { messages: o.messages, system: o.system, provider: o.provider, model: o.model, temperature: o.temperature, maxTokens: o.maxTokens };
        if (o.onToken) { body.stream = true; var acc = ''; return raw('POST', '/ai/chat', body, function(t){ acc += t; o.onToken(t, acc); }).then(function(r){ if (r.status >= 300) { var m; try { m = JSON.parse(r.text).message; } catch (e) { m = r.text; } throw new Error(m || 'AI request failed'); } return r.text || acc; }); }
        return call('POST', '/ai/chat', body).then(function(r){ return r.text; }); },
      ask: function(prompt, o){ o = o || {}; o.messages = [{ role: 'user', content: String(prompt) }]; return stak.ai.chat(o); }
    },
    fetch: function(url, o){ o = o || {}; return call('POST', '/fetch', { url: url, method: o.method, headers: o.headers, body: o.body }).then(function(r){ var data = null; try { data = JSON.parse(r.text); } catch (e) {} return { ok: r.ok, status: r.status, data: data, text: r.text, json: function(){ return Promise.resolve(data); } }; }); },
    web: { search: function(q, o){ o = o || {}; return call('POST', '/web/search', { q: q, limit: o.limit }).then(function(r){ return r.results; }); }, answer: function(q){ return call('POST', '/web/answer', { q: q }).then(function(r){ return r; }); } },
    secrets: { has: function(n){ return call('GET', '/secrets').then(function(r){ return r.names.indexOf(n) > -1; }); }, list: function(){ return call('GET', '/secrets').then(function(r){ return r.names; }); } },
    files: { upload: function(file){ return new Promise(function(res, rej){ var fr = new FileReader(); fr.onload = function(){ res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(file); }).then(function(data){ return call('POST', '/files', { name: file.name, type: file.type, data: data }); }).then(function(r){ r.url = (bridge ? (cfg.api || '') : BASE) + r.path; return r; }); } }
  };
  stak.ready = previewReady.then(function(){ return stak.auth.refresh(); }).catch(function(){ return null; });
  window.stak = stak;
})();