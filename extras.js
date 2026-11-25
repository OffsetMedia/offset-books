/*
 * Offset Books: additions on top of the original screen (legacy.js).
 * Split bills, documents read by Claude, Claude's inbox, phone "More" page and nav icons.
 * Loaded before legacy.js; everything here reads the legacy globals (DATA, state, go, toast...) at call time.
 */
(function () {
  'use strict';
  var OBX = window.OBX = {};
  var inbox = { messages: [], weekly: false, loaded: false, sel: '' };
  var up = { total: 0, done: 0, failed: [] };
  var SECONDARY = ['vendors', 'bank', 'pay', 'clients', 'crew', 'settings'];
  var ASSIGNABLE = ['Equipment rental', 'Crew / freelancer', 'Location & venue'];
  var PAY_METHODS = ['Bank transfer', 'Debit card', 'Cash', 'Cheque', 'Not paid yet'];

  /* ---------- small helpers ---------- */
  function e_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n_(v) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function m_(v) { return n_(v).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function m0(v) { return Math.round(n_(v)).toLocaleString('en-US'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function $(id) { return document.getElementById(id); }
  function admin() { return window.ROLE === 'admin'; }
  function api(fn, args) { return window.OBAPI(fn, args || []); }
  function rerender() { try { window.C = compute(); } catch (x) { /* ignore */ } go(state.view); }
  function say(msg, ok) { toast(msg, ok); }
  function uniq(a) { var s = {}, o = []; a.forEach(function (v) { v = String(v == null ? '' : v).trim(); if (v && !s[v]) { s[v] = 1; o.push(v); } }); return o.sort(function (x, y) { return x.localeCompare(y); }); }
  function findEntry(id) { return (DATA.entries || []).filter(function (e) { return String(e.id) === String(id); })[0]; }
  function project(id) { return (DATA.projects || []).filter(function (p) { return String(p.id) === String(id); })[0]; }
  function costTypes() {
    var c = (DATA.costmap || []).map(function (r) { return r.cost_type; }).filter(Boolean);
    if (!c.length) c = String((DATA.settings || {}).cost_types || 'Equipment rental|Crew / freelancer|Transport|Food|Location & venue|Other|Staff & salaries|Office, software & bills').split('|');
    return c;
  }
  function accountFor(e) {
    var row = (DATA.costmap || []).filter(function (r) { return r.cost_type === e.cost_type; })[0];
    if (!row) return '';
    return String((e.project ? (row.project_account || row.overhead_account) : (row.overhead_account || row.project_account)) || '');
  }
  function projOptions(sel) {
    var ps = (DATA.projects || []).slice().sort(function (a, b) { return String(b.start || '').localeCompare(String(a.start || '')); });
    return '<option value="">No project (company overhead)</option>' + ps.map(function (p) {
      return '<option value="' + e_(p.id) + '"' + (String(sel) === String(p.id) ? ' selected' : '') + '>' + e_(p.name) + '</option>';
    }).join('');
  }
  function opts(list, sel) {
    var has = list.indexOf(sel) !== -1;
    return (!has && sel ? '<option selected>' + e_(sel) + '</option>' : '') + list.map(function (v) { return '<option' + (v === sel ? ' selected' : '') + '>' + e_(v) + '</option>'; }).join('');
  }
  function fld(label, html, cls) { return '<div class="fld' + (cls ? ' ' + cls : '') + '"><label>' + e_(label) + '</label>' + html + '</div>'; }
  function inp(name, val, attrs) { return '<input class="f" name="' + name + '" value="' + e_(val == null ? '' : val) + '" ' + (attrs || '') + '>'; }
  function form(f) { var o = {}; Array.prototype.forEach.call(f.elements, function (el) { if (el.name) o[el.name] = el.type === 'checkbox' ? el.checked : String(el.value).trim(); }); return o; }
  function payees() { return uniq((DATA.entries || []).map(function (e) { return e.payee; })); }
  function dl(id, list) { return '<datalist id="' + id + '">' + list.map(function (v) { return '<option value="' + e_(v) + '">'; }).join('') + '</datalist>'; }

  /* ---------- icons (nav) ---------- */
  var ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    inbox: '<path d="M4 5h16v11H4z"/><path d="M4 12h4.5l1.5 2h4l1.5-2H20"/><path d="M9 20h6"/>',
    projects: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
    entries: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    vendors: '<path d="M4 10h16v10H4z"/><path d="M3 10l2-5h14l2 5"/><path d="M10 20v-5h4v5"/>',
    bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/>',
    pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',
    docs: '<path d="M6 3h9l4 4v14H6z"/><path d="M14.5 3v4.5H19M9 12h7M9 16h5"/>',
    clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
    crew: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20c1-4 3.6-6 7-6s6 2 7 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };
  OBX.icon = function (id) { return ICONS[id] ? '<svg class="nico" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[id] + '</svg>' : ''; };
  OBX.isSecondary = function (v) { return SECONDARY.indexOf(v) !== -1 && window.innerWidth <= 820; };

  OBX.vMore = function () {
    var items = NAV.filter(function (n) { return (n.sec || n.deskonly) && n.roles.indexOf(ROLE) >= 0; });
    var chev = '<svg class="gl-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    return '<div class="head"><div><span class="mono">Offset Books</span><h1>More</h1></div></div>' +
      '<div class="gl-group">' + items.map(function (n) { return '<a class="gl-row" data-view="' + n.id + '" tabindex="0"><span class="gl-ico">' + OBX.icon(n.id) + '</span><span class="gl-lbl">' + e_(n.label) + '</span>' + (n.id === 'inbox' && OBX.unread() ? '<span class="navbadge">' + OBX.unread() + '</span>' : '') + chev + '</a>'; }).join('') + '</div>' +
      '<div class="gl-title">Appearance</div><div class="gl-group gl-pad">' + themeSeg() + '</div>' +
      '<div class="gl-title">Account</div><div class="gl-group"><div class="gl-row gl-static"><span class="gl-lbl">' + e_(DATA.user.name || DATA.user.email) + '<small>' + e_(DATA.user.email) + ' · ' + e_(ROLE) + '</small></span></div>' +
      '<button class="gl-row" data-obx="refresh"><span class="gl-lbl">Refresh data</span>' + chev + '</button><button class="gl-row gl-danger" data-obx="signout"><span class="gl-lbl">Sign out</span></button></div>' +
      '<p class="note gl-foot">Install: on iPhone, Safari › Share › Add to Home Screen. On a Mac or PC, Chrome or Edge › Install Offset Books.</p>';
  };


  /* ---------- light / dark theme ---------- */
  function savedTheme() { try { return localStorage.getItem('ob_theme') || 'dark'; } catch (x) { return 'dark'; } }
  function applyTheme(pref) {
    var t = pref === 'auto' ? ((window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark') : pref;
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t === 'light' ? '#E9E7E3' : '#121315');
  }
  OBX.setTheme = function (pref) { try { localStorage.setItem('ob_theme', pref); } catch (x) { /* ignore */ } applyTheme(pref); if (window.state) go(state.view); };
  if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (savedTheme() === 'auto') applyTheme('auto'); }); } catch (x) { /* old Safari */ } }
  OBX.themeToggle = function () {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    return '<button class="obx-themebtn" data-obx="theme-flip" title="' + (light ? 'Switch to dark' : 'Switch to light') + '" aria-label="' + (light ? 'Switch to dark theme' : 'Switch to light theme') + '">' +
      (light ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>') +
      '<span>' + (light ? 'Dark' : 'Light') + '</span></button>';
  };
  OBX.themeSeg = themeSeg;
  function themeSeg() {
    var p = savedTheme();
    return '<div class="obx-seg" role="group" aria-label="Theme">' + [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match device']].map(function (o) {
      return '<button class="chip' + (p === o[0] ? ' on' : '') + '" data-obx="theme" data-theme-pref="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }


  /* ---------- phone: app bar, list rows, quick create, grouped More ---------- */
  var TITLES = { dashboard: 'Home', inbox: 'Inbox', projects: 'Projects', project: 'Project', entries: 'Entries', vendors: 'Vendors', bank: 'Bank', pay: 'Payments', docs: 'Invoices', doc: 'Invoice', edit: 'Editor', clients: 'Clients', crew: 'Crew', settings: 'Settings', more: 'More' };
  function ensureAppBar() {
    if ($('obx-appbar')) return;
    var bar = document.createElement('header'); bar.id = 'obx-appbar';
    bar.innerHTML = '<div class="ab-brand"><span class="ab-mark" aria-hidden="true">O</span><span class="ab-txt"><span class="ab-co">Offset Books</span><b id="ab-title">Home</b></span></div>' +
      '<div class="ab-actions">' + (admin() ? '<button class="ab-btn" data-view="inbox" aria-label="Claude inbox"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg><span class="ab-dot" id="ab-dot" hidden></span></button>' : '') + '</div>';
    var shell = $('shell'); shell.insertBefore(bar, shell.firstChild);
  }
  function updateAppBar(v) {
    ensureAppBar();
    var t = $('ab-title'); if (t) t.textContent = TITLES[v] || 'Offset Books';
    var dot = $('ab-dot'), n = OBX.unread(); if (dot) { dot.hidden = !n; dot.textContent = n > 9 ? '9+' : n; }
    var bell = document.querySelector('#obx-appbar [data-view=inbox]'); if (bell) bell.classList.toggle('on', v === 'inbox');
  }
  /** Runs after every page draws: tags list cells so phones can show tables as clean rows. */
  OBX.afterGo = function (v) {
    document.body.setAttribute('data-obview', v);
    if (v === 'inbox' && inbox.restore) { var rs = inbox.restore; inbox.restore = null; if (Date.now() - rs.t < 600000) setTimeout(function () { window.scrollTo(0, rs.y); }, 0); }
    updateAppBar(v);
    Array.prototype.forEach.call(document.querySelectorAll('#main .tablewrap table'), function (t) {
      if (t.classList.contains('kv')) return;
      var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
      Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
        var cells = Array.prototype.slice.call(tr.children); if (cells.length < 2) { tr.classList.add('lr-full'); return; }
        tr.classList.add('lr');
        var title = tr.querySelector('td.name') || cells.filter(function (td) { return td.querySelector('b') && !td.classList.contains('r'); })[0] || cells[0];
        var pri = tr.querySelector('td.amt') || tr.querySelector('td.r');
        cells.forEach(function (td, i) {
          if (heads[i]) td.setAttribute('data-label', heads[i]);
          td.classList.toggle('lr-t', td === title); td.classList.toggle('lr-p', td === pri && td !== title);
        });
      });
    });
  };
  OBX.quickCreate = function () {
    if (!admin()) return '';
    var I = { inv: '<path d="M6 3h9l4 4v14H6z"/><path d="M14.5 3v4.5H19M9 12h7M9 16h5"/>', qt: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/>', cost: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 9h6M9 13h4"/>', up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>' };
    function tile(icon, label, attrs) { return '<button class="qc-tile" ' + attrs + '><span class="qc-ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + I[icon] + '</svg></span><span>' + label + '</span></button>'; }
    return '<section class="qc phoneonly-b"><div class="qc-h"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>Quick create</div><div class="qc-row">' +
      tile('inv', 'Invoice', 'data-act="new-inv"') + tile('qt', 'Quote', 'data-act="new-qt"') + tile('cost', 'Cost', 'data-act="new-entry"') + tile('up', 'Upload bills', 'data-obx="upload"') + '</div></section>';
  };

  /* ---------- bills read by Claude ---------- */
  var parsed = {};
  OBX.reviews = function () {
    return (DATA.approvals || []).filter(function (a) { return a.source === 'bill_upload' && a.status === 'pending'; }).map(function (a) {
      if (!parsed[a.id]) { var s = a.suggestion; if (typeof s === 'string') { try { s = JSON.parse(s); } catch (x) { s = {}; } } parsed[a.id] = s || {}; }
      a._s = parsed[a.id]; return a;
    });
  };
  function unassigned() {
    return (DATA.entries || []).filter(function (e) {
      return e.kind === 'cost' && e.business_line !== 'AI data' && !e.project && e.allocation !== 'overhead' &&
        (ASSIGNABLE.indexOf(e.cost_type) !== -1 || /^5/.test(String(e.account)));
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  }

  OBX.addMenu = function () {
    return '<div class="btnrow obx-addwrap"><button class="btn primary" data-obx="addmenu" aria-haspopup="true">+ Add</button>' +
      '<div class="obx-menu" id="obx-menu" hidden>' +
      '<button data-act="new-entry"><b>Cost or income</b><span>One line, with its receipt</span></button>' +
      '<button data-obx="split-new"><b>Split bill</b><span>One supplier bill across several projects</span></button>' +
      '<button data-obx="upload"><b>Upload documents</b><span>Claude reads and sorts them for you</span></button></div></div>';
  };

  OBX.vAi = function () {
    var rq = OBX.reviews(), un = unassigned(), busy = up.total > 0;
    var h = '<label class="obx-drop' + (busy ? ' busy' : '') + '" id="obx-drop"><input type="file" id="obx-files" accept="application/pdf,image/*" multiple hidden>' +
      '<span class="obx-droptitle">' + (busy ? 'Reading ' + Math.min(up.done + 1, up.total) + ' of ' + up.total + '…' : 'Upload supplier bills') + '</span>' +
      '<span class="note">' + (busy ? 'Claude is reading each document. You can keep working.' : 'PDFs or photos, several at once. Claude reads each one, suggests the project for every line using your shoot calendar and past bills, and finds the bank payment it belongs to. Nothing is booked until you approve it.') + '</span>' +
      (busy ? '<span class="bar" style="width:100%;max-width:320px"><i style="width:' + Math.round(up.done / up.total * 100) + '%"></i></span>' : '') + '</label>';
    h += '<div class="obx-sec"><div class="obx-sechead"><h2>Waiting for you</h2>' + (rq.length ? '<button class="btn primary" data-obx="review-start">Review one by one</button>' : '') + '</div>';
    if (!rq.length) h += '<div class="tablewrap"><div class="empty">No bills waiting. Upload some above.</div></div>';
    else h += '<div class="tablewrap"><table class="etbl"><thead><tr><th>Bill date</th><th>Supplier</th><th>Split</th><th>Claude</th><th class="r">Total</th></tr></thead><tbody>' + rq.map(function (r, i) {
      var s = r._s, conf = s.confidence || 'unsure';
      return '<tr class="click" data-obxrev="' + i + '" tabindex="0"><td>' + e_(s.date || '-') + '</td><td class="name"><b>' + e_(s.payee || s.supplier || 'Unknown') + '</b><small>' + e_(s.doc_number || 'no invoice no.') + '</small></td>' +
        '<td class="wrap">' + e_((s.lines || []).map(function (l) { var p = project(l.project); return p ? p.name : 'Overhead'; }).filter(function (v, k, a) { return a.indexOf(v) === k; }).join(', ') || '-') + '</td>' +
        '<td><span class="tag ' + (conf === 'high' ? 'good' : conf === 'medium' ? 'info' : 'warn') + '">' + e_(conf) + '</span></td><td class="r num amt">' + m0(s.total) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    h += '</div><div class="obx-sec"><div class="obx-sechead"><h2>Costs with no project</h2><button class="btn" data-obx="split-new">Split a bill</button></div>' +
      '<p class="note" style="margin:-4px 0 10px">Rental, crew and studio payments that came in without a project.</p>';
    if (!un.length) h += '<div class="tablewrap"><div class="empty">Nothing waiting.</div></div>';
    else h += '<div class="tablewrap"><table class="etbl"><tbody>' + un.map(function (e) {
      return '<tr><td>' + e_(e.date) + '</td><td class="name"><b>' + e_(e.payee) + '</b><small>' + e_(e.description || '') + '</small></td><td class="r num amt">' + m0(e.amount) + '</td>' +
        '<td class="r"><div class="btnrow" style="justify-content:flex-end"><button class="chip on" data-obxsplit="' + e_(e.id) + '">Assign or split</button><button class="chip" data-obxover="' + e_(e.id) + '">It\'s overhead</button></div></td></tr>';
    }).join('') + '</tbody></table></div>';
    return h + '</div>';
  };

  /* ---------- modal (separate from the legacy one so both can coexist) ---------- */
  function openM(title, body, wide, mount) {
    closeM();
    var el = document.createElement('div'); el.id = 'obx-modal';
    el.innerHTML = '<div class="mback" data-obx="close"></div><div class="mbox' + (wide ? ' obx-xwide' : '') + '" role="dialog" aria-modal="true" aria-label="' + e_(title) + '">' +
      '<div class="obx-mhead"><h2>' + e_(title) + '</h2><button class="obx-x" data-obx="close" aria-label="Close">&times;</button></div>' + body + '</div>';
    document.body.appendChild(el); document.body.classList.add('obx-noscroll');
    if (mount) mount(el);
  }
  function closeM() { var m = $('obx-modal'); if (m) m.remove(); document.body.classList.remove('obx-noscroll'); }

  /* ---------- split bill / review form ---------- */
  OBX.openBillFor = function (entry) {
    if (!entry) return;
    var group = entry.bill_id ? DATA.entries.filter(function (x) { return x.bill_id === entry.bill_id; }) : [entry];
    billForm(group, null);
  };

  function billForm(existing, rv, idx, count, preset) {
    existing = existing || [];
    var s = rv ? rv._s : null, first = existing[0] || {}, total = 0;
    existing.forEach(function (x) { total += n_(x.amount); });
    var hdr = { date: today(), payee: '', doc_number: '', notes: '', payment_method: 'Bank transfer', paid_status: 'paid', paid_date: today(), doc_url: '' };
    if (existing.length) hdr = { date: first.date, payee: first.payee, doc_number: first.doc_number || '', notes: first.notes || '', payment_method: first.payment_method || 'Bank transfer', paid_status: first.paid_status || 'paid', paid_date: first.paid_date || '', doc_url: first.doc_url || '' };
    var lines = existing.length ? existing.map(function (x) { return { project: x.project, shoot: x.shoot, cost_type: x.cost_type || 'Equipment rental', description: x.description, amount: n_(x.amount) }; })
      : [{ project: preset ? preset.project : (state.view === 'project' ? state.pid : ''), shoot: preset ? preset.shoot : '', cost_type: 'Equipment rental', description: '', amount: '' }];
    if (existing.length === 1 && !first.bill_id) lines.push({ project: '', shoot: '', cost_type: lines[0].cost_type, description: lines[0].description, amount: '' });
    var payments = [], dupes = [];
    if (s) {
      hdr = { date: s.date || today(), payee: s.payee || s.supplier || '', doc_number: s.doc_number || '', notes: s.notes || '', payment_method: 'Not paid yet', paid_status: 'unpaid', paid_date: '', doc_url: '' };
      total = n_(s.total);
      lines = (s.lines && s.lines.length ? s.lines : [{ amount: s.total }]).map(function (l) {
        return { project: project(l.project) ? l.project : '', shoot: l.shoot || '', cost_type: costTypes().indexOf(l.cost_type) !== -1 ? l.cost_type : 'Equipment rental', description: l.description || '', amount: l.amount == null ? '' : n_(l.amount), reason: l.reason || '' };
      });
      payments = ((s.matches || {}).payments || []).map(findEntry).filter(Boolean);
      dupes = ((s.matches || {}).duplicates || []).map(findEntry).filter(Boolean);
    }
    var aiTop = s ? '<div class="btnrow"><span class="tag ' + (s.confidence === 'high' ? 'good' : s.confidence === 'medium' ? 'info' : 'warn') + '">Claude: ' + e_(s.confidence || 'unsure') + ' confidence</span>' + (s.notes ? '<span class="note">' + e_(s.notes) + '</span>' : '') + '</div>' +
      (dupes.length ? '<div class="banner">Possible duplicate: ' + dupes.map(function (d) { return e_(d.id + ' · ' + d.payee + ' · ' + m0(d.amount) + ' · ' + d.date); }).join('; ') + ' already mention this invoice number.</div>' : '') +
      fld('Paid by this bank payment', '<select name="match"><option value="">Not matched yet (book it as owed to the supplier)</option>' + payments.map(function (p, i) {
        return '<option value="' + e_(p.id) + '"' + (i === 0 ? ' selected' : '') + '>' + e_(p.date + ' · ' + p.payee + ' · ' + m0(p.amount) + ' (' + p.id + ')') + '</option>'; }).join('') + '</select>') : '';
    var body = '<form class="obx-form" novalidate>' + (s ? '' : '<p class="note">Enter the bill once, then divide it between projects. A line with no project counts as company overhead.</p>') + aiTop +
      '<div class="obx-r2">' + fld('Supplier', inp('payee', hdr.payee, 'list="obx-dl-payees" autocomplete="off"')) + fld('Bill date', inp('date', hdr.date, 'type="date"')) + '</div>' +
      '<div class="obx-r2">' + fld('Invoice no.', inp('doc_number', hdr.doc_number)) + fld('Bill total (LKR)', inp('total', total || '', 'inputmode="decimal"')) + '</div>' +
      '<div class="obx-r2">' + fld('Paid by', '<select name="payment_method">' + opts(PAY_METHODS, hdr.payment_method) + '</select>') + fld('Status', '<select name="paid_status"><option value="paid"' + (hdr.paid_status === 'paid' ? ' selected' : '') + '>Paid</option><option value="unpaid"' + (hdr.paid_status !== 'paid' ? ' selected' : '') + '>Not paid yet</option></select>') + '</div>' +
      '<div class="obx-r2">' + fld('Paid date', inp('paid_date', hdr.paid_date, 'type="date"')) + (s ? '<div></div>' : fld('Document link', inp('doc_url', hdr.doc_url, 'type="url" placeholder="https://drive.google.com/…"'))) + '</div>' +
      fld('Notes', inp('notes', hdr.notes)) +
      '<span class="mono" style="margin-top:4px">How the bill is divided</span><div id="obx-lines"></div>' +
      '<div class="btnrow"><button type="button" class="chip" data-l="add">+ Add line</button><button type="button" class="chip" data-l="even">Split evenly</button></div>' +
      '<div class="obx-sum" id="obx-sum"></div><p class="obx-err" id="obx-err" role="alert"></p>' +
      '<div class="btnrow obx-actions">' + (s ? '<button type="button" class="btn obx-danger" data-l="reject">Reject</button><button type="button" class="btn" data-l="skip">Skip</button>' : '') +
      '<span style="flex:1"></span><button type="button" class="btn" data-obx="close">' + (s ? 'Close' : 'Cancel') + '</button><button type="submit" class="btn primary" id="obx-save">' + (s ? 'Approve' : 'Save bill') + '</button></div>' +
      dl('obx-dl-payees', payees()) + dl('obx-dl-allshoots', uniq(shoots.list.map(function (x) { return x.name; }))) + '</form>';
    var title = s ? 'Review bill ' + (idx + 1) + ' of ' + count : (existing.length ? (first.bill_id ? 'Edit split bill' : 'Split ' + first.id + ' across projects') : 'Split bill');
    var pane = s ? '<div class="obx-doc"><div class="obx-frame" id="obx-frame"><span class="note">Loading the document…</span></div><a class="note" href="' + e_(s.file_url) + '" target="_blank" rel="noopener" style="color:var(--link)">Open in Drive</a></div>' : '';
    openM(title, s ? '<div class="obx-review">' + pane + '<div>' + body + '</div></div>' : body, !!s, function (m) {
      var f = m.querySelector('form'), box = $('obx-lines');
      function read() {
        return Array.prototype.map.call(box.querySelectorAll('.obx-line'), function (r, i) {
          var g = function (n) { return r.querySelector('[name=' + n + ']').value.trim(); };
          return { project: g('l_project'), shoot: g('l_shoot'), cost_type: g('l_cost_type'), description: g('l_description'), amount: g('l_amount'), reason: (lines[i] || {}).reason || '' };
        });
      }
      function draw() {
        box.innerHTML = lines.map(function (l, i) {
          return '<div class="obx-line"><div class="obx-r2">' + fld('Project', '<select name="l_project">' + projOptions(l.project) + '</select>') + fld('Amount', inp('l_amount', l.amount, 'inputmode="decimal" placeholder="0"')) + '</div>' +
            '<div class="obx-r3">' + fld('Cost type', '<select name="l_cost_type">' + opts(costTypes(), l.cost_type) + '</select>') + fld('Shoot / day', inp('l_shoot', l.shoot, 'list="obx-dl-allshoots" autocomplete="off"')) + fld('What for', inp('l_description', l.description)) + '</div>' +
            (l.reason ? '<p class="obx-reason">Claude: ' + e_(l.reason) + '</p>' : '') +
            (lines.length > 1 ? '<button type="button" class="obx-rm" data-rm="' + i + '">Remove line</button>' : '') + '</div>';
        }).join('');
        sum();
      }
      function sum() {
        var t = n_(f.elements.total.value), sm = 0; read().forEach(function (l) { sm += n_(l.amount); });
        var left = Math.round((t - sm) * 100) / 100, ok = Math.abs(left) < 0.005 && t !== 0;
        $('obx-sum').innerHTML = 'Divided <b>' + m_(sm) + '</b> of ' + m_(t) + ' · ' + (ok ? '<span style="color:var(--good)">adds up</span>' : '<span style="color:var(--warn)">' + (left > 0 ? m_(left) + ' left to assign' : m_(-left) + ' too much') + '</span>');
        $('obx-save').disabled = !ok;
      }
      function match() {
        if (!f.elements.match) return;
        var p = findEntry(f.elements.match.value);
        if (p) { f.elements.payment_method.value = PAY_METHODS.indexOf(p.payment_method) !== -1 ? p.payment_method : 'Bank transfer'; f.elements.paid_status.value = 'paid'; f.elements.paid_date.value = p.paid_date || p.date; }
        else { f.elements.payment_method.value = 'Not paid yet'; f.elements.paid_status.value = 'unpaid'; f.elements.paid_date.value = ''; }
      }
      draw();
      if (s) { f.elements.match.addEventListener('change', match); match(); preview(rv.id); }
      box.addEventListener('input', sum); f.elements.total.addEventListener('input', sum);
      m.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-l],[data-rm]'); if (!b) return;
        var a = b.getAttribute('data-l'), rm = b.getAttribute('data-rm');
        if (rm != null) { lines = read(); lines.splice(Number(rm), 1); draw(); }
        else if (a === 'add') { lines = read(); var last = lines[lines.length - 1] || {}; lines.push({ project: '', shoot: '', cost_type: last.cost_type || 'Equipment rental', description: last.description || '', amount: '' }); draw(); }
        else if (a === 'even') { lines = read(); var t = n_(f.elements.total.value), k = lines.length, each = Math.floor(t / k * 100) / 100, used = 0; lines.forEach(function (l, i) { l.amount = i === k - 1 ? Math.round((t - used) * 100) / 100 : each; used += each; }); draw(); }
        else if (a === 'skip') { closeM(); OBX.review(idx + 1); }
        else if (a === 'reject') {
          if (b.getAttribute('data-armed') !== '1') { b.setAttribute('data-armed', '1'); b.textContent = 'Tap again to reject'; return; }
          b.disabled = true; say('Rejecting…', true);
          api('obwDecideBill', [rv.id, 'reject']).then(function () { rv.status = 'rejected'; closeM(); rerender(); say('Bill rejected', true); OBX.review(idx); }, function (e) { b.disabled = false; say(e.message); });
        }
      });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = form(f), ls = read(), err = '';
        if (!d.payee) err = 'Enter the supplier.'; else if (!isDate(d.date)) err = 'Pick the bill date.';
        else if (ls.some(function (l) { return l.amount === '' || !isFinite(n_(l.amount)); })) err = 'Every line needs an amount.';
        if (err) { $('obx-err').textContent = err; return; }
        var header = { date: d.date, payee: d.payee, doc_number: d.doc_number, doc_url: d.doc_url || hdr.doc_url || '', doc_status: (d.doc_url || hdr.doc_url) ? 'invoice' : (first.doc_status || 'invoice'),
          payment_method: d.payment_method, paid_status: d.paid_status, paid_date: d.paid_date, notes: d.notes, business_line: first.business_line || 'Production' };
        if (first.bank_line_id) header.bank_line_id = first.bank_line_id;
        var replace = s ? (d.match ? [d.match] : []) : existing.map(function (x) { return x.id; });
        var payload = { replace_ids: replace, total: n_(d.total), header: header, lines: ls.map(function (l) { return { project: l.project, shoot: l.shoot, cost_type: l.cost_type, description: l.description || d.notes || ('Bill ' + (d.doc_number || '')).trim(), amount: n_(l.amount) }; }) };
        var btn = $('obx-save'); btn.disabled = true; btn.textContent = 'Saving…';
        var call = s ? api('obwDecideBill', [rv.id, 'approve', payload]) : api('obwSaveBill', [payload]);
        call.then(function (res) {
          var added = s ? res.bill.added : res.added;
          DATA.entries = DATA.entries.filter(function (x) { return replace.indexOf(String(x.id)) === -1; }).concat(added);
          if (s) rv.status = 'approved';
          closeM(); rerender(); say((s ? 'Approved: ' : 'Saved: ') + added.length + ' line' + (added.length === 1 ? '' : 's') + ' booked', true);
          if (s) OBX.review(idx);
        }, function (e) { btn.disabled = false; btn.textContent = s ? 'Approve' : 'Save bill'; $('obx-err').textContent = e.message; });
      });
    });
  }

  OBX.review = function (i) {
    var list = OBX.reviews();
    if (!list.length) { closeM(); return; }
    if (i >= list.length) i = 0;
    billForm([], list[i], i, list.length);
  };

  var pv = {};
  function preview(id) {
    function put(f) {
      var el = $('obx-frame'); if (!el) return;
      if (!f.data) { el.innerHTML = '<span class="note">Too large to preview here. Use Open in Drive.</span>'; return; }
      var b = atob(f.data), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([a], { type: f.mime }));
      el.innerHTML = /^image\//.test(f.mime) ? '<img alt="Uploaded bill" src="' + url + '">' : '<iframe title="Uploaded bill" src="' + url + '"></iframe>';
    }
    if (pv[id]) return put(pv[id]);
    api('obwBillFile', [id]).then(function (f) { pv[id] = f; put(f); }, function (e) { var el = $('obx-frame'); if (el) el.innerHTML = '<span class="note">Preview unavailable: ' + e_(e.message) + '</span>'; });
  }

  /* ---------- uploads ---------- */
  function toPayload(file) {
    return new Promise(function (ok, bad) {
      var r = new FileReader(); r.onerror = function () { bad(new Error('Could not read ' + file.name)); };
      if (/^image\//.test(file.type) && file.type !== 'image/gif') {
        r.onload = function () {
          var img = new Image();
          img.onload = function () {
            var sc = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
            c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            ok({ name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
          };
          img.onerror = function () { bad(new Error(file.name + ' could not be opened (try JPG or PDF).')); };
          img.src = r.result;
        };
      } else r.onload = function () { ok({ name: file.name, mime: file.type || 'application/pdf', data: String(r.result).split(',')[1] }); };
      r.readAsDataURL(file);
    });
  }
  function upload(files) {
    files = Array.prototype.slice.call(files || []).filter(function (f) {
      if (f.type !== 'application/pdf' && !/^image\//.test(f.type)) { say(f.name + ' skipped: upload PDFs or photos'); return false; }
      if (f.size > 20 * 1024 * 1024) { say(f.name + ' is over 20 MB'); return false; }
      return true;
    });
    if (!files.length) return;
    up = { total: files.length, done: 0, failed: [] };
    state.etab = 'ai'; go('entries');
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () { return toPayload(f); }).then(function (p) { return api('obwUploadBill', [p]); })
        .then(function (row) { DATA.approvals = (DATA.approvals || []).concat([row]); }, function (e) { up.failed.push(f.name + ': ' + e.message); })
        .then(function () { up.done++; if (state.view === 'entries') go('entries'); else renderNav(); });
    });
    chain.then(function () {
      var ok = up.done - up.failed.length; up = { total: 0, done: 0, failed: up.failed };
      if (state.view === 'entries') go('entries'); else renderNav();
      if (up.failed.length) say(up.failed.join(' · ')); else say(ok + ' document' + (ok === 1 ? '' : 's') + ' read. Ready to review.', true);
    });
  }
  OBX.pickFiles = function () {
    var i = document.createElement('input'); i.type = 'file'; i.accept = 'application/pdf,image/*'; i.multiple = true;
    i.addEventListener('change', function () { upload(i.files); }); i.click();
  };

  /* ---------- Claude's inbox ---------- */
  OBX.unread = function () { return inbox.messages.filter(function (m) { return m.status === 'unread'; }).length; };
  function loadInbox(then) {
    if (!admin()) return;
    api('obwInbox', []).then(function (r) { inbox.messages = r.messages || []; inbox.weekly = r.weekly; inbox.loaded = true; renderNav(); if (state.view === 'inbox' || state.view === 'dashboard') keepScroll(function () { go(state.view); }); if (then) then(); },
      function () { inbox.loaded = true; });
  }
  OBX.start = function () {
    if (admin()) loadInbox();
    loadShoots();
    startLive();
    document.body.classList.add('obx-ready');
  };
  OBX.afterStatement = function () { runCheck('statement'); };
  function runCheck(trigger, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    say('Claude is checking the books…', true);
    api('obwRunAudit', [trigger]).then(function (r) {
      inbox.messages.unshift(r.message); inbox.weekly = r.weekly; inbox.sel = r.message.id; inbox.loaded = true;
      renderNav(); if (state.view === 'inbox' || state.view === 'dashboard') keepScroll(function () { go(state.view); });
      say('Check done: ' + r.message.title.replace(/^Weekly check: /, ''), true);
    }, function (e) { if (btn) { btn.disabled = false; btn.textContent = 'Run check now'; } say(e.message); });
  }

  OBX.dashBanner = function () {
    if (!admin()) return '';
    var h = OBX.quickCreate(), m = inbox.messages[0], nr = OBX.reviews().length;
    if (m && m.status === 'unread' && (m.issues || []).length) h += '<button class="obx-banner" data-view="inbox"><span class="tag late">Claude</span><span><b>' + e_(m.title) + '.</b> ' + e_(String(m.body || '').slice(0, 140)) + (String(m.body || '').length > 140 ? '…' : '') + '</span><span class="obx-go">Open inbox ›</span></button>';
    if (nr) h += '<button class="obx-banner" data-obx="goai"><span class="tag info">Bills</span><span><b>' + nr + ' bill' + (nr === 1 ? '' : 's') + '</b> read by Claude ' + (nr === 1 ? 'is' : 'are') + ' waiting for your approval.</span><span class="obx-go">Review ›</span></button>';
    return h;
  };


  /* ---------- issue cards: show the actual records, in plain words, with the fix next to them ---------- */
  var PLAIN = [
    [/^dup-/, function (x, r) { var e = r[0] && r[0].rec; return e && e.kind === 'income' ? 'The same income may be recorded twice' : 'The same payment may be recorded twice'; }],
    [/^inc-noinv-/, 'Income is counted for an invoice that does not exist'],
    [/^inc-client-/, 'This income line and its invoice name different clients'],
    [/^inc-double-/, 'Income for one invoice is counted more than once'],
    [/^inv-noinc-/, 'This invoice is not counted as income yet'],
    [/^zero-/, 'This line has no amount'],
    [/^assign-/, 'This supplier cost has no project'],
    [/^unpaid-/, 'This cost is still marked unpaid']
  ];
  var FIXLABEL = { entry: 'Open this line', split: 'Assign or split', invoice: 'Open the invoice', project: 'Open the project', search: 'Show these lines', review: 'Review the bills', queue: 'Open approvals', bank: 'Open Bank', settings: 'Open Settings' };
  function findInvoice(no) { return (DATA.invoices || []).filter(function (i) { return i.number === no; })[0]; }
  function issueRefs(x) {
    var refs = x.refs;
    if (!refs) {
      refs = []; var seen = {};
      (String(x.key).match(/\bE\d{3,}\b/g) || []).concat(x.action && (x.action.type === 'entry' || x.action.type === 'split') ? [x.action.id] : []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; refs.push({ type: 'entry', id: id }); } });
      (String(x.key).match(/INV-\d+/g) || []).forEach(function (no) { if (!seen[no]) { seen[no] = 1; refs.push({ type: 'invoice', id: no }); } });
    }
    return refs.map(function (r) { return { type: r.type, id: r.id, rec: r.type === 'entry' ? findEntry(r.id) : r.type === 'invoice' ? findInvoice(r.id) : null }; });
  }
  /** An issue is done when the lines it was about are gone (for a duplicate: when either one is gone). */
  function resolved(x) {
    var ents = issueRefs(x).filter(function (r) { return r.type === 'entry'; });
    if (!ents.length) return false;
    var missing = ents.filter(function (r) { return !r.rec; }).length;
    if (/^dup-/.test(x.key)) return missing > 0;
    if (/^assign-/.test(x.key)) return missing > 0 || !!ents[0].rec.project || ents[0].rec.allocation === 'overhead';
    if (/^zero-/.test(x.key)) return missing > 0 || n_(ents[0].rec.amount) !== 0;
    if (/^unpaid-/.test(x.key)) return missing > 0 || ents[0].rec.paid_status === 'paid';
    return missing === ents.length;
  }
  function nice(d) { d = String(d || '').slice(0, 10); if (!isDate(d)) return d || '-'; var p = d.split('-'); return Number(p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1] + ' ' + p[0]; }
  /** Replaces record codes in a sentence with what they are, e.g. "E0155" becomes "Joshua trial quote (LKR 40,332)". */
  function humanize(t) {
    return e_(String(t || '')).replace(/\bE\d{3,}\b/g, function (id) { var e = findEntry(id); return e ? e_((e.payee || 'a line') + ' (LKR ' + m0(e.amount) + ')') : 'a deleted line'; });
  }
  function sourceOf(e) {
    if (e.bill_id) return 'Split bill';
    if (e.bank_line_id) return 'Bank statement';
    var c = String(e.created_by || '');
    if (c === 'import') return 'Imported from the old tracker';
    if (/INV-\d+/.test(String(e.description || '')) && e.kind === 'income') return 'Made when the invoice was sent';
    return c ? 'Typed in by ' + c.split('@')[0] : 'Typed in';
  }
  function entryFacts(e) {
    var p = project(e.project);
    return [['Date', nice(e.date)], ['Project', p ? p.name : (e.allocation === 'overhead' ? 'Company overhead' : 'None')], ['Shoot', e.shoot || '-'], ['Type', e.cost_type || '-'],
      ['Paid', e.paid_status === 'paid' ? 'Paid' + (e.paid_date ? ' ' + nice(e.paid_date) : '') + (e.payment_method ? ', ' + e.payment_method : '') : 'Not paid yet'],
      ['Came from', sourceOf(e)], ['Invoice no.', e.doc_number || '-']];
  }
  function entryCard(r, other, isDup) {
    var e = r.rec;
    if (!e) return '<div class="ic ic-gone"><b>Already deleted</b><span class="note">This line is no longer in the books.</span></div>';
    var of = other && other.rec ? entryFacts(other.rec) : null;
    var facts = entryFacts(e).map(function (f, i) { var diff = of && of[i][1] !== f[1]; return '<div class="ic-f' + (diff ? ' diff' : '') + '"><span>' + f[0] + '</span><b>' + e_(f[1]) + '</b></div>'; }).join('');
    return '<div class="ic"><div class="ic-top"><b>' + e_(e.payee || 'No payee') + '</b><span class="ic-amt">LKR ' + m_(e.amount) + '</span></div>' +
      '<div class="ic-desc">' + e_(e.description || 'No description') + (e.notes ? '<small>' + e_(e.notes) + '</small>' : '') + '</div><div class="ic-facts">' + facts + '</div>' +
      '<div class="ic-foot"><span class="ic-id">' + (e.kind === 'income' ? 'Income' : 'Cost') + ' line ' + e_(e.id) + (e.doc_url ? ' · <a href="' + e_(e.doc_url) + '" target="_blank" rel="noopener">document</a>' : ' · no document') + '</span>' +
      (admin() ? '<span class="btnrow"><button class="chip" data-obxfix="' + e_(JSON.stringify({ type: 'entry', id: e.id })) + '">Open</button>' + (isDup ? '<button class="chip ic-del" data-obxdel="' + e_(e.id) + '">Delete this one</button>' : '') + '</span>' : '') + '</div></div>';
  }
  function invoiceCard(r) {
    var i = r.rec; if (!i) return '<div class="ic ic-gone"><b>' + e_(r.id) + '</b><span class="note">This invoice is not in the Invoices list.</span></div>';
    return '<div class="ic"><div class="ic-top"><b>' + e_(i.client || 'No client') + '</b><span class="ic-amt">LKR ' + m_(n_(i.total) - n_(i.advance_applied)) + '</span></div><div class="ic-desc">Invoice ' + e_(i.number) + (i.subject ? ' · ' + e_(i.subject) : '') + '</div>' +
      '<div class="ic-facts"><div class="ic-f"><span>Date</span><b>' + nice(i.date) + '</b></div><div class="ic-f"><span>Due</span><b>' + nice(i.due) + '</b></div><div class="ic-f"><span>Status</span><b>' + e_(i.status || '-') + '</b></div><div class="ic-f"><span>Project</span><b>' + e_((project(i.project) || {}).name || 'None') + '</b></div></div></div>';
  }
  function issueCard(x) {
    var refs = issueRefs(x), isDup = /^dup-/.test(x.key), title = x.title, sv = SEV[x.severity] || SEV.low;
    for (var k = 0; k < PLAIN.length; k++) if (PLAIN[k][0].test(x.key)) { title = typeof PLAIN[k][1] === 'function' ? PLAIN[k][1](x, refs) : PLAIN[k][1]; break; }
    var ents = refs.filter(function (r) { return r.type === 'entry'; }), invs = refs.filter(function (r) { return r.type === 'invoice'; });
    var cards = isDup && ents.length === 2 ? '<div class="ic-pair">' + entryCard(ents[0], ents[1], true) + '<div class="ic-vs">or</div>' + entryCard(ents[1], ents[0], true) + '</div>'
      : (ents.length || invs.length ? '<div class="ic-list">' + ents.map(function (r) { return entryCard(r, null, false); }).join('') + invs.map(invoiceCard).join('') + '</div>' : '');
    var why = isDup ? (x.why || 'Same payee and same amount, close together.') + ' The differences between the two are highlighted. Delete one if they are the same payment, or keep both if they are two real payments.' : x.detail;
    var acts = [];
    if (admin()) {
      if (isDup) acts.push('<button class="btn obx-sm" data-obxdis="' + e_(x.key) + '">They are different: keep both</button>');
      else {
        if (/^assign-/.test(x.key) && ents[0] && ents[0].rec) acts.push('<button class="btn primary obx-sm" data-obxsplit="' + e_(ents[0].id) + '">Assign or split</button>', '<button class="btn obx-sm" data-obxover="' + e_(ents[0].id) + '">It\'s overhead</button>');
        else if (x.action) acts.push('<button class="btn primary obx-sm" data-obxfix="' + e_(JSON.stringify(x.action)) + '">' + (FIXLABEL[x.action.type] || 'Fix') + '</button>');
        if (/^inc-(noinv|client)-/.test(x.key) && ents[0] && ents[0].rec) acts.push('<button class="btn obx-sm ic-del" data-obxdel="' + e_(ents[0].id) + '">Delete this line</button>');
        acts.push('<button class="btn obx-sm" data-obxdis="' + e_(x.key) + '">Ignore</button>');
      }
    }
    return '<div class="obx-issue ic-issue" data-ikey="' + e_(x.key) + '"><div class="ic-head"><span class="ic-dot ' + sv[0] + '"></span><div><b>' + e_(title) + '</b><p class="note">' + humanize(why) + '</p></div></div>' + cards + '<div class="btnrow ic-acts">' + acts.join('') + '</div></div>';
  }

  /* ---------- bank: which dates are already covered ---------- */
  function isoOf(v) { v = String(v || '').slice(0, 10); var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); return m ? m[3] + '-' + m[2] + '-' + m[1] : v; }
  function addDay(d, n) { var t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2); }
  function coverage(statements) {
    var st = (statements || []).map(function (s) { return { from: isoOf(s.from), to: isoOf(s.to) }; }).filter(function (s) { return isDate(s.from) && isDate(s.to); }).sort(function (a, b) { return a.from.localeCompare(b.from); });
    if (!st.length) return null;
    var gaps = [], end = st[0].to;
    st.slice(1).forEach(function (s) { if (s.from > addDay(end, 1)) gaps.push({ from: addDay(end, 1), to: addDay(s.from, -1) }); if (s.to > end) end = s.to; });
    return { first: st[0].from, last: end, gaps: gaps };
  }
  /** Shown above the statement upload: the last date already in, and where to start the next download. */
  OBX.bankCoverage = function (b) {
    if (!b || !b.statements) return '';
    var c = coverage(b.statements);
    if (!c) return '<div class="bk-cover"><div><span class="mono">Nothing imported yet</span><b>Start with your first statement</b></div></div>';
    var t = today(), upTo = c.last >= t;
    return '<div class="bk-cover"><div><span class="mono">Last transaction date imported</span><b>' + nice(c.last) + '</b></div>' +
      '<div><span class="mono">Next statement to upload</span><b>' + (upTo ? 'Up to date' : 'From ' + nice(c.last) + ' to today') + '</b></div></div>' +
      '<p class="note bk-note">' + (upTo ? 'Statements cover every day up to today.' : 'Start the next download on ' + nice(c.last) + ', the same day the last one ended, so a payment made later that day is not missed. Lines already imported are skipped automatically.') + '</p>' +
      (c.gaps.length ? '<div class="banner">Dates with no statement: ' + c.gaps.map(function (g) { return '<b>' + nice(g.from) + (g.to !== g.from ? ' to ' + nice(g.to) : '') + '</b>'; }).join(', ') + '. Download a statement for ' + (c.gaps.length === 1 ? 'that period' : 'those periods') + ' too.</div>' : '');
  };
  /** Shown on "Ready to import": does this file join up with what is already in? */
  OBX.bankFit = function (b, from, to) {
    var c = coverage((b || {}).statements); from = isoOf(from); to = isoOf(to);
    if (!c || !isDate(from) || !isDate(to)) return '';
    if (to <= c.last && from >= c.first && !c.gaps.length) return '<div class="banner">These dates (' + nice(from) + ' to ' + nice(to) + ') are already imported. Importing again is safe, but nothing new will be added.</div>';
    if (from > addDay(c.last, 1)) return '<div class="banner">This statement starts on ' + nice(from) + ', but the last one ended on ' + nice(c.last) + '. <b>' + nice(addDay(c.last, 1)) + ' to ' + nice(addDay(from, -1)) + '</b> would be missing. Download one statement from ' + nice(c.last) + ' instead.</div>';
    return '<div class="note" style="color:var(--good)">Joins up with the statements already imported (last date ' + nice(c.last) + ').</div>';
  };

  var SEV = { high: ['late', 'Urgent'], medium: ['warn', 'Fix'], low: ['mute', 'Minor'] };
  OBX.vInbox = function () {
    var ms = inbox.messages;
    var h = '<div class="head"><div><span class="mono">From Claude · weekly check</span><h1>Inbox</h1></div><div class="btnrow"><button class="btn primary" data-obx="runcheck">Run check now</button></div></div>';
    h += '<p class="note" style="margin:-10px 0 16px">Claude checks the whole app ' + (inbox.weekly ? 'every Monday morning' : 'each time you run it') + ' and after every bank statement you upload, then lists anything that looks wrong, with a button to fix each one.</p>';
    if (!inbox.loaded) return h + '<div class="tablewrap"><div class="empty">Loading…</div></div>';
    if (!ms.length) return h + '<div class="tablewrap"><div class="empty">No messages yet. Run the first check now.</div></div>';
    var sel = ms.filter(function (m) { return m.id === inbox.sel; })[0] || ms[0];
    if (sel.status === 'unread') { sel.status = 'read'; api('obwInboxAction', [sel.id, 'read']).then(function () { renderNav(); }, function () { /* ignore */ }); setTimeout(renderNav, 0); }
    h += '<div class="obx-inbox"><div class="obx-msgs">' + ms.map(function (m) {
      var hi = (m.issues || []).filter(function (x) { return x.severity === 'high'; }).length;
      return '<button class="obx-msg' + (m.id === sel.id ? ' on' : '') + (m.status === 'unread' ? ' unread' : '') + '" data-obxmsg="' + e_(m.id) + '"><span class="mono">' + e_(String(m.time).slice(0, 16)) + ' · ' + e_(m.trigger || '') + '</span><b>' + e_(m.title) + '</b>' + (hi ? '<span class="tag late">' + hi + ' urgent</span>' : '') + '</button>';
    }).join('') + '</div><div class="obx-read card"><span class="mono">' + e_(String(sel.time).slice(0, 16)) + '</span><h2 style="margin:6px 0 10px">' + e_(sel.title) + '</h2><p class="obx-body">' + e_(sel.body) + '</p>';
    var all = sel.issues || [], is = all.filter(function (x) { return !resolved(x); }), fixedN = all.length - is.length;
    if (fixedN) h += '<p class="note ic-fixed">' + fixedN + ' item' + (fixedN === 1 ? '' : 's') + ' from this check ' + (fixedN === 1 ? 'has' : 'have') + ' been fixed since.</p>';
    if (is.length) {
      var groups = [['high', 'Urgent'], ['medium', 'To fix'], ['low', 'Minor']];
      h += '<div class="obx-issues">' + groups.map(function (g) {
        var list = is.filter(function (x) { return (x.severity || 'low') === g[0]; });
        return list.length ? '<div class="ic-group"><span class="tag ' + SEV[g[0]][0] + '">' + g[1] + '</span><span class="note">' + list.length + '</span></div>' + list.map(issueCard).join('') : '';
      }).join('') + '</div>';
    } else h += '<p class="note">Nothing to fix. 🎉</p>';
    return h + '</div></div>';
  };

  function fix(a) {
    if (!a) return;
    if (state.view === 'inbox') inbox.restore = { y: window.scrollY, t: Date.now() };
    if (a.type === 'entry') { var e = findEntry(a.id); if (!e) { say(a.id + ' is no longer in the books.', true); return; } state.etab = 'entries'; go('entries'); openEntry(a.id); }
    else if (a.type === 'split') { var s = findEntry(a.id); if (s) OBX.openBillFor(s); else say(a.id + ' is no longer in the books.', true); }
    else if (a.type === 'invoice') openDoc('invoice', a.id);
    else if (a.type === 'project') openProject(a.id);
    else if (a.type === 'search') { state.etab = 'entries'; state.ef = 'All'; state.emonth = 'All'; state.eproject = 'All'; state.esearch = a.id; state.eshow = 150; go('entries'); }
    else if (a.type === 'review') { state.etab = 'ai'; go('entries'); }
    else if (a.type === 'queue') { state.etab = 'queue'; go('entries'); }
    else if (a.type === 'bank') go('bank');
    else if (a.type === 'settings') go('settings');
  }


  /* ---------- shoots: work days inside a project, each with its own budget ---------- */
  var shoots = { list: [], loaded: false };
  var SB = [['Equipment rental', 'budget_equipment_rental'], ['Crew / freelancer', 'budget_crew'], ['Transport', 'budget_transport'], ['Food', 'budget_food'], ['Location & venue', 'budget_location'], ['Other', 'budget_other']];
  var SSTATUS = ['planned', 'shot', 'invoiced', 'done'];
  function applyProject(p) { if (p && p.id) DATA.projects = DATA.projects.map(function (x) { return x.id === p.id ? Object.assign({}, x, p) : x; }); }
  function key(v) { return String(v || '').trim().toLowerCase(); }
  function loadShoots() { api('obwShoots', []).then(function (l) { shoots.list = l || []; shoots.loaded = true; if (state.view === 'project') go('project'); }, function () { shoots.loaded = true; }); }
  function shootsOf(pid) { return shoots.list.filter(function (x) { return x.project === pid; }).sort(function (a, b) { return String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.id).localeCompare(String(b.id)); }); }
  function sBudget(x) { return SB.reduce(function (t, b) { return t + n_(x[b[1]]); }, 0); }
  function sCosts(pid, name) { var k = key(name); return (DATA.entries || []).filter(function (e) { return e.kind === 'cost' && e.project === pid && key(e.shoot) === k && String(e.account) !== '1400'; }); }
  function invoiceOf(no) { return no ? (DATA.invoices || []).filter(function (i) { return i.number === no; })[0] : null; }
  OBX.shootDatalist = function (pid) { return dl('obx-dl-shoots', shootsOf(pid).map(function (x) { return x.name; })); };

  OBX.shootsPanel = function (p) {
    var list = shootsOf(p.id), ad = admin(), names = {};
    list.forEach(function (x) { names[key(x.name)] = 1; });
    var projCosts = (DATA.entries || []).filter(function (e) { return e.kind === 'cost' && e.project === p.id && String(e.account) !== '1400'; });
    var untagged = projCosts.filter(function (e) { return !names[key(e.shoot)]; }), untaggedAmt = untagged.reduce(function (t, e) { return t + n_(e.amount); }, 0);
    var fromCosts = uniq(projCosts.map(function (e) { return e.shoot; }).filter(function (v) { return v && !names[key(v)]; }));
    var h = '<div class="panel obx-shoots"><div class="obx-sechead"><div><span class="h2big">Shoots</span><div class="note">Each shoot or work day with its own budget. Costs count towards a shoot when their "Shoot day" matches.</div></div>' +
      (ad ? '<div class="btnrow">' + (list.length ? '' : '<button class="btn primary" data-obx="shoot-plan" data-pid="' + e_(p.id) + '">Plan shoots</button>') + '<button class="btn' + (list.length ? ' primary' : '') + '" data-obx="shoot-add" data-pid="' + e_(p.id) + '">+ Shoot</button></div>' : '') + '</div>';
    if (!shoots.loaded) return h + '<div class="note">Loading shoots…</div></div>';
    if (ad && fromCosts.length) h += '<button class="obx-banner" data-obx="shoot-import" data-pid="' + e_(p.id) + '"><span class="tag info">From costs</span><span>Your costs already mention <b>' + fromCosts.length + ' shoot' + (fromCosts.length === 1 ? '' : 's') + '</b>: ' + e_(fromCosts.slice(0, 6).join(', ')) + (fromCosts.length > 6 ? '…' : '') + '.</span><span class="obx-go">Add them ›</span></button>';
    if (!list.length) return h + '<div class="note" style="padding:6px 0 2px">No shoots yet. Plan them to give each match day, profile shoot or event its own budget.</div></div>';
    var tb = 0, ts = 0, tf = 0;
    var rows = list.map(function (x) {
      var b = sBudget(x), spent = sCosts(p.id, x.name).reduce(function (t, e) { return t + n_(e.amount); }, 0), inv = invoiceOf(x.invoice_no);
      var income = inv ? n_(inv.total) - n_(inv.advance_applied) : n_(x.fee);
      tb += b; ts += spent; tf += income;
      var r = b ? spent / b : 0, color = !b ? 'var(--muted2)' : spent > b ? 'var(--over)' : r >= 0.85 ? 'var(--warn)' : 'var(--good)';
      return '<tr class="click" data-obxshoot="' + e_(x.id) + '" tabindex="0"><td class="name"><b>' + e_(x.name) + '</b><small>' + e_(x.date || 'No date') + '</small></td>' +
        '<td><span class="tag ' + ({ planned: 'info', shot: 'warn', invoiced: 'good', done: 'mute' }[x.status] || 'mute') + '">' + e_(x.status || 'planned') + '</span></td>' +
        '<td class="r num">' + (income ? m0(income) : '<span class="note">-</span>') + (inv ? '<small class="obx-inv">' + e_(inv.number) + ' · ' + e_(inv.status) + '</small>' : (x.fee ? '<small class="obx-inv">planned fee</small>' : '')) + '</td>' +
        '<td class="r num">' + (b ? m0(b) : '<span class="note">-</span>') + '</td><td class="r num"><b>' + m0(spent) + '</b></td>' +
        '<td style="min-width:120px">' + (b ? '<span class="bar"><i style="width:' + Math.min(100, Math.round(r * 100)) + '%;background:' + color + '"></i></span><small style="color:' + color + '">' + (spent > b ? m0(spent - b) + ' over' : m0(b - spent) + ' left') + '</small>' : '<small class="note">No budget</small>') + '</td>' +
        '<td class="r num ' + (income - spent < 0 ? 'neg' : '') + '">' + (income ? m0(income - spent) : '<span class="note">-</span>') + '</td></tr>';
    }).join('');
    h += '<div class="tablewrap" style="border:0;background:transparent"><table class="etbl obx-stbl"><thead><tr><th>Shoot</th><th>Status</th><th class="r">Income</th><th class="r">Budget</th><th class="r">Spent</th><th>Budget used</th><th class="r">Profit</th></tr></thead><tbody>' + rows +
      (untagged.length ? '<tr class="obx-untag"><td class="name"><b>Not tagged to a shoot</b><small>' + untagged.length + ' cost line' + (untagged.length === 1 ? '' : 's') + '</small></td><td></td><td></td><td></td><td class="r num">' + m0(untaggedAmt) + '</td><td></td><td></td></tr>' : '') +
      '<tr class="obx-total"><td><b>Total</b></td><td></td><td class="r num"><b>' + m0(tf) + '</b></td><td class="r num"><b>' + m0(tb) + '</b></td><td class="r num"><b>' + m0(ts + untaggedAmt) + '</b></td><td></td><td class="r num ' + (tf - ts - untaggedAmt < 0 ? 'neg' : '') + '"><b>' + m0(tf - ts - untaggedAmt) + '</b></td></tr></tbody></table></div>';
    h += '<p class="note" style="margin-top:10px">The project\'s agreed fee and budget follow these shoots: fee = total income, budget = total of shoot budgets.</p>';
    var pf = n_(p.agreed_fee);
    if (ad && tf && Math.round(tf) !== Math.round(pf)) h += '<div class="btnrow obx-budgetnote"><span class="note">Agreed fee shows <b>' + m0(pf) + '</b> but the shoots add up to <b>' + m0(tf) + '</b>.</span><button class="btn obx-sm" data-obx="shoot-budget" data-pid="' + e_(p.id) + '">Update now</button></div>';
    if (p.budget_url) h += '<p class="note" style="margin-top:8px">Older budget sheet: <a class="link" href="' + e_(p.budget_url) + '" target="_blank" rel="noopener" style="color:var(--link)">open in Sheets</a></p>';
    return h + '</div>';
  };

  function budgetFields(x) {
    return '<div class="obx-r3">' + SB.map(function (b) { return fld(b[0], inp(b[1], x[b[1]] === undefined ? '' : x[b[1]], 'inputmode="decimal" placeholder="0"')); }).join('') + '</div>';
  }
  function readBudget(d) { var o = {}; SB.forEach(function (b) { o[b[1]] = d[b[1]] === '' ? '' : n_(d[b[1]]); }); return o; }
  function numOk(d, keys) { return keys.every(function (k) { return d[k] === '' || d[k] == null || /^-?[\d,]*\.?\d+$/.test(String(d[k])); }); }

  function shootForm(pid, x) {
    var isNew = !x; x = x || { project: pid, status: 'planned' };
    var p = project(pid) || {}, invs = (DATA.invoices || []).filter(function (i) { return i.project === pid; });
    var costs = isNew ? [] : sCosts(pid, x.name).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var body = '<form class="obx-form" novalidate>' +
      '<div class="obx-r2">' + fld('Shoot name', inp('name', x.name, 'placeholder="e.g. Match day 1"')) + fld('Date', inp('date', x.date, 'type="date"')) + '</div>' +
      '<div class="obx-r2">' + fld('Status', '<select name="status">' + opts(SSTATUS, x.status || 'planned') + '</select>') + fld('Fee for this shoot (LKR)', inp('fee', x.fee, 'inputmode="decimal" placeholder="Planned income"')) + '</div>' +
      fld('Invoice for this shoot', '<select name="invoice_no"><option value="">Not invoiced yet</option>' + invs.map(function (i) { return '<option value="' + e_(i.number) + '"' + (i.number === x.invoice_no ? ' selected' : '') + '>' + e_(i.number + ' · ' + m0(i.total) + ' · ' + i.status) + '</option>'; }).join('') + '</select>') +
      '<span class="mono">Budget for this shoot</span>' + budgetFields(x) + '<div class="obx-sum" id="obx-bsum"></div>' +
      fld('Notes', inp('notes', x.notes)) +
      (isNew ? '' : '<span class="mono">Costs on this shoot</span>' + (costs.length ? '<div class="tablewrap"><table class="etbl"><tbody>' + costs.map(function (e) {
        return '<tr class="click" data-obxentry="' + e_(e.id) + '"><td>' + e_(e.date) + '</td><td class="name"><b>' + e_(e.payee) + '</b><small>' + e_(e.cost_type || '') + ' · ' + e_(e.description || '') + '</small></td><td class="r num amt">' + m0(e.amount) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="note">No costs tagged with this shoot yet.</p>') +
        '<div class="btnrow"><button type="button" class="chip on" data-act="new-entry" data-project="' + e_(pid) + '" data-shoot="' + e_(x.name) + '">+ Add cost to this shoot</button><button type="button" class="chip" data-obx="shoot-split" data-shoot="' + e_(x.name) + '" data-pid="' + e_(pid) + '">+ Split a bill</button></div>') +
      '<p class="obx-err" id="obx-err" role="alert"></p><div class="btnrow obx-actions">' + (isNew ? '' : '<button type="button" class="btn obx-danger" data-s="del">Delete shoot</button>') +
      '<span style="flex:1"></span><button type="button" class="btn" data-obx="close">Cancel</button><button type="submit" class="btn primary">' + (isNew ? 'Add shoot' : 'Save') + '</button></div></form>';
    openM((isNew ? 'New shoot · ' : '') + (isNew ? (p.name || '') : x.name), body, false, function (m) {
      var f = m.querySelector('form');
      function bs() { var d = form(f), t = SB.reduce(function (a, b) { return a + n_(d[b[1]]); }, 0); $('obx-bsum').innerHTML = 'Budget <b>' + m0(t) + '</b>' + (n_(d.fee) ? ' · planned margin <b style="color:' + (n_(d.fee) - t < 0 ? 'var(--over)' : 'var(--good)') + '">' + m0(n_(d.fee) - t) + '</b>' : ''); }
      f.addEventListener('input', bs); bs();
      m.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-s=del]'); if (!b) return;
        if (b.getAttribute('data-armed') !== '1') { b.setAttribute('data-armed', '1'); b.textContent = 'Tap again to delete'; return; }
        b.disabled = true;
        api('obwDeleteShoot', [x.id]).then(function (r) { applyProject(r && r.project); shoots.list = shoots.list.filter(function (s) { return s.id !== x.id; }); closeM(); rerender(); say('Shoot deleted. Its costs keep their shoot name.', true); }, function (e) { b.disabled = false; say(e.message); });
      });
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = form(f), err = '';
        if (!d.name) err = 'Give the shoot a name.'; else if (d.date && !isDate(d.date)) err = 'The date is not valid.';
        else if (!numOk(d, ['fee'].concat(SB.map(function (b) { return b[1]; })))) err = 'Amounts must be numbers.';
        if (err) { $('obx-err').textContent = err; return; }
        var payload = Object.assign({ project: pid, name: d.name, date: d.date, status: d.status, fee: d.fee === '' ? '' : n_(d.fee), invoice_no: d.invoice_no, notes: d.notes }, readBudget(d));
        if (!isNew) payload.id = x.id;
        var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Saving…';
        api('obwSaveShoot', [payload]).then(function (r) {
          shoots.list = shoots.list.filter(function (s) { return s.id !== r.shoot.id; }).concat([r.shoot]); applyProject(r.project);
          (r.renamed || []).forEach(function (id) { var e = findEntry(id); if (e) e.shoot = r.renamed_to; });
          closeM(); rerender(); say(isNew ? 'Shoot added' : 'Shoot saved' + (r.renamed && r.renamed.length ? '; renamed on ' + r.renamed.length + ' cost line' + (r.renamed.length === 1 ? '' : 's') : ''), true);
        }, function (e) { btn.disabled = false; btn.textContent = isNew ? 'Add shoot' : 'Save'; $('obx-err').textContent = e.message; });
      });
    });
  }

  function planForm(pid) {
    var p = project(pid) || {};
    var body = '<form class="obx-form" novalidate><p class="note">Set up all the shoots at once. Every shoot starts with the same budget; change any of them afterwards, and add extra shoots any time with + Shoot.</p>' +
      '<div class="obx-r2">' + fld('How many shoots', inp('count', 3, 'inputmode="numeric"')) + fld('Name them', inp('base', /CPL|CGL|League/i.test(p.name || '') ? 'Match day' : 'Shoot', '')) + '</div>' +
      '<div class="obx-r2">' + fld('First shoot date (optional)', inp('first', '', 'type="date"')) + fld('Days between shoots', inp('gap', '', 'inputmode="numeric" placeholder="e.g. 7"')) + '</div>' +
      fld('Fee per shoot (LKR, optional)', inp('fee', '', 'inputmode="decimal" placeholder="Planned income for each"')) +
      '<span class="mono">Budget for each shoot</span>' + budgetFields({}) + '<div class="obx-sum" id="obx-psum"></div>' +
      '<p class="obx-err" id="obx-err" role="alert"></p><div class="btnrow obx-actions"><span style="flex:1"></span><button type="button" class="btn" data-obx="close">Cancel</button><button type="submit" class="btn primary">Create shoots</button></div></form>';
    openM('Plan shoots · ' + (p.name || ''), body, false, function (m) {
      var f = m.querySelector('form');
      function names(d) {
        var c = Math.max(0, Math.min(60, Math.floor(n_(d.count)))), out = [];
        for (var i = 1; i <= c; i++) {
          var date = '';
          if (isDate(d.first)) { var dt = new Date(d.first + 'T00:00:00'); dt.setDate(dt.getDate() + (i - 1) * Math.max(0, Math.floor(n_(d.gap)))); date = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2); }
          out.push({ name: (d.base || 'Shoot') + ' ' + i, date: date });
        }
        return out;
      }
      function ps() {
        var d = form(f), l = names(d), each = SB.reduce(function (a, b) { return a + n_(d[b[1]]); }, 0);
        $('obx-psum').innerHTML = l.length ? 'Creates <b>' + e_(l.map(function (x) { return x.name + (x.date ? ' (' + x.date + ')' : ''); }).slice(0, 4).join(', ')) + (l.length > 4 ? '…' : '') + '</b> · total budget <b>' + m0(each * l.length) + '</b>' + (n_(d.fee) ? ' · total fees <b>' + m0(n_(d.fee) * l.length) + '</b>' : '') : 'Enter how many shoots.';
      }
      f.addEventListener('input', ps); ps();
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = form(f), l = names(d), err = '';
        if (!l.length) err = 'Enter how many shoots (1 to 60).'; else if (!numOk(d, ['fee'].concat(SB.map(function (b) { return b[1]; })))) err = 'Amounts must be numbers.';
        if (err) { $('obx-err').textContent = err; return; }
        var bud = readBudget(d);
        var list = l.map(function (x) { return Object.assign({ name: x.name, date: x.date, fee: d.fee === '' ? '' : n_(d.fee) }, bud); });
        var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Creating…';
        api('obwPlanShoots', [{ project: pid, shoots: list }]).then(function (r) {
          shoots.list = shoots.list.concat(r.shoots); applyProject(r.project); closeM(); rerender(); say(r.shoots.length + ' shoot' + (r.shoots.length === 1 ? '' : 's') + ' created', true);
        }, function (e) { btn.disabled = false; btn.textContent = 'Create shoots'; $('obx-err').textContent = e.message; });
      });
    });
  }

  function importShoots(pid, btn) {
    var have = {}; shootsOf(pid).forEach(function (x) { have[key(x.name)] = 1; });
    var first = {};
    (DATA.entries || []).filter(function (e) { return e.kind === 'cost' && e.project === pid && e.shoot && !have[key(e.shoot)]; })
      .forEach(function (e) { var k = key(e.shoot); if (!first[k] || e.date < first[k].date) first[k] = { name: String(e.shoot).trim(), date: String(e.date).slice(0, 10) }; });
    var list = Object.keys(first).map(function (k) { return first[k]; });
    if (!list.length) return;
    if (btn) btn.disabled = true;
    api('obwPlanShoots', [{ project: pid, shoots: list.map(function (x) { return { name: x.name, date: x.date, status: 'shot' }; }) }]).then(function (r) {
      shoots.list = shoots.list.concat(r.shoots); applyProject(r.project); rerender(); say(r.shoots.length + ' shoot' + (r.shoots.length === 1 ? '' : 's') + ' added from your costs. Add their budgets next.', true);
    }, function (e) { if (btn) btn.disabled = false; say(e.message); });
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target; if (!t.closest) return;
    var el = t.closest('[data-obxshoot],[data-obxentry],[data-obx^="shoot-"]'); if (!el) return;
    ev.stopPropagation(); ev.preventDefault();
    var a = el.getAttribute('data-obx'), pid = el.getAttribute('data-pid');
    if (el.hasAttribute('data-obxshoot')) { var x = shoots.list.filter(function (s) { return s.id === el.getAttribute('data-obxshoot'); })[0]; if (x && admin()) shootForm(x.project, x); }
    else if (el.hasAttribute('data-obxentry')) { closeM(); openEntry(el.getAttribute('data-obxentry')); }
    else if (a === 'shoot-add') shootForm(pid, null);
    else if (a === 'shoot-plan') planForm(pid);
    else if (a === 'shoot-import') importShoots(pid, el);
    else if (a === 'shoot-split') { var sh = el.getAttribute('data-shoot'); closeM(); billForm([], null, 0, 0, { project: pid, shoot: sh }); }
    else if (a === 'shoot-budget') {
      el.disabled = true;
      api('obwShootsToBudget', [pid]).then(function (r) { DATA.projects = DATA.projects.map(function (p) { return p.id === pid ? Object.assign({}, p, r.project) : p; }); rerender(); say('Project budget now matches the shoots', true); }, function (e) { el.disabled = false; say(e.message); });
    }
  }, true);


  /* ---------- live updates: check every 15 s while open; reload quietly when someone else changes something ---------- */
  var live = { rev: '', timer: null, busy: false, every: 15000 };
  function whoName(email) {
    var u = ((DATA.users || []).filter(function (x) { return String(x.email).toLowerCase() === String(email).toLowerCase(); })[0]) || {};
    return u.name || String(email || 'someone').split('@')[0];
  }
  function editing() {
    if ($('obx-modal') || (state && (state.modal || state.view === 'edit'))) return true;
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value);
  }
  function silentReload(last) {
    live.busy = true;
    var y = window.scrollY;
    Promise.all([api('getBootData', []), api('obwShoots', []).catch(function () { return null; })]).then(function (r) {
      if (editing()) { live.rev = ''; return; }            // someone started typing meanwhile: try again next round
      window.DATA = r[0]; if (r[1]) shoots.list = r[1];
      try { window.C = compute(); } catch (x) { /* ignore */ }
      go(state.view); window.scrollTo(0, y);
      if (admin()) loadInbox();
      var me = String((DATA.user || {}).email || '').toLowerCase();
      if (last && last.user && String(last.user).toLowerCase() !== me) say('Updated with changes from ' + whoName(last.user) + (last.tab ? ' (' + last.tab + ')' : ''), true);
    }, function () { /* offline or asleep: try again next round */ }).then(function () { live.busy = false; });
  }
  function tick(force) {
    if (live.busy || document.visibilityState !== 'visible') return;
    if (!force && editing()) return;
    api('obwPing', []).then(function (p) {
      if (!live.rev) { live.rev = p.rev; return; }
      if (p.rev !== live.rev) {
        if (editing()) return;                             // keep the old stamp; reload once the form is closed
        live.rev = p.rev; silentReload(p.last);
      }
    }, function () { /* ignore: next tick retries */ });
  }
  function startLive() {
    clearInterval(live.timer);
    live.timer = setInterval(tick, live.every);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') tick(true); });
    window.addEventListener('focus', function () { tick(); });
    tick(true);
  }

  /* ---------- bank matching: approve what each bank line is ---------- */
  var bm = { auto: { running: false, done: 0, err: '', list: [] }, items: [], options: { clients: [], projects: [], shoots: [] }, loaded: false, loading: false, at: 0, err: '', asking: 0, askErr: '', asked: {}, sel: {}, edit: {}, open: {}, busy: {}, errs: {} };
  var CONF = { strong: ['good', 'Looks right'], maybe: ['info', 'Is this the one?'], conflict: ['warn', 'Two fit: you pick'], unsure: ['warn', 'Not sure'], none: ['mute', 'No match found'] };
  function bmItem(id) { return bm.items.filter(function (x) { return x.id === id; })[0]; }
  function bmLoad(force) {
    if (!admin() || bm.loading) return;
    if (!force && bm.loaded && Date.now() - bm.at < 20000) return;
    bm.loading = true;
    // first file everything that needs no decision (already in the books, bank charges, fixed rules), then show only what is left
    var A = bm.auto; A.running = true; A.err = ''; bmPaint();
    (function autoStep() {
      api('obwBankAuto', []).then(function (r) {
        A.done += r.done || 0; bmPaint();
        if ((r.failed || []).length) A.err = r.failed[0];
        if (r.done > 0 && r.remaining > 0) return autoStep();
        A.running = false; if (A.done && window.reloadData) reloadData(function () {}); suggest();
      }, function (e) { A.running = false; A.err = e.message; suggest(); });
    })();
    function suggest() { api('obwBankSuggest', []).then(function (r) {
      bm.auto.list = r.autoDone || [];
      bm.loading = false; bm.loaded = true; bm.at = Date.now(); bm.err = '';
      var old = {}; bm.items.forEach(function (x) { old[x.id] = x; });
      bm.items = (r.items || []).map(function (x) { var o = old[x.id]; if (o && o.claude && !x.claude && o.amount === x.amount) { x.proposal = o.proposal; x.claude = true; } return x; });
      bm.options = r.options || bm.options; bmPaint(); bmAsk();
    }, function (e) { bm.loading = false; bm.loaded = true; bm.at = Date.now(); bm.err = e.message; bmPaint(); }); }
  }
  function bmAutoHtml() {
    var A = bm.auto, L = A.list || [];
    if (A.running) return '<div class="bm-status"><span class="ob-spin bm-spin"></span>Filing the lines that need no decision (already in your books, bank charges, fixed rules)… ' + A.done + ' so far</div>';
    if (!L.length) return A.err ? '<div class="note bm-askerr">Some lines could not be filed automatically (' + e_(A.err) + '). They are in the list below.</div>' : '';
    var k = { books: 0, rule: 0, invoice: 0 }; L.forEach(function (x) { k[x.kind] = (k[x.kind] || 0) + 1; });
    var parts = []; if (k.books) parts.push(k.books + ' already in your books'); if (k.invoice) parts.push(k.invoice + ' invoice payment' + (k.invoice === 1 ? '' : 's')); if (k.rule) parts.push(k.rule + ' by your sorting rules');
    return '<details class="bm-auto"><summary><b>' + L.length + ' filed automatically</b> in the last 30 days: ' + parts.join(', ') + '. Open to check or undo.</summary><div class="bm-autolist">' +
      L.map(function (x) { return '<div class="lrow"><span class="l"><span class="d">' + e_(dshortX(x.date)) + '</span><span>' + e_(x.text) + '<small class="note" style="display:block">' + e_(x.why) + '</small></span></span><span class="r"><strong class="num">' + (x.direction === 'credit' ? '+ ' : '- ') + e_(fmtX(x.amount)) + '</strong> <button type="button" class="chip" data-bmundo="' + e_(x.id) + '"' + (bm.busy[x.id] ? ' disabled' : '') + '>Undo</button></span></div>'; }).join('') +
      '</div></details>';
  }
  function dshortX(d) { return window.dshort ? dshort(d) : d; }
  function fmtX(n) { return window.fmt ? fmt(n) : n; }
  /** Claude judges the lines the rules were unsure about, once, using the invoices, costs, projects and shoots in the app. */
  function bmAsk() {
    var ids = bm.items.filter(function (x) { return x.proposal.strength !== 'strong' && !x.claude && !bm.asked[x.id]; }).slice(0, 12).map(function (x) { return x.id; });
    if (!ids.length || bm.asking) return;
    ids.forEach(function (id) { bm.asked[id] = 1; }); bm.asking = ids.length; bm.askErr = ''; bmPaint();
    api('obwBankAsk', [ids]).then(function (r) {
      bm.asking = 0;
      Object.keys(r.results || {}).forEach(function (id) { var it = bmItem(id); if (it) { it.proposal = r.results[id]; it.claude = true; delete bm.sel[id]; delete bm.edit[id]; } });
      bmPaint(); bmAsk();
    }, function (e) { bm.asking = 0; bm.askErr = e.message; bmPaint(); });
  }
  function bmSel(it) { return bm.sel[it.id] || { mode: it.proposal.mode, ref: it.proposal.ref }; }
  function bmFields(it) {
    if (!bm.edit[it.id]) { var p = it.proposal; bm.edit[it.id] = { client: p.client || '', project: p.project || '', shoot: p.shoot || '', payee: p.payee || '', cost_type: p.cost_type || (it.direction === 'debit' ? 'Other' : ''), description: p.description || '', invoice: '' }; }
    return bm.edit[it.id];
  }
  function bmOpenInvoices(client) {
    return (DATA.invoices || []).filter(function (i) { return i.status !== 'draft' && i.status !== 'paid' && i.status !== 'void' && !(window.invLegacy && invLegacy(i)) && (window.invBal ? invBal(i) > 0.005 : true) && (!client || i.client === client); });
  }
  function bmSelect(id, field, list, val, blank) {
    var has = !val || list.some(function (o) { return o[0] === val; });
    return '<select class="f" data-bmf="' + e_(id + '|' + field) + '">' + (blank != null ? '<option value="">' + e_(blank) + '</option>' : '') + (has ? '' : '<option value="' + e_(val) + '" selected>' + e_(val) + '</option>') +
      list.map(function (o) { return '<option value="' + e_(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + e_(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function bmForm(it, correcting) {
    var f = bmFields(it), credit = it.direction === 'credit', O = bm.options;
    var projs = O.projects.filter(function (p) { return !f.client || p.client === f.client || p.id === f.project; });
    var shoots = O.shoots.filter(function (s) { return s.project === f.project; });
    var h = '<div class="bm-form">' + (correcting ? '<p class="note">Not right? Correct it below. Nothing is saved until you approve.</p>' : '') + '<div class="bm-grid">' +
      fld('Client', bmSelect(it.id, 'client', O.clients.map(function (c) { return [c, c]; }), f.client, 'No client / not sure')) +
      fld('Project', bmSelect(it.id, 'project', projs.map(function (p) { return [p.id, p.name]; }), f.project, 'No project (company overhead)')) +
      fld('Shoot', bmSelect(it.id, 'shoot', shoots.map(function (s) { return [s.name, s.name]; }), f.shoot, f.project ? 'Whole project / no shoot' : 'Choose a project first')) +
      fld(credit ? 'Received from' : 'Paid to', '<input class="f" data-bmf="' + e_(it.id + '|payee') + '" value="' + e_(f.payee) + '" list="bm-payees">') +
      (credit ? fld('Invoice it pays (optional)', bmSelect(it.id, 'invoice', bmOpenInvoices(f.client).map(function (i) { return [i.number, i.number + ' · ' + (i.subject || i.client) + ' · ' + m0(window.invBal ? invBal(i) : i.total)]; }), f.invoice, 'Not an invoice payment')) :
        fld('Cost type', bmSelect(it.id, 'cost_type', costTypes().map(function (c) { return [c, c]; }), f.cost_type))) +
      fld('What for', '<input class="f" data-bmf="' + e_(it.id + '|description') + '" value="' + e_(f.description) + '">') + '</div></div>';
    return h;
  }
  function bmCand(it, c, kind) {
    var selected = bmSel(it), key = kind === 'invoice' ? c.number : c.ids.join(','), on = selected.mode === (kind === 'invoice' ? 'invoice' : c.type) && selected.ref === key;
    var title = kind === 'invoice' ? '<b>' + e_(c.number) + '</b> · ' + e_(c.client) : '<b>' + e_(c.payee) + '</b> · ' + (c.type === 'group' ? 'split bill' : e_(c.id));
    var sub = kind === 'invoice' ? e_(c.subject || 'No subject') + (c.project ? ' · ' + e_((project(c.project) || {}).name || c.project) : '') : e_(c.description || '') + (c.project ? ' · ' + e_(c.project) : '') + (c.shoot ? ' · ' + e_(c.shoot) : '');
    var amt = kind === 'invoice' ? 'Owes ' + m_(c.balance) : m_(c.amount);
    return '<button type="button" class="bm-cand' + (on ? ' on' : '') + '" data-bmpick="' + e_(it.id + '|' + (kind === 'invoice' ? 'invoice' : c.type) + '|' + key) + '" aria-pressed="' + on + '"><span class="bm-radio"></span><span class="bm-ct"><span>' + title + '</span><small>' + sub + '</small><small class="bm-why">' + e_(c.why) + (c.paid ? ' · already marked paid' : '') + (c.legacy ? ' · old Zoho invoice' : '') + '</small></span><span class="bm-amt">' + amt + '</span></button>';
  }
  function bmCardHtml(it) {
    var p = it.proposal, st = CONF[p.strength] || CONF.none, sel = bmSel(it), credit = it.direction === 'credit', busy = bm.busy[it.id];
    var cands = credit ? it.invoices : it.entries, kind = credit ? 'invoice' : 'entry', isNew = sel.mode === 'new' || sel.mode === 'income';
    var newOn = isNew;
    var h = '<div class="bm-card' + (busy ? ' busy' : '') + '" data-bmcard="' + e_(it.id) + '"><div class="bm-top"><div class="bm-line"><span class="mono">' + e_(nice(it.date)) + ' · ' + (credit ? 'Money in' : 'Money out') + '</span><b class="bm-text">' + e_(it.text) + '</b></div><span class="bm-big ' + (credit ? 'in' : '') + '">' + (credit ? '+' : '−') + ' ' + m_(it.amount) + '</span></div>' +
      '<div class="bm-sugg"><span class="tag ' + st[0] + '">' + st[1] + '</span>' + (it.claude ? '<span class="tag info">Claude checked</span>' : '') + '<span class="note">' + e_(p.why || '') + '</span></div>';
    if (cands.length) {
      h += '<div class="bm-cands"><span class="mono">' + (credit ? 'Invoices it could be' : 'Already in your books') + '</span>' + cands.map(function (c) { return bmCand(it, c, kind); }).join('') +
        '<button type="button" class="bm-cand' + (newOn ? ' on' : '') + '" data-bmpick="' + e_(it.id + '|' + (credit ? 'income' : 'new') + '|') + '" aria-pressed="' + newOn + '"><span class="bm-radio"></span><span class="bm-ct"><span><b>None of these</b>: ' + (credit ? 'record as new income' : 'create a new cost') + '</span></span></button></div>';
    }
    if (isNew || bm.open[it.id]) h += bmForm(it, bm.open[it.id] && !isNew);
    var label = sel.mode === 'invoice' ? 'Approve: mark ' + sel.ref + ' paid' : sel.mode === 'entry' ? 'Approve: link to ' + sel.ref : sel.mode === 'group' ? 'Approve: pay this split bill' : credit ? 'Approve: create income' : 'Approve: create cost';
    if (isNew) { var f = bmFields(it); label += (f.project ? ' on ' + e_(((project(f.project) || {}).name || f.project).slice(0, 28)) : '') + (f.shoot ? ' · ' + e_(f.shoot) : ''); }
    if (bm.open[it.id] && !isNew) label = 'Approve with my changes';
    if (bm.errs[it.id]) h += '<p class="bm-err" role="alert">' + e_(bm.errs[it.id]) + '</p>';
    h += '<div class="btnrow bm-acts"><button type="button" class="btn primary obx-sm" data-bmgo="' + e_(it.id) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : label) + '</button>' +
      (bm.open[it.id] ? '<button type="button" class="btn obx-sm" data-bmreject="' + e_(it.id) + '">Cancel</button><button type="button" class="btn obx-sm ic-del" data-bmignore="' + e_(it.id) + '">Ignore this line</button>' :
        '<button type="button" class="btn obx-sm" data-bmreject="' + e_(it.id) + '"' + (busy ? ' disabled' : '') + '>Reject: correct it</button>') + '</div></div>';
    return h;
  }
  function bmPanelHtml() {
    if (!admin()) return '';
    if (bm.err) return '<div class="panel bm-panel"><span class="h2big">Bank matches</span><div class="banner" style="margin:0">Could not work out matches: ' + e_bmErr() + ' <a class="link" data-bmreload tabindex="0">Try again</a></div></div>';
    if (!bm.loaded) return '<div class="panel bm-panel"><span class="h2big">Bank matches</span>' + (bmAutoHtml() || '<div class="note">Looking at your bank lines…</div>') + '</div>';
    if (!bm.items.length) return (bm.auto.list || []).length ? '<div class="panel bm-panel"><span class="h2big">Bank matches</span><div class="note">Nothing needs you. Every bank line is sorted.</div>' + bmAutoHtml() + '</div>' : '';
    return '<div class="panel bm-panel"><div class="bm-head"><div><span class="h2big">Bank matches · ' + bm.items.length + '</span><div class="note">Each line from your statements, matched against your invoices, bills, projects and shoots. Only lines that need you are listed here.</div></div></div>' + bmAutoHtml() +
      (bm.asking ? '<div class="bm-status"><span class="ob-spin bm-spin"></span>Claude is checking ' + bm.asking + ' uncertain line' + (bm.asking === 1 ? '' : 's') + ' against the app…</div>' : '') +
      (bm.askErr ? '<div class="note bm-askerr">Claude could not check the uncertain lines (' + e_(bm.askErr) + '). The rule-based suggestions are shown.</div>' : '') +
      dl('bm-payees', payees()) + '<div class="bm-list">' + bm.items.map(bmCardHtml).join('') + '</div></div>';
  }
  function e_bmErr() { return e_(bm.err); }
  /** Repaints only the match panel (and a single card when given), so the page never jumps. */
  function bmPaint(id) {
    var host = $('obx-bm'); if (!host) return;
    if (id) { var c = host.querySelector('[data-bmcard="' + id + '"]'), it = bmItem(id); if (c && it) { var t = document.createElement('div'); t.innerHTML = bmCardHtml(it); c.replaceWith(t.firstChild); return; } }
    host.innerHTML = bmPanelHtml();
  }
  OBX.bankMatches = function () { if (!admin()) return ''; setTimeout(function () { bmLoad(); }, 0); return '<div id="obx-bm">' + bmPanelHtml() + '</div>'; };

  function bmChoice(it) {
    var sel = bmSel(it), f = bmFields(it);
    if (bm.open[it.id] && (sel.mode === 'invoice' || sel.mode === 'entry' || sel.mode === 'group')) { /* correcting a match: use the form */ sel = { mode: it.direction === 'credit' ? 'income' : 'new' }; }
    if ((sel.mode === 'new' || sel.mode === 'income') && f.invoice) return { mode: 'invoice', ref: f.invoice };
    if (sel.mode === 'new' || sel.mode === 'income') return { mode: sel.mode, client: f.client, project: f.project, shoot: f.shoot, payee: f.payee, cost_type: f.cost_type, description: f.description };
    return { mode: sel.mode, ref: sel.ref };
  }
  function bmApprove(id) {
    var it = bmItem(id); if (!it || bm.busy[id]) return;
    var ch = bmChoice(it);
    if ((ch.mode === 'new' || ch.mode === 'income') && !String(ch.payee || '').trim()) { bm.errs[id] = 'Enter who ' + (it.direction === 'credit' ? 'paid' : 'was paid') + '.'; bmPaint(id); return; }
    bm.busy[id] = 1; delete bm.errs[id]; bmPaint(id);
    api('obwBankApply', [id, ch]).then(function (r) {
      var card = document.querySelector('[data-bmcard="' + id + '"]');
      var done = function () {
        bm.items = bm.items.filter(function (x) { return x.id !== id; }); delete bm.busy[id];
        bmPaint(); renderNav();
        say('Approved: ' + (ch.mode === 'invoice' ? ch.ref + ' marked paid' : ch.mode === 'entry' || ch.mode === 'group' ? 'linked to ' + r.ref : 'new ' + (it.direction === 'credit' ? 'income' : 'cost') + ' ' + r.ref + ' created'), true);
        if (window.reloadData) reloadData(function () { if (state.view === 'bank') { /* keep the page as it is */ } }); else rerender();
      };
      if (card) collapse(card, done); else done();
    }, function (e) { delete bm.busy[id]; bm.errs[id] = e.message; bmPaint(id); });
  }
  function bmIgnore(id, btn) {
    if (btn.getAttribute('data-armed') !== '1') { btn.setAttribute('data-armed', '1'); btn.textContent = 'Tap again to ignore'; return; }
    btn.disabled = true; btn.textContent = 'Ignoring…';
    api('rejectItem', [id, 'Ignored from the bank match list']).then(function () {
      var card = document.querySelector('[data-bmcard="' + id + '"]');
      var done = function () { bm.items = bm.items.filter(function (x) { return x.id !== id; }); bmPaint(); renderNav(); say('Ignored. The bank line is marked as not for the books.', true); };
      if (card) collapse(card, done); else done();
    }, function (e) { btn.disabled = false; btn.removeAttribute('data-armed'); btn.textContent = 'Ignore this line'; bm.errs[id] = e.message; bmPaint(id); });
  }
  document.addEventListener('change', function (ev) {
    var el = ev.target, k = el.getAttribute && el.getAttribute('data-bmf'); if (!k) return;
    var p = k.split('|'), it = bmItem(p[0]); if (!it) return; var f = bmFields(it); f[p[1]] = el.value;
    if (p[1] === 'client') { var pr = project(f.project); if (pr && f.client && pr.client !== f.client) { f.project = ''; f.shoot = ''; } if (!f.invoice || (bmOpenInvoices(f.client).every(function (i) { return i.number !== f.invoice; }))) f.invoice = ''; if (!f.payee || it.direction === 'credit') f.payee = f.client || f.payee; }
    if (p[1] === 'project') { f.shoot = ''; var pr2 = project(el.value); if (pr2 && pr2.client) f.client = pr2.client; }
    if (p[1] === 'invoice' && el.value) { var iv = (DATA.invoices || []).filter(function (i) { return i.number === el.value; })[0]; if (iv) { f.client = iv.client; f.project = iv.project || f.project; f.payee = iv.client; } }
    if (/^(client|project|invoice)$/.test(p[1])) { var a = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-bmf'); bmPaint(p[0]); var back = document.querySelector('[data-bmf="' + a + '"]'); if (back) back.focus(); }
  }, true);

  /* ---------- unpaid invoices, ready to screenshot for the client ---------- */
  function unpaidOf(p) {
    return (DATA.invoices || []).filter(function (i) { return i.project === p.id && ['draft', 'paid', 'void', 'cancelled'].indexOf(i.status) === -1 && !(window.invLegacy && invLegacy(i)); })
      .map(function (i) { var bal = n_(i.total) - n_(i.advance_applied) - (i.status === 'paid' ? 0 : n_(i.paid_amount)); return { number: i.number, subject: String(i.subject || '').trim() || ((shootOfInvoice(i.number) || {}).name) || ('Invoice for ' + p.name), balance: Math.round(bal * 100) / 100, part: n_(i.paid_amount) > 0 }; })
      .filter(function (i) { return i.balance > 0.005; }).sort(function (a, b) { return String(a.number).localeCompare(String(b.number)); });
  }
  function shootOfInvoice(no) { return shoots.list.filter(function (s) { return s.invoice_no === no; })[0]; }
  OBX.unpaidBlock = function (p) {
    var l = unpaidOf(p); if (!l.length) return '';
    var tot = l.reduce(function (t, i) { return t + i.balance; }, 0);
    return '<div class="sec uip-wrap"><div class="uip" id="uip-' + e_(p.id) + '"><div class="uip-bar"></div><div class="uip-in"><div class="uip-top"><span class="uip-brand">OFFSET MEDIA</span><span class="uip-date">As at ' + e_(nice(today())) + '</span></div>' +
      '<h3 class="uip-h">Unpaid invoices</h3><p class="uip-sub">' + e_(p.client || '') + (p.client ? ' · ' : '') + e_(p.name) + '</p>' +
      '<table class="uip-t"><thead><tr><th>Invoice</th><th>Subject</th><th class="r">Amount (LKR)</th></tr></thead><tbody>' + l.map(function (i) { return '<tr><td class="no">' + e_(i.number) + '</td><td>' + e_(i.subject) + '</td><td class="r">' + m_(i.balance) + '</td></tr>'; }).join('') + '</tbody>' +
      '<tfoot><tr><td colspan="2">Total unpaid</td><td class="r">' + m_(tot) + '</td></tr></tfoot></table></div></div>' +
      '<div class="btnrow uip-acts"><button class="btn obx-sm" data-obx="uip-copy" data-pid="' + e_(p.id) + '">Copy as image</button><button class="btn obx-sm" data-obx="uip-save" data-pid="' + e_(p.id) + '">Save image</button><span class="note">Ready to screenshot or send to the client. Shows no costs or notes.</span></div></div>';
  };
  function uipCanvas(p) {
    var l = unpaidOf(p), tot = l.reduce(function (t, i) { return t + i.balance; }, 0), S = 2, W = 820, pad = 40, F = '"Inter","Helvetica Neue",Arial,sans-serif';
    var c = document.createElement('canvas'), x = c.getContext('2d');
    function wrap(t, w, font) { x.font = font; var words = String(t).split(' '), lines = [], cur = ''; words.forEach(function (wd) { var tt = cur ? cur + ' ' + wd : wd; if (x.measureText(tt).width > w && cur) { lines.push(cur); cur = wd; } else cur = tt; }); if (cur) lines.push(cur); return lines.slice(0, 3); }
    var rows = l.map(function (i) { return { no: i.number, lines: wrap(i.subject, 380, '500 15px ' + F), amt: m_(i.balance) }; });
    var H = 40 + 150 + rows.reduce(function (t, r) { return t + 22 + Math.max(1, r.lines.length) * 21; }, 0) + 76 + 30;
    c.width = W * S; c.height = H * S; x.scale(S, S);
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    var g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#17181B'); g.addColorStop(1, '#E5814F'); x.fillStyle = g; x.fillRect(0, 0, W, 4);
    x.fillStyle = '#17181B'; x.font = '800 18px ' + F; x.textBaseline = 'alphabetic'; x.fillText('OFFSET MEDIA', pad, 52);
    x.fillStyle = '#6B6585'; x.font = '500 13px ' + F; x.textAlign = 'right'; x.fillText('As at ' + nice(today()), W - pad, 52); x.textAlign = 'left';
    x.fillStyle = '#15122A'; x.font = '800 30px ' + F; x.fillText('Unpaid invoices', pad, 98);
    x.fillStyle = '#6B6585'; x.font = '500 15px ' + F; x.fillText((p.client ? p.client + ' · ' : '') + p.name, pad, 124);
    var y = 150; x.strokeStyle = '#15122A'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();
    x.fillStyle = '#6B6585'; x.font = '600 11px ' + F; x.fillText('INVOICE', pad, y + 22); x.fillText('SUBJECT', pad + 150, y + 22); x.textAlign = 'right'; x.fillText('AMOUNT (LKR)', W - pad, y + 22); x.textAlign = 'left'; y += 34;
    rows.forEach(function (r) {
      y += 22; x.fillStyle = '#15122A'; x.font = '700 15px ' + F; x.fillText(r.no, pad, y); x.font = '500 15px ' + F;
      r.lines.forEach(function (t, k) { x.fillText(t, pad + 150, y + k * 21); });
      x.font = '700 15px ' + F; x.textAlign = 'right'; x.fillText(r.amt, W - pad, y); x.textAlign = 'left';
      y += Math.max(1, r.lines.length) * 21 - 14; x.strokeStyle = '#E6E3F0'; x.lineWidth = 1; x.beginPath(); x.moveTo(pad, y + 8); x.lineTo(W - pad, y + 8); x.stroke(); y += 8;
    });
    y += 34; x.fillStyle = '#15122A'; x.font = '700 15px ' + F; x.fillText('Total unpaid', pad, y); x.font = '800 24px ' + F; x.textAlign = 'right'; x.fillStyle = '#17181B'; x.fillText('LKR ' + m_(tot), W - pad, y + 2); x.textAlign = 'left';
    return c;
  }
  function uipImage(p, mode, btn) {
    var c = uipCanvas(p), name = 'Unpaid-invoices-' + String(p.name).replace(/[^\w]+/g, '-').slice(0, 40) + '.png';
    function save() { c.toBlob(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000); say('Image saved', true); }); }
    if (mode === 'save' || !(navigator.clipboard && window.ClipboardItem)) { save(); return; }
    c.toBlob(function (b) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(function () { say('Copied. Paste it into WhatsApp or email.', true); }, function () { save(); });
    });
  }

  /* ---------- small helpers for smooth lists ---------- */
  function collapse(node, done) {
    node.style.height = node.offsetHeight + 'px'; node.offsetHeight; node.classList.add('leaving'); node.style.height = '0px';
    var fin = false; function end() { if (fin) return; fin = true; done(); } node.addEventListener('transitionend', end); setTimeout(end, 260);
  }
  function keepScroll(fn) { var y = window.scrollY; fn(); window.scrollTo(0, y); }
  function snack(msg, label, fn) {
    var s = $('obx-snack'); if (!s) { s = document.createElement('div'); s.id = 'obx-snack'; s.setAttribute('role', 'status'); document.body.appendChild(s); }
    s.innerHTML = '<span></span><button type="button"></button>'; s.firstChild.textContent = msg; var b = s.lastChild; b.textContent = label || ''; b.hidden = !label;
    b.onclick = function () { s.classList.remove('on'); if (fn) fn(); }; s.classList.add('on'); clearTimeout(snack.h); snack.h = setTimeout(function () { s.classList.remove('on'); }, 7000);
  }

  function setBusy(card, on, label) {
    if (!card) return;
    Array.prototype.forEach.call(card.querySelectorAll('button'), function (b) { b.disabled = on; if (on && b.hasAttribute('data-obxdis') && label) { b.setAttribute('data-was', b.textContent); b.textContent = label; } else if (!on && b.hasAttribute('data-was')) { b.textContent = b.getAttribute('data-was'); b.removeAttribute('data-was'); } });
    card.classList.toggle('busy', !!on); var er = card.querySelector('.ic-err'); if (er && on) er.remove();
  }
  function cardError(card, msg) { if (!card) { say(msg); return; } var er = card.querySelector('.ic-err'); if (!er) { er = document.createElement('p'); er.className = 'ic-err'; er.setAttribute('role', 'alert'); card.querySelector('.ic-acts').before(er); } er.textContent = msg + ' Nothing was changed.'; }
  /** After an item is dismissed or fixed: fade out that row (and any other row that is now done), then fix the counts. No full redraw, no jump. */
  function inboxTidy(first, after) {
    var host = document.querySelector('.obx-issues'); if (!host) { if (after) after(); return; }
    var nodes = Array.prototype.slice.call(host.querySelectorAll('.ic-issue')).filter(function (n) {
      if (n === first) return true;
      var x = null; inbox.messages.forEach(function (m) { (m.issues || []).forEach(function (i) { if (i.key === n.getAttribute('data-ikey')) x = i; }); });
      return !x || resolved(x);
    });
    if (!nodes.length) { if (after) after(); return; }
    var left = nodes.length;
    nodes.forEach(function (n) { collapse(n, function () { n.remove(); if (--left === 0) { inboxCount(); if (after) after(); } }); });
  }
  function inboxCount() {
    var host = document.querySelector('.obx-issues'); if (!host) return;
    Array.prototype.slice.call(host.querySelectorAll('.ic-group')).forEach(function (g) {
      var n = 0, sib = g.nextElementSibling; while (sib && !sib.classList.contains('ic-group')) { if (sib.classList.contains('ic-issue')) n++; sib = sib.nextElementSibling; }
      if (!n) g.remove(); else { var c = g.querySelector('.note'); if (c) c.textContent = n; }
    });
    if (!host.querySelector('.ic-issue')) { host.outerHTML = '<p class="note ic-empty">Nothing to fix. 🎉</p>'; }
    var sel = inbox.messages.filter(function (m) { return m.id === inbox.sel; })[0] || inbox.messages[0], li = document.querySelector('.obx-msg.on');
    if (sel && li) { var hi = (sel.issues || []).filter(function (x) { return x.severity === 'high' && !resolved(x); }).length, tg = li.querySelector('.tag'); if (tg && !hi) tg.remove(); else if (tg) tg.textContent = hi + ' urgent'; }
  }

  /* ---------- clicks (capture phase, so legacy handlers never see ours) ---------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target; if (!t.closest) return;
    var menu = $('obx-menu');
    if (menu && !menu.hidden && !t.closest('.obx-addwrap')) menu.hidden = true;
    if (t.closest('#obx-modal [data-act]')) closeM();   // e.g. "+ Add cost to this shoot" opens the original cost form
    var el = t.closest('[data-obx],[data-obxbill],[data-obxrev],[data-obxsplit],[data-obxover],[data-obxmsg],[data-obxfix],[data-obxdis],[data-obxdel],[data-bmgo],[data-bmpick],[data-bmreject],[data-bmignore],[data-bmreload],[data-obxundo],[data-bmundo]');
    if (!el) { if (menu && t.closest('#obx-menu [data-act]')) menu.hidden = true; return; }
    ev.stopPropagation(); ev.preventDefault();
    var a = el.getAttribute('data-obx');
    if (a === 'close') closeM();
    else if (a === 'addmenu') { if (menu) menu.hidden = !menu.hidden; }
    else if (a === 'split-new') { if (menu) menu.hidden = true; billForm([], null); }
    else if (a === 'upload') { if (menu) menu.hidden = true; OBX.pickFiles(); }
    else if (a === 'review-start') OBX.review(0);
    else if (a === 'goai') { state.etab = 'ai'; go('entries'); }
    else if (a === 'runcheck') runCheck('manual', el);
    else if (a === 'refresh') refresh();
    else if (a === 'uip-copy' || a === 'uip-save') { var up0 = project(el.getAttribute('data-pid')); if (up0) uipImage(up0, a === 'uip-save' ? 'save' : 'copy', el); }
    else if (a === 'theme-flip') OBX.setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    else if (a === 'theme') OBX.setTheme(el.getAttribute('data-theme-pref'));
    else if (a === 'signout') window.OBSignOut && window.OBSignOut();
    else if (el.hasAttribute('data-obxbill')) { var b = DATA.entries.filter(function (x) { return x.bill_id === el.getAttribute('data-obxbill'); })[0]; if (b) OBX.openBillFor(b); }
    else if (el.hasAttribute('data-obxrev')) OBX.review(Number(el.getAttribute('data-obxrev')));
    else if (el.hasAttribute('data-obxsplit')) OBX.openBillFor(findEntry(el.getAttribute('data-obxsplit')));
    else if (el.hasAttribute('data-obxover')) {
      var id = el.getAttribute('data-obxover'); el.disabled = true;
      api('obwSaveEntry', [{ id: id, allocation: 'overhead', auto_account: true }]).then(function (saved) {
        DATA.entries = DATA.entries.map(function (x) { return String(x.id) === id ? Object.assign({}, x, saved) : x; }); rerender(); say('Marked as overhead', true);
      }, function (e) { el.disabled = false; say(e.message); });
    }
    else if (el.hasAttribute('data-obxmsg')) { inbox.sel = el.getAttribute('data-obxmsg'); go('inbox'); }
    else if (el.hasAttribute('data-obxfix')) { try { fix(JSON.parse(el.getAttribute('data-obxfix'))); } catch (x) { /* ignore */ } }
    else if (el.hasAttribute('data-obxdel')) {
      var did = el.getAttribute('data-obxdel'), de = findEntry(did); if (!de) { inboxTidy(); return; }
      if (el.getAttribute('data-armed') !== '1') { el.setAttribute('data-armed', '1'); el.textContent = 'Tap again to delete LKR ' + m0(de.amount); return; }
      var card = el.closest('.ic-issue'); setBusy(card, true, 'Deleting…');
      api('obwDeleteEntry', [did, 'Deleted from the Inbox check']).then(function () {
        DATA.entries = DATA.entries.filter(function (x) { return String(x.id) !== did; }); try { window.C = compute(); } catch (x) { /* ignore */ }
        inboxTidy(); say('Deleted ' + (de.payee || 'the line') + ', LKR ' + m0(de.amount) + '. It is kept in the audit log.', true);
      }, function (e) { setBusy(card, false); el.removeAttribute('data-armed'); el.textContent = 'Delete this one'; cardError(card, e.message); });
    }
    else if (el.hasAttribute('data-obxdis')) {
      var key = el.getAttribute('data-obxdis'), card2 = el.closest('.ic-issue'), goneList = [];
      inbox.messages.forEach(function (m) { (m.issues || []).forEach(function (x) { if (x.key === key) goneList.push([m, x]); }); });
      setBusy(card2, true, 'Dismissing…');
      api('obwInboxAction', ['', 'dismiss', key]).then(function () {
        inbox.messages.forEach(function (m) { m.issues = (m.issues || []).filter(function (x) { return x.key !== key; }); });
        var next = card2 && card2.nextElementSibling, parent = card2 && card2.parentNode;
        inboxTidy(card2, function () {
          snack('Dismissed. It will not come back.', 'Undo', function () {
            api('obwInboxAction', ['', 'undismiss', key]).then(function () {
              goneList.forEach(function (g) { g[0].issues = (g[0].issues || []).concat([g[1]]); });
              keepScroll(function () { go('inbox'); }); say('Restored', true);
            }, function (e) { say(e.message); });
          });
        });
      }, function (e) { setBusy(card2, false); cardError(card2, e.message); });
    }
    else if (el.hasAttribute('data-bmgo')) bmApprove(el.getAttribute('data-bmgo'));
    else if (el.hasAttribute('data-bmpick')) {
      var bp = el.getAttribute('data-bmpick').split('|'), bit = bmItem(bp[0]); if (bit) { bm.sel[bp[0]] = { mode: bp[1], ref: bp[2] }; delete bm.errs[bp[0]]; bmPaint(bp[0]); }
    }
    else if (el.hasAttribute('data-bmreject')) { var rid = el.getAttribute('data-bmreject'); bm.open[rid] = !bm.open[rid]; if (bm.open[rid]) { delete bm.edit[rid]; } bmPaint(rid); }
    else if (el.hasAttribute('data-bmignore')) bmIgnore(el.getAttribute('data-bmignore'), el);
    else if (el.hasAttribute('data-bmundo')) {
      var uid = el.getAttribute('data-bmundo'); if (bm.busy[uid]) return; bm.busy[uid] = 1; bmPaint();
      api('obwBankUndo', [uid]).then(function () { delete bm.busy[uid]; toast('Put back on your list', true); bm.loaded = false; if (window.reloadData) reloadData(function () { bmLoad(true); }); else bmLoad(true); },
        function (e) { delete bm.busy[uid]; toast(e.message); bmPaint(); });
    }
    else if (el.hasAttribute('data-bmreload')) { bm.err = ''; bm.loaded = false; bmPaint(); bmLoad(true); }
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && $('obx-modal')) { closeM(); return; }
    if (ev.key === 'Enter' && ev.target.closest && ev.target.closest('[data-obxrev]')) OBX.review(Number(ev.target.closest('[data-obxrev]').getAttribute('data-obxrev')));
  });
  document.addEventListener('change', function (ev) { if (ev.target.id === 'obx-files') { upload(ev.target.files); ev.target.value = ''; } }, true);
  document.addEventListener('dragover', function (ev) { var d = ev.target.closest && ev.target.closest('#obx-drop'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', function (ev) { var d = ev.target.closest && ev.target.closest('#obx-drop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', function (ev) { var d = ev.target.closest && ev.target.closest('#obx-drop'); if (d) { ev.preventDefault(); d.classList.remove('over'); upload(ev.dataTransfer.files); } });
  window.addEventListener('beforeunload', function (ev) { if (up.total > 0) { ev.preventDefault(); ev.returnValue = ''; } });
  window.addEventListener('resize', function () { if (window.renderNav && window.DATA && window.state) renderNav(); });
})();
