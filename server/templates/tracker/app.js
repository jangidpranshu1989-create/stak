/* Tracker / dashboard app — schema-driven records, stats, charts, filters, CSV export */
(function(){
  var A = window.APP || {}, K = window.Kit, $ = K.$, $$ = K.$$, esc = K.esc;
  K.theme.init(A.mode || 'light');
  document.documentElement.style.setProperty('--accent', A.accent || '#2563eb');
  if (A.accentFg) document.documentElement.style.setProperty('--accent-fg', A.accentFg);

  var T = Object.assign({ dashboard: 'Overview', records: 'All', settings: 'Settings', add: 'Add', edit: 'Edit', save: 'Save', saveChanges: 'Save changes', del: 'Delete', cancel: 'Cancel', search: 'Search…', all: 'All', newest: 'Newest first', oldest: 'Oldest first', highest: 'Highest first', lowest: 'Lowest first', thisMonth: 'This month', total: 'Total', count: 'Entries', avgDay: 'Daily average', budget: 'Monthly budget', budgetLeft: 'Budget left', overBudget: 'Over budget by', byCat: 'By category', trend: 'Last 6 months', daily: 'This month, by day', recent: 'Recent', viewAll: 'View all', emptyT: 'Nothing here yet', emptyB: 'Add your first entry — it takes 5 seconds.', noMatch: 'No results', noMatchB: 'Try a different search or filter.', saved: 'Saved', added: 'Added', deleted: 'Deleted', undo: 'Undo', required: 'Required', positive: 'Enter a number greater than 0', vsLast: 'vs last month', of: 'of', income: 'Income', expense: 'Expense', balance: 'Balance', theme: 'Appearance', light: 'Light', dark: 'Dark', exportCsv: 'Export CSV', exportB: 'Download all entries as a spreadsheet', importT: 'Import', importB: 'Load entries from a CSV or JSON file', imported: 'Imported', clearAll: 'Delete all data', clearB: 'Remove every entry from this device', confirmClear: 'Delete all data?', confirmClearB: 'This cannot be undone.', sample: 'You are looking at sample data so you can explore.', sampleClear: 'Clear sample data', data: 'Data', prefs: 'Preferences', budgetB: 'Get a warning before you overspend', topCat: 'Top category', done: 'Completed', pending: 'Open', thisWeek: 'This week', onDevice: 'Saved on this device' }, A.text || {});

  var F = (A.fields || []).filter(function(f){ return f && f.key; });
  var R = A.roles || {};
  var fld = function(k){ for (var i = 0; i < F.length; i++) if (F[i].key === k) return F[i]; return null; };
  R.title = R.title && fld(R.title) ? R.title : (F[0] && F[0].key);
  if (R.amount && !fld(R.amount)) R.amount = null;
  if (R.category && !fld(R.category)) R.category = null;
  if (R.done && !fld(R.done)) R.done = null;
  if (!R.date || !fld(R.date)){ R.date = 'date'; if (!fld('date')) F.push({ key: 'date', label: 'Date', type: 'date', required: true }); }
  var FLOW = !!(A.flow && R.amount);
  var catOpts = R.category ? (fld(R.category).options || []).map(function(o){ return typeof o === 'string' ? { value: o } : o; }) : [];
  var PALETTE = ['#f97316', '#3b82f6', '#10b981', '#a855f7', '#ef4444', '#eab308', '#06b6d4', '#ec4899', '#64748b', '#84cc16'];
  catOpts.forEach(function(o, i){ o.color = o.color || PALETTE[i % PALETTE.length]; o.icon = Icon.has(o.icon) ? o.icon : 'tag'; });
  var catOf = function(v){ for (var i = 0; i < catOpts.length; i++) if (catOpts[i].value === v) return catOpts[i]; return { value: v || '—', color: '#94a3b8', icon: 'tag' }; };
  var ENT = A.entity || { one: 'Entry', many: 'Entries' };
  var icon = Icon.has(A.icon) ? A.icon : 'dashboard';

  // ---------- state
  var items = K.store.get('items', null), isSample = K.store.get('sample', false);
  function shiftSeed(list){
    // keep sample data fresh: move dates so the newest sample lands on today
    if (!R.date) return list;
    var ds = list.map(function(s){ return Date.parse(s[R.date]); }).filter(function(n){ return !isNaN(n); });
    if (!ds.length) return list;
    var off = Math.round((Date.parse(K.today()) - Math.max.apply(null, ds)) / 864e5);
    if (!off) return list;
    return list.map(function(s){ var o = Object.assign({}, s), t = Date.parse(o[R.date]); if (!isNaN(t)) o[R.date] = new Date(t + off * 864e5).toISOString().slice(0, 10); return o; });
  }
  if (!items){ items = shiftSeed(A.seed || []).map(function(s, i){ var o = Object.assign({}, s); o.id = K.uid() + i; o.created = Date.now() - i * 1000; if (!o[R.date]) o[R.date] = K.today(); return o; }); isSample = items.length > 0; K.store.set('items', items); K.store.set('sample', isSample); }
  var settings = Object.assign({ budget: A.budget || 0 }, K.store.get('settings', {}));
  var now = new Date(), month = { y: now.getFullYear(), m: now.getMonth() };
  var view = 'dashboard', filter = { q: '', cat: '', sort: 'newest', status: '' }, editing = null, shown = 60;
  function save(){ K.store.set('items', items); K.store.set('sample', isSample); }

  // ---------- helpers
  var amt = function(it){ return Number(it[R.amount]) || 0; };
  var isIn = function(it){ return FLOW && it.flow === 'income'; };
  var mkey = function(d){ return String(d || '').slice(0, 7); };
  var curKey = function(){ return month.y + '-' + String(month.m + 1).padStart(2, '0'); };
  var shiftKey = function(n){ var d = new Date(month.y, month.m + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  var monthLabel = function(key, short){ var p = key.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(A.locale || 'en-IN', short ? { month: 'short' } : { month: 'short', year: 'numeric' }); };
  var inMonth = function(key){ return items.filter(function(it){ return mkey(it[R.date]) === key; }); };
  var money = function(n){ return K.money(n, A.currency); };
  var fmtVal = function(f, v){ if (v == null || v === '') return ''; if (f.type === 'money') return money(v); if (f.type === 'number') return K.num(v) + (f.unit ? ' ' + f.unit : ''); if (f.type === 'date') return K.date(v, { day: 'numeric', month: 'short', year: 'numeric' }); if (f.type === 'toggle') return v ? '✓' : ''; return String(v); };
  var sumOut = function(list){ return list.reduce(function(n, it){ return n + (isIn(it) ? 0 : amt(it)); }, 0); };
  var sumIn = function(list){ return list.reduce(function(n, it){ return n + (isIn(it) ? amt(it) : 0); }, 0); };

  // ---------- chrome
  $('#brandMark').innerHTML = Icon(icon, 16); $('#brandMarkM').innerHTML = Icon(icon, 15);
  $('#brandName').textContent = A.name || 'Tracker'; document.title = A.name || document.title;
  var addLabel = Icon('plus', 16) + '<span>' + esc(T.add + ' ' + ENT.one.toLowerCase()) + '</span>';
  $('#navAdd').innerHTML = addLabel; $('#topAdd').innerHTML = addLabel; $('#fab').innerHTML = Icon('plus', 24); $('#fab').setAttribute('aria-label', T.add);
  $('#mPrev').innerHTML = Icon('chevron-left', 16); $('#mNext').innerHTML = Icon('chevron-right', 16);
  $('#sheetClose').innerHTML = Icon('x', 18);
  $('#sampleText').textContent = T.sample; $('#sampleClear').textContent = T.sampleClear;
  var VIEWS = [{ id: 'dashboard', label: T.dashboard, icon: 'dashboard' }, { id: 'records', label: ENT.many || T.records, icon: 'list' }, { id: 'settings', label: T.settings, icon: 'sliders' }];
  $('#navLinks').innerHTML = VIEWS.map(function(v){ return '<button class="nav-link" data-view="' + v.id + '">' + Icon(v.icon, 17) + '<span>' + esc(v.label) + '</span></button>'; }).join('');
  $('#tabbar').innerHTML = VIEWS.map(function(v){ return '<button class="tab" data-view="' + v.id + '">' + Icon(v.icon, 20) + '<span>' + esc(v.label) + '</span></button>'; }).join('');
  $('#navFoot').innerHTML = '<div class="nav-link" style="cursor:default">' + Icon('shield', 16) + '<span>' + esc(T.onDevice) + '</span></div>';
  document.addEventListener('click', function(e){ var b = e.target.closest('[data-view]'); if (b) go(b.getAttribute('data-view')); });
  ['#navAdd', '#topAdd', '#fab'].forEach(function(s){ $(s).onclick = function(){ openSheet(null); }; });
  $('#mPrev').onclick = function(){ month.m--; if (month.m < 0){ month.m = 11; month.y--; } render(); };
  $('#mNext').onclick = function(){ month.m++; if (month.m > 11){ month.m = 0; month.y++; } render(); };
  $('#sampleClear').onclick = function(){ items = []; isSample = false; save(); render(); K.toast(T.deleted, { icon: 'check' }); };
  window.addEventListener('scroll', function(){ $('.top').classList.toggle('scrolled', scrollY > 4); }, { passive: true });
  function go(v){ view = v; shown = 60; render(); window.scrollTo({ top: 0 }); }

  // ---------- render
  function render(){
    $$('[data-view]').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-view') === view); });
    VIEWS.forEach(function(v){ $('#view-' + v.id).classList.toggle('hidden', v.id !== view); });
    $('#viewTitle').textContent = view === 'dashboard' ? (A.name || T.dashboard) : view === 'records' ? (ENT.many || T.records) : T.settings;
    $('#month').classList.toggle('hidden', view === 'settings');
    $('#mLabel').textContent = monthLabel(curKey());
    $('#sampleBar').classList.toggle('hidden', !isSample || !items.length || view === 'settings');
    if (view === 'dashboard') dashboard(); else if (view === 'records') records(); else settingsView();
  }

  function statCard(o){
    return '<div class="card stat' + (o.hero ? ' hero' : '') + '"><div class="stat-h"><span>' + esc(o.label) + '</span><span class="stat-ic">' + Icon(o.icon, 16) + '</span></div><div class="stat-v">' + o.value + '</div>' + (o.extra || '') + (o.sub ? '<div class="stat-s ' + (o.subCls || '') + '">' + o.sub + '</div>' : '') + '</div>';
  }
  function delta(a, b, lowerIsGood){ if (!b) return { t: '—', c: '' }; var p = Math.round((a - b) / b * 100); var up = p > 0; return { t: Icon(up ? 'trending-up' : 'trending-down', 13) + Math.abs(p) + '% ' + T.vsLast, c: lowerIsGood ? (up ? 'up' : 'down') : (up ? 'good' : 'up') }; }

  function dashboard(){
    var key = curKey(), list = inMonth(key), prev = inMonth(shiftKey(-1)), html = '<div class="stats">';
    if (R.amount){
      var out = sumOut(list), pout = sumOut(prev), d = delta(out, pout, true);
      var dim = new Date(month.y, month.m + 1, 0).getDate(), isCur = key === mkey(K.today()), days = isCur ? new Date().getDate() : dim;
      if (FLOW){
        var inc = sumIn(list);
        html += statCard({ label: T.balance, icon: 'wallet', value: money(inc - out), hero: true, sub: esc(monthLabel(key)) });
        html += statCard({ label: T.income, icon: 'trending-up', value: money(inc), sub: delta(inc, sumIn(prev), false).t, subCls: delta(inc, sumIn(prev), false).c });
        html += statCard({ label: T.expense, icon: 'trending-down', value: money(out), sub: d.t, subCls: d.c });
      } else {
        html += statCard({ label: T.thisMonth, icon: 'wallet', value: money(out), hero: true, sub: d.t, subCls: d.c });
      }
      if (settings.budget > 0 && !FLOW){
        var left = settings.budget - out, pct = Math.min(100, out / settings.budget * 100);
        html += statCard({ label: left >= 0 ? T.budgetLeft : T.overBudget, icon: 'target', value: money(Math.abs(left)), extra: '<div class="progress ' + (pct >= 100 ? 'over' : pct > 80 ? 'warn' : '') + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>', sub: Math.round(out / settings.budget * 100) + '% ' + T.of + ' ' + money(settings.budget) });
      }
      html += statCard({ label: T.avgDay, icon: 'calendar', value: money(Math.round(out / Math.max(1, days))), sub: days + ' ' + (days === 1 ? 'day' : 'days') });
      if (!FLOW && !(settings.budget > 0)) html += statCard({ label: T.count, icon: 'receipt', value: list.length, sub: monthLabel(key) });
      if (!FLOW) html += statCard({ label: R.category ? T.topCat : T.count, icon: R.category ? 'pie' : 'hash', value: R.category ? esc(topCat(list) || '—') : list.length, sub: R.category ? (topCat(list) ? money(catTotals(list)[0].v) : '') : '' });
    } else {
      var weekAgo = Date.now() - 7 * 864e5;
      html += statCard({ label: T.thisMonth, icon: icon, value: list.length, hero: true, sub: delta(list.length, prev.length, false).t, subCls: delta(list.length, prev.length, false).c });
      html += statCard({ label: T.total, icon: 'hash', value: items.length, sub: esc(ENT.many) });
      if (R.done){ var dn = items.filter(function(i){ return i[R.done]; }).length; html += statCard({ label: T.done, icon: 'check-circle', value: (items.length ? Math.round(dn / items.length * 100) : 0) + '%', extra: '<div class="progress"><i style="width:' + (items.length ? dn / items.length * 100 : 0) + '%"></i></div>', sub: dn + ' / ' + items.length }); }
      else html += statCard({ label: T.thisWeek, icon: 'calendar', value: items.filter(function(i){ return new Date(i[R.date]).getTime() >= weekAgo; }).length, sub: esc(ENT.many) });
      html += statCard({ label: R.category ? T.topCat : T.pending, icon: R.category ? 'pie' : 'clock', value: R.category ? esc(topCat(list) || '—') : items.filter(function(i){ return R.done && !i[R.done]; }).length, sub: '' });
    }
    html += '</div>';
    html += '<div class="grid2"><div class="card panel"><div class="panel-h"><h3>' + esc(R.amount ? T.trend : T.daily) + '</h3><span class="muted">' + esc(R.amount ? (FLOW ? T.expense : T.total) : T.count) + '</span></div>' + barChart() + '</div>';
    html += '<div class="card panel"><div class="panel-h"><h3>' + esc(T.byCat) + '</h3><span class="muted">' + esc(monthLabel(key)) + '</span></div>' + (R.category ? donut(list) : '<div class="empty"><p>—</p></div>') + '</div></div>';
    var recent = sorted(list, 'newest').slice(0, 6);
    html += '<div class="card list"><div class="panel" style="padding-bottom:6px"><div class="panel-h" style="margin:0"><h3>' + esc(T.recent) + '</h3>' + (list.length ? '<button class="link-btn" data-view="records">' + esc(T.viewAll) + Icon('arrow-right', 14) + '</button>' : '') + '</div></div>' + (recent.length ? recent.map(row).join('') : empty(false)) + '</div>';
    $('#view-dashboard').innerHTML = html;
  }
  function catTotals(list){ var m = {}; list.forEach(function(it){ if (isIn(it)) return; var c = it[R.category] || '—'; m[c] = (m[c] || 0) + (R.amount ? amt(it) : 1); }); return Object.keys(m).map(function(k){ return { k: k, v: m[k] }; }).sort(function(a, b){ return b.v - a.v; }); }
  function topCat(list){ var t = catTotals(list); return t.length ? t[0].k : ''; }
  function donut(list){
    var t = catTotals(list), total = t.reduce(function(n, x){ return n + x.v; }, 0);
    if (!total) return '<div class="empty"><div class="empty-ic">' + Icon('pie', 20) + '</div><p>' + esc(T.emptyT) + '</p></div>';
    var r = 52, C = 2 * Math.PI * r, off = 0, segs = '', top = t.slice(0, 6);
    if (t.length > 6) top.push({ k: 'Other', v: t.slice(6).reduce(function(n, x){ return n + x.v; }, 0), other: true });
    top.forEach(function(x){ var len = x.v / total * C, col = x.other ? '#94a3b8' : catOf(x.k).color; segs += '<circle cx="64" cy="64" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="16" stroke-dasharray="' + Math.max(0, len - 2).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"/>'; off += len; });
    var legend = top.map(function(x){ return '<div class="leg"><span class="dot" style="background:' + (x.other ? '#94a3b8' : catOf(x.k).color) + '"></span><span class="n">' + esc(x.k) + '</span><span class="v">' + (R.amount ? money(x.v) : x.v) + '</span><span class="p">' + Math.round(x.v / total * 100) + '%</span></div>'; }).join('');
    return '<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 128 128"><circle cx="64" cy="64" r="' + r + '" fill="none" stroke="var(--surface-2)" stroke-width="16"/>' + segs + '</svg><div class="donut-c"><b>' + (R.amount ? K.money(total, A.currency, { notation: 'compact' }) : total) + '</b><span>' + esc(T.total) + '</span></div></div><div class="legend">' + legend + '</div></div>';
  }
  function barChart(){
    var data = [];
    if (R.amount){ for (var i = -5; i <= 0; i++){ var k = shiftKey(i); data.push({ l: monthLabel(k, true), v: sumOut(inMonth(k)), cur: i === 0 }); } }
    else { var dim = new Date(month.y, month.m + 1, 0).getDate(), list = inMonth(curKey()); for (var d = 1; d <= dim; d++){ var ds = curKey() + '-' + String(d).padStart(2, '0'); data.push({ l: d % 5 === 1 ? String(d) : '', v: list.filter(function(it){ return String(it[R.date]).slice(0, 10) === ds; }).length, cur: ds === K.today() }); } }
    var max = Math.max.apply(null, data.map(function(x){ return x.v; }).concat([1]));
    return '<div class="bars">' + data.map(function(x){ return '<div class="bar' + (x.cur ? ' cur' : '') + '"><span class="tip">' + (R.amount ? money(x.v) : x.v) + '</span><i style="height:' + (x.v / max * 150).toFixed(1) + 'px"></i><span>' + esc(x.l) + '</span></div>'; }).join('') + '</div>';
  }
  function row(it){
    var c = R.category ? catOf(it[R.category]) : { color: 'var(--accent)', icon: icon };
    var subs = [];
    if (R.category && it[R.category]) subs.push(esc(it[R.category]));
    F.forEach(function(f){ if ([R.title, R.amount, R.category, R.date, R.done].indexOf(f.key) > -1 || f.type === 'textarea') return; var v = fmtVal(f, it[f.key]); if (v) subs.push(esc(v)); });
    var note = F.filter(function(f){ return f.type === 'textarea' && it[f.key]; })[0]; if (note) subs.push(esc(String(it[note.key]).slice(0, 60)));
    if (view === 'dashboard') subs.push(K.date(it[R.date]));
    var right = R.amount ? '<span class="row-v' + (isIn(it) ? ' in' : '') + '">' + (isIn(it) ? '+' : (FLOW ? '−' : '')) + money(amt(it)) + '</span>' : '';
    var chk = R.done ? '<span class="check' + (it[R.done] ? ' on' : '') + '" data-toggle="' + it.id + '" role="checkbox" aria-checked="' + !!it[R.done] + '">' + Icon('check', 14) + '</span>' : '';
    return '<button class="row' + (R.done && it[R.done] ? ' done' : '') + '" data-id="' + it.id + '">' + chk + '<span class="row-ic" style="background:color-mix(in oklab,' + c.color + ' 14%,transparent);color:' + c.color + '">' + Icon(c.icon, 18) + '</span><span class="row-m"><div class="row-t">' + esc(it[R.title] || '—') + '</div><div class="row-s">' + subs.join(' · ') + '</div></span>' + right + '</button>';
  }
  function empty(filtered){ return '<div class="empty"><div class="empty-ic">' + Icon(filtered ? 'search' : 'inbox', 22) + '</div><h4>' + esc(filtered ? T.noMatch : T.emptyT) + '</h4><p>' + esc(filtered ? T.noMatchB : T.emptyB) + '</p>' + (filtered ? '' : '<button class="btn btn-primary" data-add>' + Icon('plus', 16) + esc(T.add + ' ' + ENT.one.toLowerCase()) + '</button>') + '</div>'; }
  function sorted(list, s){
    return list.slice().sort(function(a, b){
      if (s === 'highest') return amt(b) - amt(a); if (s === 'lowest') return amt(a) - amt(b);
      var x = String(a[R.date]).localeCompare(String(b[R.date])) || (a.created - b.created); return s === 'oldest' ? x : -x;
    });
  }
  function records(){
    var el = $('#view-records'), q = filter.q.toLowerCase();
    var list = inMonth(curKey()).filter(function(it){
      if (filter.cat && it[R.category] !== filter.cat) return false;
      if (filter.status === 'done' && !it[R.done]) return false; if (filter.status === 'open' && it[R.done]) return false;
      if (filter.flow && (it.flow || 'expense') !== filter.flow) return false;
      if (!q) return true; return F.some(function(f){ return String(it[f.key] == null ? '' : it[f.key]).toLowerCase().indexOf(q) > -1; });
    });
    list = sorted(list, filter.sort);
    if (!el.firstChild){
      el.innerHTML = '<div class="toolbar"><label class="search">' + Icon('search', 16) + '<input class="input" id="q" type="search" placeholder="' + esc(T.search) + '" aria-label="' + esc(T.search) + '"></label><select class="select" id="sort" aria-label="Sort"><option value="newest">' + esc(T.newest) + '</option><option value="oldest">' + esc(T.oldest) + '</option>' + (R.amount ? '<option value="highest">' + esc(T.highest) + '</option><option value="lowest">' + esc(T.lowest) + '</option>' : '') + '</select></div><div class="chips" id="chips"></div><div id="recList"></div>';
      $('#q').addEventListener('input', function(e){ filter.q = e.target.value; shown = 60; records(); });
      $('#sort').addEventListener('change', function(e){ filter.sort = e.target.value; records(); });
      $('#chips').addEventListener('click', function(e){ var c = e.target.closest('[data-chip]'); if (!c) return; var k = c.getAttribute('data-k'), v = c.getAttribute('data-chip'); filter[k] = filter[k] === v ? '' : v; records(); });
    }
    var chips = '<button class="chip' + (!filter.cat && !filter.status && !filter.flow ? ' active' : '') + '" data-chip="" data-k="cat">' + esc(T.all) + '</button>';
    if (FLOW) chips += ['expense', 'income'].map(function(v){ return '<button class="chip' + (filter.flow === v ? ' active' : '') + '" data-chip="' + v + '" data-k="flow">' + esc(T[v]) + '</button>'; }).join('');
    if (R.done) chips += '<button class="chip' + (filter.status === 'open' ? ' active' : '') + '" data-chip="open" data-k="status">' + esc(T.pending) + '</button><button class="chip' + (filter.status === 'done' ? ' active' : '') + '" data-chip="done" data-k="status">' + esc(T.done) + '</button>';
    chips += catOpts.map(function(o){ return '<button class="chip' + (filter.cat === o.value ? ' active' : '') + '" data-chip="' + esc(o.value) + '" data-k="cat"><span class="dot" style="background:' + o.color + '"></span>' + esc(o.value) + '</button>'; }).join('');
    $('#chips').innerHTML = chips;
    if (!list.length){ $('#recList').innerHTML = '<div class="card">' + empty(!!(filter.q || filter.cat || filter.status || filter.flow) || items.length > 0 && !inMonth(curKey()).length ? true : false) + '</div>'; return; }
    var html = '', last = '', groups = {};
    list.forEach(function(it){ var d = String(it[R.date]).slice(0, 10); groups[d] = (groups[d] || 0) + (isIn(it) ? 0 : (R.amount ? amt(it) : 1)); });
    list.slice(0, shown).forEach(function(it){
      var d = String(it[R.date]).slice(0, 10);
      if (filter.sort !== 'highest' && filter.sort !== 'lowest' && d !== last){ html += '<div class="day"><span>' + K.date(d, { weekday: 'short', day: 'numeric', month: 'short' }) + '</span><span class="num">' + (R.amount ? money(groups[d]) : groups[d]) + '</span></div>'; last = d; }
      html += row(it);
    });
    if (list.length > shown) html += '<div class="more-row"><button class="btn btn-secondary btn-sm" id="more">+' + (list.length - shown) + '</button></div>';
    $('#recList').innerHTML = '<div class="card list">' + html + '</div>';
    var mb = $('#more'); if (mb) mb.onclick = function(){ shown += 100; records(); };
  }
  function settingsView(){
    var html = '<div class="section-t">' + esc(T.prefs) + '</div><div class="card set-list">';
    html += '<div class="set"><div class="set-m"><div class="set-t">' + esc(T.theme) + '</div></div><div class="seg" style="width:180px"><button data-theme-set="light" class="' + (K.theme.get() === 'light' ? 'on' : '') + '">' + esc(T.light) + '</button><button data-theme-set="dark" class="' + (K.theme.get() === 'dark' ? 'on' : '') + '">' + esc(T.dark) + '</button></div></div>';
    if (R.amount && !FLOW) html += '<div class="set"><div class="set-m"><div class="set-t">' + esc(T.budget) + '</div><div class="set-s">' + esc(T.budgetB) + '</div></div><div class="input-group" style="width:180px"><span class="prefix">' + esc(currencySymbol()) + '</span><input class="input num" id="budget" type="number" inputmode="decimal" min="0" step="any" value="' + (settings.budget || '') + '" placeholder="0"></div></div>';
    html += '</div><div class="section-t">' + esc(T.data) + '</div><div class="card set-list">';
    html += '<div class="set"><div class="set-m"><div class="set-t">' + esc(T.exportCsv) + '</div><div class="set-s">' + esc(T.exportB) + ' · ' + items.length + '</div></div><button class="btn btn-secondary btn-sm" id="exp">' + Icon('download', 15) + esc(T.exportCsv) + '</button></div>';
    html += '<div class="set"><div class="set-m"><div class="set-t">' + esc(T.importT) + '</div><div class="set-s">' + esc(T.importB) + '</div></div><button class="btn btn-secondary btn-sm" id="imp">' + Icon('upload', 15) + esc(T.importT) + '</button></div>';
    html += '<div class="set"><div class="set-m"><div class="set-t" style="color:var(--danger)">' + esc(T.clearAll) + '</div><div class="set-s">' + esc(T.clearB) + '</div></div><button class="btn btn-secondary btn-sm" id="clr" style="color:var(--danger)">' + Icon('trash', 15) + esc(T.del) + '</button></div></div>';
    $('#view-settings').innerHTML = html;
    $$('[data-theme-set]').forEach(function(b){ b.onclick = function(){ K.theme.set(b.getAttribute('data-theme-set')); settingsView(); }; });
    var bi = $('#budget'); if (bi) bi.onchange = function(){ settings.budget = Math.max(0, Number(bi.value) || 0); K.store.set('settings', settings); K.toast(T.saved, { icon: 'check' }); };
    $('#exp').onclick = exportCsv; $('#imp').onclick = function(){ $('#importFile').click(); };
    $('#clr').onclick = function(){ K.confirm({ title: T.confirmClear, body: T.confirmClearB, ok: T.del, cancel: T.cancel }).then(function(ok){ if (ok){ items = []; isSample = false; save(); render(); K.toast(T.deleted, { icon: 'check' }); } }); };
  }
  function currencySymbol(){ try { return (0).toLocaleString(A.locale || 'en-IN', { style: 'currency', currency: A.currency || 'INR', maximumFractionDigits: 0 }).replace(/[\d\s.,]/g, '') || '₹'; } catch (e) { return '₹'; } }
  function csvCell(v){ v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCsv(){
    var cols = F.map(function(f){ return f.key; }); if (FLOW) cols.unshift('flow');
    var lines = [cols.map(function(k){ var f = fld(k); return csvCell(f ? f.label : k); }).join(',')].concat(sorted(items, 'newest').map(function(it){ return cols.map(function(k){ return csvCell(it[k]); }).join(','); }));
    K.download((A.id || 'data') + '-' + K.today() + '.csv', '\ufeff' + lines.join('\n'), 'text/csv');
  }
  $('#importFile').addEventListener('change', function(e){
    var file = e.target.files[0]; if (!file) return; var fr = new FileReader();
    fr.onload = function(){
      var txt = String(fr.result).replace(/^\ufeff/, ''), rows = [];
      try {
        if (/^\s*[\[{]/.test(txt)){ var j = JSON.parse(txt); rows = Array.isArray(j) ? j : (j.items || []); }
        else {
          var parse = function(s){ var out = [], row = [], cell = '', q = false; for (var i = 0; i < s.length; i++){ var ch = s[i]; if (q){ if (ch === '"' && s[i + 1] === '"'){ cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === ','){ row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; } else cell += ch; } if (cell || row.length){ row.push(cell); out.push(row); } return out; };
          var g = parse(txt), head = g.shift() || [];
          var keys = head.map(function(h){ h = h.trim(); var f = F.filter(function(x){ return x.label === h || x.key === h; })[0]; return f ? f.key : (h === 'flow' ? 'flow' : null); });
          rows = g.filter(function(r){ return r.some(function(c){ return c; }); }).map(function(r){ var o = {}; keys.forEach(function(k, i){ if (k) o[k] = r[i]; }); return o; });
        }
      } catch (err) { rows = []; }
      var n = 0;
      rows.forEach(function(r){ if (!r || !r[R.title]) return; var o = { id: K.uid() + n, created: Date.now() }; F.forEach(function(f){ var v = r[f.key]; if (f.type === 'money' || f.type === 'number') v = Number(v) || 0; if (f.type === 'toggle') v = v === true || v === 'true' || v === '1' || v === '✓'; o[f.key] = v == null ? '' : v; }); if (FLOW) o.flow = r.flow === 'income' ? 'income' : 'expense'; if (!o[R.date]) o[R.date] = K.today(); items.push(o); n++; });
      if (n){ if (isSample){ isSample = false; } save(); render(); }
      K.toast(T.imported + ': ' + n, { icon: n ? 'check' : 'alert' }); e.target.value = '';
    };
    fr.readAsText(file);
  });

  // ---------- list interactions
  document.addEventListener('click', function(e){
    if (e.target.closest('[data-add]')) return openSheet(null);
    var tg = e.target.closest('[data-toggle]');
    if (tg){ e.stopPropagation(); var it = byId(tg.getAttribute('data-toggle')); if (it){ it[R.done] = !it[R.done]; isSample = false; save(); render(); } return; }
    var r = e.target.closest('.row[data-id]'); if (r){ var x = byId(r.getAttribute('data-id')); if (x) openSheet(x); }
  });
  function byId(id){ for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; }

  // ---------- sheet (add / edit)
  var sheet = $('#sheet'), ov = $('#sheetOv'), draft = {};
  function openSheet(it){
    editing = it; draft = it ? Object.assign({}, it) : { flow: 'expense' };
    if (!it){ F.forEach(function(f){ if (f.default != null) draft[f.key] = f.default; }); draft[R.date] = K.today(); if (R.category && catOpts[0] && fld(R.category).required !== false) draft[R.category] = catOpts[0].value; }
    $('#sheetTitle').textContent = (it ? T.edit : T.add) + ' ' + ENT.one.toLowerCase();
    $('#sheetSave').textContent = it ? T.saveChanges : T.save;
    $('#sheetDel').innerHTML = it ? Icon('trash', 15) + esc(T.del) : esc(T.cancel);
    var html = '';
    if (FLOW) html += '<div class="seg" role="tablist">' + ['expense', 'income'].map(function(v){ return '<button type="button" data-flow="' + v + '" class="' + (draft.flow === v ? 'on' : '') + '">' + esc(T[v]) + '</button>'; }).join('') + '</div>';
    orderF().forEach(function(f){ html += fieldHtml(f, draft[f.key]); });
    $('#sheetBody').innerHTML = html;
    ov.classList.add('open'); sheet.classList.add('open');
    setTimeout(function(){ var first = $('#sheetBody .input, #sheetBody .textarea'); if (first && matchMedia('(hover: hover)').matches) first.focus(); }, 280);
  }
  function orderF(){ return F.slice().sort(function(a, b){ return (b.key === R.amount) - (a.key === R.amount); }); }
  function fieldHtml(f, v){
    var id = 'f_' + f.key, req = f.required ? ' required' : '', lab = '<label class="label" for="' + id + '">' + esc(f.label || f.key) + (f.required ? '' : ' <span class="hint">(optional)</span>') + '</label>', err = '<div class="error-text hidden" data-err="' + f.key + '"></div>';
    var val = v == null ? '' : esc(v);
    if (f.type === 'select'){
      var opts = (f.options || []).map(function(o){ return typeof o === 'string' ? { value: o } : o; });
      if (f.key === R.category) return '<div class="field"><span class="label">' + esc(f.label) + '</span><div class="opt-grid" data-key="' + f.key + '">' + catOpts.map(function(o){ return '<button type="button" class="opt' + (v === o.value ? ' on' : '') + '" data-val="' + esc(o.value) + '"><span class="o-ic" style="background:color-mix(in oklab,' + o.color + ' 16%,transparent);color:' + o.color + '">' + Icon(o.icon, 13) + '</span>' + esc(o.value) + '</button>'; }).join('') + '</div>' + err + '</div>';
      return '<div class="field">' + lab + '<select class="select" id="' + id + '" data-key="' + f.key + '"' + req + '><option value="">—</option>' + opts.map(function(o){ return '<option' + (v === o.value ? ' selected' : '') + '>' + esc(o.value) + '</option>'; }).join('') + '</select>' + err + '</div>';
    }
    if (f.type === 'textarea') return '<div class="field">' + lab + '<textarea class="textarea" id="' + id + '" data-key="' + f.key + '" rows="3" placeholder="' + esc(f.placeholder || '') + '"' + req + '>' + val + '</textarea>' + err + '</div>';
    if (f.type === 'toggle') return '<label class="toggle"><span class="label">' + esc(f.label) + '</span><input type="checkbox" data-key="' + f.key + '"' + (v ? ' checked' : '') + '></label>';
    if (f.type === 'money') return '<div class="field">' + lab + '<div class="input-group"><span class="prefix big">' + esc(currencySymbol()) + '</span><input class="input amount-input" id="' + id + '" data-key="' + f.key + '" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="' + val + '"' + req + '></div>' + err + '</div>';
    var type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : 'text';
    return '<div class="field">' + lab + '<input class="input" id="' + id + '" data-key="' + f.key + '" type="' + type + '"' + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + ' placeholder="' + esc(f.placeholder || '') + '" value="' + val + '"' + req + ' maxlength="200">' + err + '</div>';
  }
  $('#sheetBody').addEventListener('click', function(e){
    var o = e.target.closest('.opt'); if (o){ var g = o.closest('[data-key]'); $$('.opt', g).forEach(function(x){ x.classList.toggle('on', x === o); }); draft[g.getAttribute('data-key')] = o.getAttribute('data-val'); var er = $('[data-err="' + g.getAttribute('data-key') + '"]'); if (er) er.classList.add('hidden'); }
    var fl = e.target.closest('[data-flow]'); if (fl){ draft.flow = fl.getAttribute('data-flow'); $$('[data-flow]').forEach(function(x){ x.classList.toggle('on', x === fl); }); }
  });
  $('#sheetBody').addEventListener('input', function(e){ var k = e.target.getAttribute('data-key'); if (!k) return; e.target.classList.remove('invalid'); var er = $('[data-err="' + k + '"]'); if (er) er.classList.add('hidden'); });
  function closeSheet(){ sheet.classList.remove('open'); ov.classList.remove('open'); editing = null; }
  ov.onclick = closeSheet; $('#sheetClose').onclick = closeSheet;
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet(); if (e.key === 'n' && !sheet.classList.contains('open') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){ e.preventDefault(); openSheet(null); } });
  $('#sheetDel').onclick = function(){
    if (!editing) return closeSheet();
    var it = editing, idx = items.indexOf(it); items.splice(idx, 1); save(); closeSheet(); render();
    K.toast(T.deleted, { action: T.undo, onAction: function(){ items.splice(idx, 0, it); save(); render(); } });
  };
  sheet.addEventListener('submit', function(e){
    e.preventDefault();
    var ok = true, firstBad = null;
    $$('[data-key]', $('#sheetBody')).forEach(function(el){
      var k = el.getAttribute('data-key'), f = fld(k); if (!f || el.classList.contains('opt-grid')) return;
      var v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (f.type === 'money' || f.type === 'number') v = v === '' ? '' : Number(v);
      draft[k] = v;
    });
    orderF().forEach(function(f){
      var v = draft[f.key], bad = '';
      if (f.required && (v === '' || v == null)) bad = T.required;
      else if (f.type === 'money' && f.required && !(Number(v) > 0)) bad = T.positive;
      if (bad){ ok = false; var er = $('[data-err="' + f.key + '"]'); if (er){ er.textContent = bad; er.classList.remove('hidden'); } var inp = $('#f_' + f.key); if (inp){ inp.classList.add('invalid'); firstBad = firstBad || inp; } }
    });
    if (!ok){ if (firstBad) firstBad.focus(); return; }
    if (isSample){ isSample = false; }
    if (editing){ Object.assign(editing, draft); K.toast(T.saved, { icon: 'check' }); }
    else { draft.id = K.uid(); draft.created = Date.now(); items.push(draft); K.toast(T.added, { icon: 'check' }); var dk = mkey(draft[R.date]); var p = dk.split('-'); if (p.length === 2){ month.y = +p[0]; month.m = +p[1] - 1; } }
    save(); closeSheet(); render();
  });

  render();
})();
