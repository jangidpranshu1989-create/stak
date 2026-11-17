/* AI chat app — conversations, streaming replies, markdown, mobile drawer */
(function(){
  var A = window.APP || {}, K = window.Kit, $ = K.$, esc = K.esc;
  K.theme.init(A.mode || 'light');
  document.documentElement.style.setProperty('--accent', A.accent || '#2563eb');
  if (A.accentFg) document.documentElement.style.setProperty('--accent-fg', A.accentFg);
  var T = Object.assign({ newChat: 'New chat', search: 'Search chats', today: 'Today', yesterday: 'Yesterday', week: 'Previous 7 days', older: 'Older', clear: 'Clear all chats', light: 'Light mode', dark: 'Dark mode', copy: 'Copy', copied: 'Copied', retry: 'Retry', regenerate: 'Regenerate', rename: 'Rename', del: 'Delete', thinking: 'Thinking…', online: 'Online', typing: 'Typing…', noChats: 'No chats yet', noMatch: 'No matching chats', errorMsg: 'Could not get a reply. Check your connection and try again.', deleted: 'Chat deleted', undo: 'Undo', confirmClear: 'Delete all chats?', confirmClearBody: 'This permanently removes every conversation on this device.', confirmDel: 'Delete this chat?', confirmDelBody: 'This conversation will be removed.', cancel: 'Cancel', stopped: 'Stopped' }, A.text || {});

  var els = { app: $('#app'), side: $('#side'), ov: $('#sideOv'), list: $('#convList'), q: $('#convSearch'), thread: $('#thread'), msgs: $('#msgs'), welcome: $('#welcome'), input: $('#input'), send: $('#send'), form: $('#composer'), title: $('#chatTitle'), status: $('#status'), statusText: $('#statusText'), top: document.querySelector('.top') };
  var convs = K.store.get('convs', []), cur = null, busy = false, cancelled = false;

  // ---------- static UI
  var logo = A.icon && Icon.has(A.icon) ? A.icon : 'sparkles';
  $('#brandMark').innerHTML = Icon(logo, 16); $('#welcomeMark').innerHTML = Icon(logo, 26);
  $('#brandName').textContent = A.name || 'Assistant';
  $('#greeting').textContent = A.greeting || ('Hi, I am ' + (A.name || 'your assistant'));
  $('#tagline').textContent = A.tagline || 'Ask me anything.';
  $('#disclaimer').textContent = A.disclaimer || ((A.name || 'AI') + ' can make mistakes. Check important info.');
  els.input.placeholder = A.placeholder || 'Message ' + (A.name || 'AI') + '…';
  $('#sideClose').innerHTML = Icon('x', 18); $('#menuBtn').innerHTML = Icon('menu', 20); $('#newChatTop').innerHTML = Icon('pencil', 18);
  els.send.innerHTML = Icon('arrow-up', 18);
  $('#newChat span:nth-child(2)').textContent = T.newChat; els.q.placeholder = T.search; $('#clearAll span:last-child').textContent = T.clear;
  els.statusText.textContent = T.online;
  document.title = A.name || document.title;
  (A.suggestions || []).slice(0, 4).forEach(function(s){
    var b = document.createElement('button'); b.type = 'button'; b.className = 'sug';
    b.innerHTML = '<span class="sug-ic">' + Icon(Icon.has(s.icon) ? s.icon : 'sparkles', 16) + '</span><span><b>' + esc(s.title) + '</b><span>' + esc(s.prompt) + '</span></span>';
    b.onclick = function(){ send(s.prompt); };
    $('#suggest').appendChild(b);
  });
  function paintTheme(){ var d = K.theme.get() === 'dark'; $('#themeBtn').innerHTML = Icon(d ? 'sun' : 'moon', 16) + '<span>' + (d ? T.light : T.dark) + '</span>'; }
  paintTheme();
  $('#themeBtn').onclick = function(){ K.theme.toggle(); paintTheme(); };

  // ---------- markdown (safe: escape first, then format)
  function hl(code, lang){
    var s = esc(code);
    if (/^(js|javascript|ts|typescript|jsx|tsx|py|python|java|c|cpp|go|rust|php|ruby|swift|kotlin|sql|sh|bash)$/i.test(lang || '')){
      s = s.replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`[^`]*`)/g, '<span class="s">$1</span>')
           .replace(/(\/\/[^\n]*|#(?!include)[^\n]*$)/gm, '<span class="c">$1</span>')
           .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|from|export|default|async|await|new|def|try|catch|except|in|of|public|private|static|void|int|string|true|false|null|None|True|False|SELECT|FROM|WHERE|INSERT|UPDATE|print|echo|fn|func|package)\b/g, '<span class="k">$1</span>')
           .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="n">$1</span>');
    }
    return s;
  }
  function inline(s){
    return s.replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/`([^`\n]+)`/g, function(_, c){ return '<code>' + c + '</code>'; })
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+[^\s<.,)])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }
  // nested markdown lists: deeper-indented bullets become a sub-list of the previous item
  function list(ls){
    var ind = function(x){ return x.match(/^\s*/)[0].replace(/\t/g, '    ').length; };
    var base = Math.min.apply(null, ls.filter(function(x){ return /^\s*([-*+]|\d+[.)])\s+/.test(x); }).map(ind));
    var ordered = /^\s*\d+[.)]/.test(ls[0]), items = [], cur = null;
    ls.forEach(function(x){
      if (ind(x) <= base && /^\s*([-*+]|\d+[.)])\s+/.test(x)){ cur = { t: x.replace(/^\s*([-*+]|\d+[.)])\s+/, ''), sub: [] }; items.push(cur); }
      else if (cur){ if (/^\s*([-*+]|\d+[.)])\s+/.test(x)) cur.sub.push(x); else if (cur.sub.length) cur.sub[cur.sub.length - 1] += ' ' + x.trim(); else cur.t += ' ' + x.trim(); }
    });
    var start = ordered ? parseInt(ls[0], 10) || 1 : 1;
    return (ordered ? '<ol' + (start > 1 ? ' start="' + start + '"' : '') + '>' : '<ul>') + items.map(function(it){ return '<li>' + inline(it.t) + (it.sub.length ? list(it.sub) : '') + '</li>'; }).join('') + (ordered ? '</ol>' : '</ul>');
  }
  function md(src){
    var blocks = [], out = [];
    src = String(src || '').replace(/```(\w*)[^\n]*\n([\s\S]*?)(```|$)/g, function(_, lang, code){ blocks.push({ lang: lang, code: code.replace(/\n$/, '') }); return '\u0000' + (blocks.length - 1) + '\u0000'; });
    var lines = esc(src).split('\n'), i = 0;
    while (i < lines.length){
      var l = lines[i];
      var cb = l.match(/^\u0000(\d+)\u0000$/);
      if (cb){ var b = blocks[+cb[1]]; out.push('<div class="code"><div class="code-head"><span>' + esc(b.lang || 'code') + '</span><button type="button" data-copy="' + cb[1] + '">' + Icon('copy', 13) + '<span>' + T.copy + '</span></button></div><pre><code>' + hl(b.code, b.lang) + '</code></pre></div>'); i++; continue; }
      if (/^\s*$/.test(l)){ i++; continue; }
      var h = l.match(/^(#{1,4})\s+(.*)/); if (h){ out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(l)){ out.push('<hr>'); i++; continue; }
      if (/^&gt;\s?/.test(l)){ var q = []; while (i < lines.length && /^&gt;\s?/.test(lines[i])) q.push(lines[i++].replace(/^&gt;\s?/, '')); out.push('<blockquote>' + inline(q.join('<br>')) + '</blockquote>'); continue; }
      if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])){
        var row = function(r, tag){ return '<tr>' + r.replace(/^\||\|\s*$/g, '').split('|').map(function(c){ return '<' + tag + '>' + inline(c.trim()) + '</' + tag + '>'; }).join('') + '</tr>'; };
        var t = '<table><thead>' + row(l, 'th') + '</thead><tbody>'; i += 2;
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) t += row(lines[i++], 'td');
        out.push(t + '</tbody></table>'); continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)){
        var grp = [];
        while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && grp.length))) grp.push(lines[i++]);
        out.push(list(grp)); continue;
      }
      var p = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|\u0000|&gt;|\s*([-*+]|\d+[.)])\s+|\|)/.test(lines[i])) p.push(lines[i++]);
      if (!p.length) p.push(lines[i++]);
      out.push('<p>' + inline(p.join('<br>')) + '</p>');
    }
    return { html: out.join(''), blocks: blocks };
  }

  // ---------- conversations
  function save(){ K.store.set('convs', convs.slice(0, 80)); }
  function find(id){ for (var i = 0; i < convs.length; i++) if (convs[i].id === id) return convs[i]; return null; }
  function group(t){ var d = new Date(); d.setHours(0, 0, 0, 0); var day = 864e5; if (t >= +d) return T.today; if (t >= +d - day) return T.yesterday; if (t >= +d - 7 * day) return T.week; return T.older; }
  function renderList(){
    var q = els.q.value.trim().toLowerCase();
    var items = convs.filter(function(c){ return !q || c.title.toLowerCase().indexOf(q) > -1 || c.messages.some(function(m){ return m.content.toLowerCase().indexOf(q) > -1; }); });
    if (!items.length){ els.list.innerHTML = '<div class="conv-empty">' + (q ? T.noMatch : T.noChats) + '</div>'; return; }
    var html = '', last = '';
    items.forEach(function(c){
      var g = group(c.updated); if (g !== last){ html += '<div class="conv-group">' + g + '</div>'; last = g; }
      html += '<div class="conv' + (cur && cur.id === c.id ? ' active' : '') + '" data-id="' + c.id + '" role="button" tabindex="0"><span class="conv-t">' + esc(c.title) + '</span><span class="conv-act"><button class="icon-btn sm" data-act="rename" aria-label="' + T.rename + '" title="' + T.rename + '">' + Icon('pencil', 14) + '</button><button class="icon-btn sm" data-act="del" aria-label="' + T.del + '" title="' + T.del + '">' + Icon('trash', 14) + '</button></span></div>';
    });
    els.list.innerHTML = html;
  }
  els.list.addEventListener('click', function(e){
    var row = e.target.closest('.conv'); if (!row) return;
    var c = find(row.getAttribute('data-id')); if (!c) return;
    var act = e.target.closest('[data-act]');
    if (act && act.getAttribute('data-act') === 'del'){ e.stopPropagation(); removeConv(c); return; }
    if (act && act.getAttribute('data-act') === 'rename'){ e.stopPropagation(); rename(row, c); return; }
    open(c.id); closeSide();
  });
  els.list.addEventListener('keydown', function(e){ if (e.key === 'Enter' && e.target.classList.contains('conv')) e.target.click(); });
  function rename(row, c){
    var t = row.querySelector('.conv-t'), inp = document.createElement('input'); inp.className = 'conv-rename'; inp.value = c.title; t.replaceWith(inp); inp.focus(); inp.select();
    var done = function(ok){ if (ok && inp.value.trim()){ c.title = inp.value.trim().slice(0, 80); save(); if (cur && cur.id === c.id) els.title.textContent = c.title; } renderList(); };
    inp.onkeydown = function(e){ if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    inp.onblur = function(){ done(true); };
  }
  function removeConv(c){
    var idx = convs.indexOf(c); convs.splice(idx, 1); save();
    if (cur && cur.id === c.id) newChat();
    renderList();
    K.toast(T.deleted, { action: T.undo, onAction: function(){ convs.splice(idx, 0, c); save(); renderList(); } });
  }
  function newChat(){ cur = null; els.msgs.innerHTML = ''; els.welcome.classList.remove('hidden'); els.title.textContent = T.newChat; renderList(); els.input.focus(); }
  function open(id){
    var c = find(id); if (!c) return newChat(); cur = c;
    els.welcome.classList.add('hidden'); els.title.textContent = c.title; els.msgs.innerHTML = '';
    c.messages.forEach(function(m, i){ addMsg(m, i === c.messages.length - 1); });
    renderList(); scroll(true);
  }

  // ---------- rendering messages
  function addMsg(m, last){
    var el = document.createElement('div'); el.className = 'msg ' + (m.role === 'user' ? 'user' : 'ai') + (last ? ' last' : '');
    if (m.role === 'user') el.innerHTML = '<div class="bubble-user"></div>', el.firstChild.textContent = m.content;
    else { el.innerHTML = '<div class="av">' + Icon(logo, 15) + '</div><div class="ai-body"><div class="md"></div></div>'; paint(el, m.content, false); if (m.error) showError(el); else tools(el); }
    els.msgs.appendChild(el); return el;
  }
  function paint(el, text, streaming){
    var box = el.querySelector('.md'); if (!text){ box.innerHTML = '<span class="typing" aria-label="' + T.thinking + '"><i></i><i></i><i></i></span>'; return; }
    var r = md(text); box.innerHTML = r.html; box._blocks = r.blocks;
    if (streaming){ var lastEl = box.lastElementChild; if (lastEl && !lastEl.classList.contains('code')) lastEl.classList.add('caret'); }
  }
  function tools(el){
    var body = el.querySelector('.ai-body'), old = body.querySelector('.ai-tools'); if (old) old.remove();
    var t = document.createElement('div'); t.className = 'ai-tools';
    t.innerHTML = '<button class="icon-btn" data-t="copy" aria-label="' + T.copy + '" title="' + T.copy + '">' + Icon('copy', 15) + '</button><button class="icon-btn" data-t="regen" aria-label="' + T.regenerate + '" title="' + T.regenerate + '">' + Icon('refresh', 15) + '</button>';
    body.appendChild(t);
  }
  function showError(el){
    var body = el.querySelector('.ai-body'); el.querySelector('.md').innerHTML = '';
    var e = document.createElement('div'); e.className = 'err'; e.innerHTML = Icon('alert', 16) + '<span>' + esc(T.errorMsg) + '</span><button class="btn btn-secondary btn-sm" data-t="regen">' + Icon('refresh', 14) + T.retry + '</button>';
    body.appendChild(e);
  }
  els.msgs.addEventListener('click', function(e){
    var cp = e.target.closest('[data-copy]');
    if (cp){ var box = cp.closest('.md'); K.copy(box._blocks[+cp.getAttribute('data-copy')].code); var s = cp.querySelector('span'); s.textContent = T.copied; setTimeout(function(){ s.textContent = T.copy; }, 1500); return; }
    var t = e.target.closest('[data-t]'); if (!t) return;
    var msgEl = t.closest('.msg'), idx = Array.prototype.indexOf.call(els.msgs.children, msgEl);
    if (t.getAttribute('data-t') === 'copy'){ K.copy(cur.messages[idx].content); K.toast(T.copied, { icon: 'check' }); }
    if (t.getAttribute('data-t') === 'regen' && !busy){ cur.messages.splice(idx); save(); open(cur.id); reply(); }
  });
  var stick = true;
  els.thread.addEventListener('scroll', function(){ var t = els.thread; stick = t.scrollHeight - t.scrollTop - t.clientHeight < 80; els.top.classList.toggle('scrolled', t.scrollTop > 4); });
  function scroll(force){ if (force || stick) els.thread.scrollTop = els.thread.scrollHeight; }

  // ---------- sending
  function setBusy(b){
    busy = b; els.status.classList.toggle('busy', b); els.statusText.textContent = b ? T.typing : T.online;
    els.send.classList.toggle('stop', b); els.send.innerHTML = Icon(b ? 'stop' : 'arrow-up', b ? 14 : 18); els.send.setAttribute('aria-label', b ? 'Stop' : 'Send message');
    sync();
  }
  function sync(){ els.send.disabled = !busy && !els.input.value.trim(); }
  function autosize(){ els.input.style.height = 'auto'; els.input.style.height = Math.min(200, els.input.scrollHeight) + 'px'; }
  els.input.addEventListener('input', function(){ autosize(); sync(); });
  els.input.addEventListener('keydown', function(e){ if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches){ e.preventDefault(); if (!busy) els.form.requestSubmit(); } });
  els.form.addEventListener('submit', function(e){ e.preventDefault(); if (busy){ cancelled = true; return; } send(els.input.value); });

  function send(text){
    text = String(text || '').trim(); if (!text || busy) return;
    if (!cur){ cur = { id: K.uid(), title: text.replace(/\s+/g, ' ').slice(0, 48) + (text.length > 48 ? '…' : ''), messages: [], updated: Date.now() }; convs.unshift(cur); els.welcome.classList.add('hidden'); els.title.textContent = cur.title; }
    var prev = els.msgs.querySelector('.msg.last'); if (prev) prev.classList.remove('last');
    cur.messages.push({ role: 'user', content: text }); cur.updated = Date.now();
    convs.splice(convs.indexOf(cur), 1); convs.unshift(cur); save(); renderList();
    addMsg(cur.messages[cur.messages.length - 1], false);
    els.input.value = ''; autosize(); sync(); scroll(true);
    reply();
  }
  function reply(){
    var c = cur, m = { role: 'assistant', content: '' }, el = addMsg(m, true);
    setBusy(true); cancelled = false; scroll(true);
    var history = c.messages.filter(function(x){ return !x.error; }).slice(-20).map(function(x){ return { role: x.role, content: x.content }; });
    var raf = 0, finish = function(err){
      cancelAnimationFrame(raf); setBusy(false);
      if (err && !m.content){ m.error = true; c.messages.push(m); save(); showError(el); return; }
      if (cancelled && m.content) m.content += '\n\n_' + T.stopped + '_';
      c.messages.push({ role: 'assistant', content: m.content || T.stopped }); c.updated = Date.now(); save();
      if (cur === c){ paint(el, m.content, false); tools(el); scroll(); }
    };
    var system = (A.system || 'You are a helpful assistant.') + '\n\nRules: Always reply in the same language AND script as the user\'s latest message (Hinglish in Roman letters -> reply in Roman Hinglish; never switch to Devanagari unless the user writes in it). Format answers with short paragraphs, lists, tables and fenced code blocks when useful. Never invent names, places, numbers or facts - if you are not sure, say so plainly. Do not put HTML tags in answers.';
    var lastU = ''; for (var j = history.length - 1; j >= 0; j--) if (history[j].role === 'user'){ lastU = history[j].content; break; }
    if (/[a-z]{3,}/i.test(lastU) && !/[\u0900-\u097F]/.test(lastU)) system += '\nThe user wrote in Roman (Latin) letters, so your whole reply MUST be in Roman letters - no Devanagari at all. If they wrote Hinglish, answer in natural Hinglish.';
    if (!window.stak || !stak.ai){ setTimeout(function(){ m.content = 'This assistant needs Stak Cloud AI — publish the app on Stak to chat.'; finish(); }, 400); return; }
    stak.ai.chat({ system: system, messages: history, temperature: A.temperature == null ? 0.7 : A.temperature, maxTokens: 1500, onToken: function(_, all){
      if (cancelled) return; m.content = all;
      if (!raf) raf = requestAnimationFrame(function(){ raf = 0; if (cur === c){ paint(el, m.content, true); scroll(); } });
    } }).then(function(full){ if (!cancelled && full) m.content = full; finish(); }, function(){ finish(true); });
  }

  // ---------- sidebar / shortcuts
  function openSide(){ els.app.classList.add('side-open'); }
  function closeSide(){ els.app.classList.remove('side-open'); }
  $('#menuBtn').onclick = openSide; $('#sideClose').onclick = closeSide; els.ov.onclick = closeSide;
  $('#newChat').onclick = function(){ newChat(); closeSide(); }; $('#newChatTop').onclick = function(){ newChat(); };
  els.q.addEventListener('input', renderList);
  $('#clearAll').onclick = function(){ if (!convs.length) return; K.confirm({ title: T.confirmClear, body: T.confirmClearBody, ok: T.clear, cancel: T.cancel }).then(function(ok){ if (!ok) return; convs = []; save(); newChat(); closeSide(); }); };
  document.addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); newChat(); }
    if (e.key === 'Escape') closeSide();
  });
  renderList();
  if (convs.length && A.reopenLast === true) open(convs[0].id); else newChat();
})();
