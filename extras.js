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
    var items = NAV.filter(function (n) { return n.sec && n.roles.indexOf(ROLE) >= 0; });
    return '<div class="head"><div><span class="mono">Offset Books</span><h1>More</h1></div></div>' +
      '<div class="obx-more">' + items.map(function (n) { return '<a class="card obx-link" data-view="' + n.id + '" tabindex="0">' + OBX.icon(n.id) + '<b>' + e_(n.label) + '</b></a>'; }).join('') + '</div>' +
      '<div class="card" style="margin-top:14px"><span class="mono">Theme</span><div style="margin-top:10px">' + themeSeg() + '</div></div>' +
      '<div class="card" style="margin-top:14px"><span class="mono">Signed in</span><p style="margin:8px 0 12px">' + e_(DATA.user.name || DATA.user.email) + ' · ' + e_(ROLE) + '</p>' +
      '<div class="btnrow"><button class="btn" data-obx="refresh">Refresh data</button><button class="btn" data-obx="signout">Sign out</button></div>' +
      '<p class="note" style="margin-top:12px">To install: iPhone, Safari › Share › Add to Home Screen. Mac or PC, Chrome or Edge › Install Offset Books.</p></div>';
  };


  /* ---------- light / dark theme ---------- */
  function savedTheme() { try { return localStorage.getItem('ob_theme') || 'dark'; } catch (x) { return 'dark'; } }
  function applyTheme(pref) {
    var t = pref === 'auto' ? ((window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark') : pref;
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t === 'light' ? '#F5F3FA' : '#07060D');
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
    api('obwInbox', []).then(function (r) { inbox.messages = r.messages || []; inbox.weekly = r.weekly; inbox.loaded = true; renderNav(); if (state.view === 'inbox' || state.view === 'dashboard') go(state.view); if (then) then(); },
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
      renderNav(); if (state.view === 'inbox' || state.view === 'dashboard') go(state.view);
      say('Check done: ' + r.message.title.replace(/^Weekly check: /, ''), true);
    }, function (e) { if (btn) { btn.disabled = false; btn.textContent = 'Run check now'; } say(e.message); });
  }

  OBX.dashBanner = function () {
    if (!admin()) return '';
    var h = '', m = inbox.messages[0], nr = OBX.reviews().length;
    if (m && m.status === 'unread' && (m.issues || []).length) h += '<button class="obx-banner" data-view="inbox"><span class="tag late">Claude</span><span><b>' + e_(m.title) + '.</b> ' + e_(String(m.body || '').slice(0, 140)) + (String(m.body || '').length > 140 ? '…' : '') + '</span><span class="obx-go">Open inbox ›</span></button>';
    if (nr) h += '<button class="obx-banner" data-obx="goai"><span class="tag info">Bills</span><span><b>' + nr + ' bill' + (nr === 1 ? '' : 's') + '</b> read by Claude ' + (nr === 1 ? 'is' : 'are') + ' waiting for your approval.</span><span class="obx-go">Review ›</span></button>';
    return h;
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
    var is = sel.issues || [];
    if (is.length) h += '<div class="obx-issues">' + is.map(function (x) {
      var sv = SEV[x.severity] || SEV.low;
      return '<div class="obx-issue"><div><span class="tag ' + sv[0] + '">' + sv[1] + '</span> <b>' + e_(x.title) + '</b><p class="note">' + e_(x.detail) + '</p></div><div class="btnrow">' +
        (x.action ? '<button class="btn primary obx-sm" data-obxfix="' + e_(JSON.stringify(x.action)) + '">Fix</button>' : '') + '<button class="btn obx-sm" data-obxdis="' + e_(x.key) + '">Dismiss</button></div></div>';
    }).join('') + '</div>';
    else h += '<p class="note">Nothing to fix. 🎉</p>';
    return h + '</div></div>';
  };

  function fix(a) {
    if (!a) return;
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

  /* ---------- clicks (capture phase, so legacy handlers never see ours) ---------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target; if (!t.closest) return;
    var menu = $('obx-menu');
    if (menu && !menu.hidden && !t.closest('.obx-addwrap')) menu.hidden = true;
    if (t.closest('#obx-modal [data-act]')) closeM();   // e.g. "+ Add cost to this shoot" opens the original cost form
    var el = t.closest('[data-obx],[data-obxbill],[data-obxrev],[data-obxsplit],[data-obxover],[data-obxmsg],[data-obxfix],[data-obxdis]');
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
    else if (el.hasAttribute('data-obxdis')) {
      var key = el.getAttribute('data-obxdis');
      inbox.messages.forEach(function (m) { m.issues = (m.issues || []).filter(function (x) { return x.key !== key; }); }); go('inbox');
      api('obwInboxAction', ['', 'dismiss', key]).then(function () { say('Dismissed. It won\'t come back in future checks.', true); }, function (e) { say(e.message); });
    }
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
