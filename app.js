(function () {
  'use strict';
  var CFG = window.OB_CONFIG || {};
  var state = { token: '', data: null, meta: null, metaError: '', view: 'dashboard', projectId: '', gsiLoaded: false, started: false,
    tokenWaiters: [], refreshTimer: null, entryFilter: { q: '', kind: '', month: '', project: '' }, entryLimit: 150 };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
  function blank(v) { return v === '' || v == null; }
  function money(n) { var v = num(n); return (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function money0(n) { return Math.round(num(n)).toLocaleString('en-US'); }
  function lkr(n) { return 'LKR ' + money0(n); }
  function ym(d) { return String(d || '').slice(0, 7); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monLabel(m) { return MON[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4); }
  function show(id) { ['screen-signin', 'screen-setup', 'screen-loading'].forEach(function (s) { $(s).hidden = s !== id; }); $('app').hidden = true; }
  function showApp() { ['screen-signin', 'screen-setup', 'screen-loading'].forEach(function (s) { $(s).hidden = true; }); $('app').hidden = false; }
  var toastTimer;
  function toast(msg, isErr) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 7000 : 2500);
  }
  function jwtExp(tok) { try { var p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return Number(p.exp) || 0; } catch (e) { return 0; } }
  function uniq(arr) { var s = {}, out = []; arr.forEach(function (v) { v = String(v == null ? '' : v).trim(); if (v && !s[v]) { s[v] = 1; out.push(v); } }); return out.sort(function (a, b) { return a.localeCompare(b); }); }
  var tmpSeq = 0;
  function tmpId() { return 'tmp' + (++tmpSeq); }
  function isTmp(id) { return /^tmp/.test(String(id)); }

  var BUDGET_TYPES = [
    ['Equipment rental', 'budget_equipment_rental'], ['Crew / freelancer', 'budget_crew'], ['Transport', 'budget_transport'],
    ['Food', 'budget_food'], ['Location & venue', 'budget_location'], ['Other', 'budget_other']
  ];
  var ASSIGNABLE = ['Equipment rental', 'Crew / freelancer', 'Location & venue'];
  var INCOME_TYPES = ['Advance', 'Full payment', 'Balance', 'Other'];
  var PAY_METHODS = ['Bank transfer', 'Debit card', 'Cash', 'Cheque', 'Not paid yet'];
  var STATUSES = ['Planned', 'Quoted', 'In production', 'Delivered', 'Closed', 'Cancelled'];
  var DEFAULT_COST_TYPES = ['Equipment rental', 'Crew / freelancer', 'Transport', 'Food', 'Location & venue', 'Other', 'Staff & salaries', 'Office, software & bills'];

  /* ---------- sign-in (Google Identity Services) ---------- */
  function configured() { return !!(CFG.clientId && CFG.apiUrl); }

  function initGsi() {
    google.accounts.id.initialize({
      client_id: CFG.clientId, callback: onCredential, auto_select: true, hd: 'offset-media.com',
      cancel_on_tap_outside: false, use_fedcm_for_prompt: true
    });
    google.accounts.id.renderButton($('g-button'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
  }

  function onCredential(resp) {
    state.token = resp.credential;
    scheduleRefresh();
    var w = state.tokenWaiters; state.tokenWaiters = [];
    w.forEach(function (f) { f(true); });
    if (!state.data) loadBoot();
  }

  function scheduleRefresh() {
    clearTimeout(state.refreshTimer);
    var exp = jwtExp(state.token), ms = (exp - Math.floor(Date.now() / 1000) - 300) * 1000;
    if (exp && ms > 10000) state.refreshTimer = setTimeout(function () { try { google.accounts.id.prompt(); } catch (e) { /* ignore */ } }, ms);
  }

  function renewToken() {
    return new Promise(function (resolve) {
      state.tokenWaiters.push(resolve);
      try { google.accounts.id.prompt(); } catch (e) { resolve(false); }
      setTimeout(function () { resolve(false); }, 8000);
    });
  }

  function signedOutScreen(msg) {
    state.token = ''; state.data = null; state.meta = null;
    show('screen-signin');
    $('signin-msg').textContent = msg || '';
  }

  function signOut() {
    try { google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    signedOutScreen('');
  }

  /* ---------- API ---------- */
  function api(fn, args, retried) {
    return fetch(CFG.apiUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // avoids a CORS preflight
      body: JSON.stringify({ token: state.token, fn: fn, args: args || [] })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) return j.data;
      if (j.code === 'auth' && !retried) {
        return renewToken().then(function (ok) {
          if (!ok) { var e = new Error(j.error); e.code = 'auth'; throw e; }
          return api(fn, args, true);
        });
      }
      var err = new Error(j.error || 'Something went wrong.'); err.code = j.code; throw err;
    });
  }

  function loadBoot() {
    $('btn-refresh') && ($('btn-refresh').disabled = true);
    var boot = api('getBootData'), meta = api('obwMeta').then(function (m) { return m; }, function (e) { return { _err: e.message || 'Editing is not switched on yet.' }; });
    return Promise.all([boot, meta]).then(function (res) {
      var d = res[0], m = res[1];
      if (m && m._err) { state.meta = null; state.metaError = m._err; }
      else { state.meta = m; state.metaError = ''; mergeExtras(d, m); }
      state.data = d; showApp(); render();
    }).catch(function (e) {
      if (e.code === 'auth' || e.code === 'noaccess') { signedOutScreen(e.message); return; }
      if (state.data) toast(e.message, true);
      else { signedOutScreen(e.message || 'Could not reach the server. Check your connection.'); }
    }).then(function () { $('btn-refresh').disabled = false; });
  }

  function mergeExtras(d, m) {
    var x = (m && m.extras) || {};
    (d.entries || []).forEach(function (e) { var v = x[e.id]; if (v) { if (blank(e.bill_id)) e.bill_id = v.bill_id; if (blank(e.allocation)) e.allocation = v.allocation; } });
  }

  function canEdit() { return !!(state.data && state.data.user.role === 'admin' && state.meta); }
  function costTypes() { var m = state.meta && state.meta.costTypes; return m && Object.keys(m).length ? Object.keys(m) : DEFAULT_COST_TYPES; }

  /* ---------- account codes (mirrors the backend) ---------- */
  function autoAccount(e) {
    if (e.kind === 'income') return e.business_line === 'AI data' ? '4020' : (e.project ? '4010' : '4090');
    var m = state.meta && state.meta.costTypes && state.meta.costTypes[e.cost_type];
    if (!m) return '';
    return (e.project ? (m.project || m.overhead) : (m.overhead || m.project)) || '';
  }
  function accountName(code) {
    var list = (state.meta && state.meta.accounts) || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i], c = String(a.code || a.account || a.id || a.number || '');
      if (c === String(code)) return a.name || a.account_name || a.title || '';
    }
    return '';
  }

  /* ---------- lookups ---------- */
  function projectById(id) { return (state.data.projects || []).filter(function (p) { return String(p.id) === String(id); })[0]; }
  function projectName(id) { var p = projectById(id); return p ? p.name : (id || ''); }
  function entriesOf(pid) { return (state.data.entries || []).filter(function (e) { return String(e.project) === String(pid); }); }
  function needsAssigning(e) {
    return e.kind === 'cost' && e.business_line !== 'AI data' && blank(e.project) && e.allocation !== 'overhead' &&
      (ASSIGNABLE.indexOf(e.cost_type) !== -1 || /^5/.test(String(e.account)));
  }
  function toAssign() { return (state.data.entries || []).filter(needsAssigning).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }); }

  /* ---------- local updates (screen first, server in the background) ---------- */
  function replaceEntry(oldId, next) {
    var list = state.data.entries;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(oldId)) { list[i] = next; return; }
    list.push(next);
  }
  function removeEntries(ids) {
    ids = ids.map(String);
    state.data.entries = state.data.entries.filter(function (e) { return ids.indexOf(String(e.id)) === -1; });
  }
  function replaceProject(oldId, next) {
    var list = state.data.projects;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(oldId)) { list[i] = next; return; }
    list.push(next);
  }
  function snapshot() { return { entries: state.data.entries.slice(), projects: state.data.projects.slice() }; }
  function restore(s) { state.data.entries = s.entries; state.data.projects = s.projects; }

  /** Applies a change on screen at once, sends it, and rolls back with an error if the server says no. */
  function commit(apply, call, onOk, okMsg) {
    var snap = snapshot();
    apply(); render(true);
    setSaving(1);
    return call().then(function (res) {
      onOk && onOk(res); render(true); toast(okMsg || 'Saved');
    }).catch(function (e) {
      restore(snap); render(true); toast('Not saved: ' + (e.message || 'something went wrong'), true);
    }).then(function () { setSaving(-1); });
  }
  var savingCount = 0;
  function setSaving(d) { savingCount += d; var s = $('saving'); if (s) s.hidden = savingCount <= 0; }

  /* ---------- numbers ---------- */
  function fyMonths(settings) {
    var p = String(settings.fy_start || '2026-04-01').split('-'), y = Number(p[0]), m = Number(p[1]) - 1, out = [];
    for (var i = 0; i < 12; i++) { var yy = y + Math.floor((m + i) / 12), mm = (m + i) % 12; out.push(yy + '-' + ('0' + (mm + 1)).slice(-2)); }
    return out;
  }

  function compute(d) {
    var months = fyMonths(d.settings), first = months[0], last = months[11];
    var inM = {}, outM = {}, ai = { income: 0, cost: 0 }, prod = { income: 0, cost: 0 }, byProject = {};
    months.forEach(function (m) { inM[m] = 0; outM[m] = 0; });
    (d.projects || []).forEach(function (p) { byProject[p.id] = { p: p, inv: 0, cost: 0 }; });
    (d.entries || []).forEach(function (e) {
      if ((e.kind !== 'income' && e.kind !== 'cost') || String(e.account) === '1400') return;
      var m = ym(e.date); if (m < first || m > last) return;
      var a = num(e.amount), line = e.business_line === 'AI data' ? ai : prod;
      if (e.kind === 'income') { inM[m] += a; line.income += a; } else { outM[m] += a; line.cost += a; }
      var bp = e.project && byProject[e.project];
      if (bp) { if (e.kind === 'income') bp.inv += a; else bp.cost += a; }
    });
    var income = prod.income + ai.income, cost = prod.cost + ai.cost;
    var today = todayIso(), owed = 0, overdue = 0, openCount = 0;
    (d.invoices || []).forEach(function (i) {
      if (i.status !== 'sent' && i.status !== 'part paid') return;
      var bal = num(i.total) - num(i.advance_applied) - num(i.paid_amount);
      if (bal <= 0.005) return;
      owed += bal; openCount++;
      if (String(i.due) && String(i.due) < today) overdue += bal;
    });
    var pending = (d.approvals || []).filter(function (a) { return a.status === 'pending'; }).length;
    var thisMonth = today.slice(0, 7), used = 0;
    (d.aiusage || []).forEach(function (r) { if (String(r.time).slice(0, 7) === thisMonth) used += num(r.cost_usd); });
    return { months: months, inM: inM, outM: outM, income: income, cost: cost, profit: income - cost, ai: ai, prod: prod, byProject: byProject,
      owed: owed, overdue: overdue, openCount: openCount, pending: pending, spend: used, budget: num(d.settings.claude_monthly_budget_usd) || 4 };
  }

  /* ---------- small view parts ---------- */
  function kpi(label, value, note, cls) {
    return '<div class="card' + (cls === 'profit' ? ' profit' : '') + '"><div class="label">' + esc(label) + '</div><div class="big' + (cls && cls !== 'profit' ? ' ' + cls : '') + '">' + value + '</div>' + (note ? '<div class="note">' + note + '</div>' : '') + '</div>';
  }
  function statusBadge(s) {
    var cls = (s === 'Delivered' || s === 'Closed' || s === 'paid' || s === 'approved' || s === 'invoiced') ? 'good' : (s === 'Cancelled' || s === 'declined' ? 'late' : (s === 'draft' ? 'muted' : (s === 'part paid' ? 'warn' : '')));
    return '<span class="pillbadge ' + cls + '">' + esc(s || '') + '</span>';
  }
  function editBanner() {
    var u = state.data.user;
    if (u.role !== 'admin' || state.meta) return '';
    return '<div class="banner">Editing is not switched on yet: the server answered "' + esc(state.metaError) + '". Add AppWrite.gs to the Apps Script project and redeploy (see apps-script/README.md in the repo).</div>';
  }

  function chartSvg(c) {
    var W = 640, H = 200, padL = 8, padB = 22, padT = 8, n = c.months.length, bw = (W - padL) / n, max = 1;
    c.months.forEach(function (m) { max = Math.max(max, c.inM[m], c.outM[m]); });
    var parts = [];
    c.months.forEach(function (m, i) {
      var x = padL + i * bw, h1 = (Math.max(0, c.inM[m]) / max) * (H - padB - padT), h2 = (Math.max(0, c.outM[m]) / max) * (H - padB - padT), base = H - padB, w = bw * 0.34;
      parts.push('<rect x="' + (x + bw * 0.1).toFixed(1) + '" y="' + (base - h1).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h1.toFixed(1) + '" rx="3" fill="#2B4BFF"><title>' + esc(monLabel(m)) + ' income ' + esc(lkr(c.inM[m])) + '</title></rect>');
      parts.push('<rect x="' + (x + bw * 0.1 + w + 2).toFixed(1) + '" y="' + (base - h2).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h2.toFixed(1) + '" rx="3" fill="#FF2E8A"><title>' + esc(monLabel(m)) + ' costs ' + esc(lkr(c.outM[m])) + '</title></rect>');
      parts.push('<text x="' + (x + bw * 0.45).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="#8E87AA" font-family="JetBrains Mono, monospace">' + MON[Number(m.slice(5, 7)) - 1].toUpperCase() + '</text>');
    });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Income and costs by month">' + parts.join('') + '</svg>' +
      '<div class="legend"><span><i style="background:#2B4BFF"></i>Income</span><span><i style="background:#FF2E8A"></i>Costs</span></div>';
  }

  /* ---------- dashboard ---------- */
  function viewDashboard() {
    var d = state.data, c = compute(d), u = d.user, h = '';
    h += '<h1 class="page-title">Dashboard</h1><p class="sub">Financial year from ' + esc(monLabel(c.months[0])) + '. Accrual basis, LKR.</p>';
    h += editBanner();
    var na = canEdit() ? toAssign().length : 0;
    if (na) h += '<button class="banner warnb" data-go="review" type="button"><b>' + na + ' supplier cost' + (na === 1 ? '' : 's') + '</b> need a project. Tap to assign or split them.</button>';
    var nr = canEdit() ? reviews().length : 0;
    if (nr) h += '<button class="banner warnb" data-go="review" type="button"><b>' + nr + ' bill' + (nr === 1 ? '' : 's') + '</b> read by Claude ' + (nr === 1 ? 'is' : 'are') + ' waiting for your approval.</button>';
    h += '<div class="grid kpis">';
    h += kpi('Profit', lkr(c.profit), 'Income less costs, director loans excluded', 'profit');
    h += kpi('Income', lkr(c.income), 'Production ' + lkr(c.prod.income) + (c.ai.income ? ' · AI data ' + lkr(c.ai.income) : ''));
    h += kpi('Costs', lkr(c.cost), 'Production ' + lkr(c.prod.cost) + (c.ai.cost ? ' · AI data ' + lkr(c.ai.cost) : ''));
    h += kpi('Owed to you', lkr(c.owed), c.openCount + ' open invoice' + (c.openCount === 1 ? '' : 's') + (c.overdue ? ' · <span class="over">' + lkr(c.overdue) + ' overdue</span>' : ''));
    if (d.cash) h += kpi('Bank balance', lkr(d.cash.balance), 'As at ' + esc(d.cash.as_at) + ' statement');
    if (u.role === 'admin') h += kpi('Waiting for approval', String(c.pending), c.pending ? 'Items in the approval queue' : 'Queue is clear', c.pending ? 'warn' : 'good');
    h += '</div>';
    h += '<div class="grid cols"><div class="card"><h3>Income and costs by month</h3>' + chartSvg(c) + '</div>';
    h += '<div class="card"><h3>Top projects</h3>' + projectList(c, 6) + '</div></div>';
    if (u.role === 'admin') {
      var pct = Math.min(100, c.spend / c.budget * 100), cls = pct >= 100 ? 'over' : (pct >= 75 ? 'warn' : '');
      h += '<div class="card" style="margin-top:14px"><div class="label">Claude spend this month</div><div class="big">USD ' + c.spend.toFixed(2) + ' <span class="muted" style="font-size:18px">of ' + c.budget.toFixed(2) + '</span></div>' +
        '<div class="bar ' + cls + '"><i style="width:' + pct.toFixed(0) + '%"></i></div>' +
        '<div class="note">' + (pct >= 100 ? 'AI sorting is paused until next month or until you raise the budget.' : pct >= 75 ? 'Over 75% of the budget used.' : 'Within budget.') + '</div></div>';
    }
    return h;
  }

  function projectList(c, limit) {
    var rows = Object.keys(c.byProject).map(function (k) { return c.byProject[k]; })
      .filter(function (x) { return x.p.business_line !== 'AI data' && (x.inv || x.cost); })
      .sort(function (a, b) { return b.inv - a.inv; }).slice(0, limit);
    if (!rows.length) return '<div class="empty">No project activity yet.</div>';
    return '<ul class="list">' + rows.map(function (x) {
      var pr = x.inv - x.cost;
      return '<li class="clickrow" data-project="' + esc(x.p.id) + '" tabindex="0"><span>' + esc(x.p.name) + '<br><span class="muted" style="font-size:12px">' + esc(x.p.client) + '</span></span><span class="' + (pr < 0 ? 'over' : 'good') + '">' + lkr(pr) + '</span></li>';
    }).join('') + '</ul>';
  }

  /* ---------- projects ---------- */
  function viewProjects() {
    var d = state.data, c = compute(d);
    var rows = Object.keys(c.byProject).map(function (k) { return c.byProject[k]; }).filter(function (x) { return x.p.business_line !== 'AI data'; })
      .sort(function (a, b) { return String(b.p.start || '').localeCompare(String(a.p.start || '')) || b.inv - a.inv; });
    var h = '<div class="titlerow"><div><h1 class="page-title">Projects</h1><p class="sub">Tap a project to see and edit its budget, costs and income.</p></div>' +
      (canEdit() ? '<button class="pill" data-act="new-project" type="button">New project</button>' : '') + '</div>';
    h += editBanner();
    if (!rows.length) return h + '<div class="card empty">No projects yet.</div>';
    h += '<div class="card tablewrap"><table><thead><tr><th>Project</th><th>Client</th><th>Status</th><th class="num">Agreed</th><th class="num">Income</th><th class="num">Costs</th><th class="num">Profit</th></tr></thead><tbody>';
    rows.forEach(function (x) {
      var pr = x.inv - x.cost;
      h += '<tr class="clickrow" data-project="' + esc(x.p.id) + '" tabindex="0"><td><b>' + esc(x.p.name) + '</b></td><td>' + esc(x.p.client) + '</td><td>' + statusBadge(x.p.status) + '</td>' +
        '<td class="num">' + (blank(x.p.agreed_fee) ? '<span class="muted">-</span>' : money0(x.p.agreed_fee)) + '</td>' +
        '<td class="num">' + money0(x.inv) + '</td><td class="num">' + money0(x.cost) + '</td><td class="num ' + (pr < 0 ? 'over' : 'good') + '">' + money0(pr) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    var ai = c.ai;
    if (ai.income || ai.cost) h += '<div class="card" style="margin-top:14px"><div class="label">AI data (monthly totals only)</div><div class="big">' + lkr(ai.income - ai.cost) + '</div><div class="note">Income ' + lkr(ai.income) + ' · Costs ' + lkr(ai.cost) + '</div></div>';
    return h;
  }

  function entryRows(list, opts) {
    opts = opts || {};
    if (!list.length) return '<div class="empty">' + esc(opts.empty || 'Nothing here yet.') + '</div>';
    var edit = canEdit();
    return '<table><thead><tr><th>Date</th><th>Payee</th><th>Description</th>' + (opts.showProject ? '<th>Project</th>' : '') + '<th>Type</th><th>Account</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>' +
      list.map(function (e) {
        var tmp = isTmp(e.id), click = edit && !tmp;
        return '<tr' + (click ? ' class="clickrow" data-entry="' + esc(e.id) + '" tabindex="0"' : '') + (tmp ? ' class="pending"' : '') + '>' +
          '<td class="nowrap">' + esc(e.date) + '</td><td>' + esc(e.payee) + (e.bill_id ? ' <span class="pillbadge small" title="Part of split bill ' + esc(e.bill_id) + '">split</span>' : '') + '</td>' +
          '<td>' + esc(e.description) + (e.shoot ? '<br><span class="muted small">' + esc(e.shoot) + '</span>' : '') + '</td>' +
          (opts.showProject ? '<td>' + (e.project ? esc(projectName(e.project)) : '<span class="muted">' + (e.allocation === 'overhead' ? 'Overhead' : '-') + '</span>') + '</td>' : '') +
          '<td>' + esc(e.cost_type) + '</td><td class="nowrap muted">' + esc(e.account) + '</td><td class="nowrap">' +
          '<span class="pillbadge ' + (e.paid_status === 'paid' ? 'good' : 'warn') + '">' + esc(tmp ? 'saving' : (e.paid_status || '')) + '</span>' +
          (e.doc_url ? ' <a href="' + esc(e.doc_url) + '" target="_blank" rel="noopener">doc</a>' : '') + '</td><td class="num">' + money(e.amount) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function viewProject() {
    var d = state.data, p = projectById(state.projectId);
    if (!p) { state.view = 'projects'; return viewProjects(); }
    var entries = entriesOf(p.id).filter(function (e) { return String(e.account) !== '1400'; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var costs = entries.filter(function (e) { return e.kind === 'cost'; }), income = entries.filter(function (e) { return e.kind === 'income'; });
    var totCost = 0, totInc = 0, byType = {};
    costs.forEach(function (e) { var a = num(e.amount); totCost += a; byType[e.cost_type] = (byType[e.cost_type] || 0) + a; });
    income.forEach(function (e) { totInc += num(e.amount); });
    var invs = (d.invoices || []).filter(function (i) { return String(i.project) === String(p.id) || String(i.project) === String(p.name); });
    var agreed = blank(p.agreed_fee) ? null : num(p.agreed_fee);
    var profit = totInc - totCost, edit = canEdit();

    var h = '<button class="pill ghost" data-go="projects" type="button">&larr; All projects</button>';
    h += '<div class="titlerow" style="margin-top:14px"><div><h1 class="page-title">' + esc(p.name) + '</h1>';
    h += '<p class="sub">' + esc(p.client) + ' · ' + statusBadge(p.status) + (p.start ? ' · ' + esc(p.start) + (p.end ? ' to ' + esc(p.end) : '') : '') + (p.property ? ' · ' + esc(p.property) : '') + '</p></div>';
    if (edit) h += '<div class="btns"><button class="pill ghost" data-act="new-invoice" type="button">New invoice</button><button class="pill ghost" data-act="new-quote" type="button">New quote</button><button class="pill ghost" data-act="edit-project" type="button">Edit project and budget</button></div>';
    h += '</div>';
    h += editBanner();

    h += '<div class="grid kpis">';
    h += kpi('Profit so far', lkr(profit), 'Income recorded less costs', 'profit');
    h += kpi('Agreed fee', agreed == null ? '<span class="muted">-</span>' : lkr(agreed), agreed == null ? 'No fee set' : 'Income recorded ' + lkr(totInc) + (agreed ? ' (' + Math.round(totInc / agreed * 100) + '%)' : ''));
    h += kpi('Costs', lkr(totCost), costs.length + ' line' + (costs.length === 1 ? '' : 's'));
    h += '</div>';

    var rows = '';
    BUDGET_TYPES.forEach(function (t) {
      var b = blank(p[t[1]]) ? null : num(p[t[1]]), a = byType[t[0]] || 0;
      if (b == null && !a) return;
      var pct = b ? Math.min(100, a / b * 100) : 0, cls = b && a > b ? 'over' : (b && pct >= 75 ? 'warn' : '');
      rows += '<tr><td>' + esc(t[0]) + '</td><td class="num">' + (b == null ? '<span class="muted">-</span>' : money0(b)) + '</td><td class="num">' + money0(a) + '</td>' +
        '<td class="num ' + (b != null && a > b ? 'over' : '') + '">' + (b == null ? '<span class="muted">-</span>' : money0(b - a)) + '</td>' +
        '<td style="min-width:90px">' + (b ? '<div class="bar ' + cls + '" style="margin:0"><i style="width:' + pct.toFixed(0) + '%"></i></div>' : '') + '</td></tr>';
    });
    Object.keys(byType).forEach(function (k) {
      if (!BUDGET_TYPES.some(function (t) { return t[0] === k; })) rows += '<tr><td>' + esc(k || 'Uncategorised') + '</td><td class="num"><span class="muted">-</span></td><td class="num">' + money0(byType[k]) + '</td><td class="num"><span class="muted">-</span></td><td></td></tr>';
    });
    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Budget vs actual</h3>' +
      (rows ? '<table><thead><tr><th>Cost type</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Left</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="empty">No budget or costs yet.</div>') +
      (p.budget_url ? '<p class="note"><a href="' + esc(p.budget_url) + '" target="_blank" rel="noopener">Open budget sheet</a></p>' : '') + '</div>';

    h += '<div class="card tablewrap" style="margin-top:14px"><div class="cardhead"><h3>Costs</h3>' + (edit ? '<div class="btns"><button class="pill small" data-act="add-cost" type="button">Add cost</button><button class="pill ghost small" data-act="add-bill" type="button">Add split bill</button></div>' : '') + '</div>' +
      entryRows(costs, { empty: 'No costs recorded against this project.' }) + '</div>';
    h += '<div class="card tablewrap" style="margin-top:14px"><div class="cardhead"><h3>Income</h3>' + (edit ? '<button class="pill ghost small" data-act="add-income" type="button">Add income</button>' : '') + '</div>' +
      entryRows(income, { empty: 'No income recorded against this project.' }) + '</div>';

    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Invoices</h3>' + docTable(invs, 'invoice') + '</div>';
    var pq = quotesAll().filter(function (q) { return String(q.project) === String(p.id); });
    if (pq.length) h += '<div class="card tablewrap" style="margin-top:14px"><h3>Quotes</h3>' + docTable(pq, 'quote') + '</div>';

    if (p.notes) h += '<div class="card" style="margin-top:14px"><h3>Notes</h3><p class="muted" style="white-space:pre-wrap">' + esc(p.notes) + '</p></div>';
    return h;
  }

  /* ---------- all entries ---------- */
  function viewEntries() {
    var f = state.entryFilter, q = f.q.toLowerCase();
    var all = (state.data.entries || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)); });
    var list = all.filter(function (e) {
      if (f.kind && e.kind !== f.kind) return false;
      if (f.month && ym(e.date) !== f.month) return false;
      if (f.project === '-' && !blank(e.project)) return false;
      if (f.project && f.project !== '-' && String(e.project) !== f.project) return false;
      if (q && [e.id, e.payee, e.description, e.cost_type, e.account, e.doc_number, e.notes, e.shoot, projectName(e.project)].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var total = 0; list.forEach(function (e) { total += (e.kind === 'income' ? 1 : -1) * num(e.amount); });
    var months = uniq(all.map(function (e) { return ym(e.date); })).reverse();
    var h = '<div class="titlerow"><div><h1 class="page-title">Entries</h1><p class="sub">Every cost and income line in the books.' + (canEdit() ? ' Tap a line to edit it.' : '') + '</p></div>' +
      (canEdit() ? '<div class="btns"><button class="pill" data-act="add-cost" type="button">Add cost</button><button class="pill ghost" data-act="add-income" type="button">Add income</button><button class="pill ghost" data-act="add-bill" type="button">Add split bill</button></div>' : '') + '</div>';
    h += editBanner();
    h += '<div class="filters card"><input id="f-q" type="search" placeholder="Search payee, description, invoice no." value="' + esc(f.q) + '">' +
      '<select id="f-kind"><option value="">All types</option>' + ['cost', 'income', 'asset'].map(function (k) { return '<option' + (f.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select>' +
      '<select id="f-month"><option value="">All months</option>' + months.map(function (m) { return '<option value="' + m + '"' + (f.month === m ? ' selected' : '') + '>' + monLabel(m) + '</option>'; }).join('') + '</select>' +
      '<select id="f-project"><option value="">All projects</option><option value="-"' + (f.project === '-' ? ' selected' : '') + '>No project (overheads)</option>' + projectOptions(f.project) + '</select></div>';
    h += '<p class="muted small">' + list.length + ' line' + (list.length === 1 ? '' : 's') + ' · net ' + lkr(total) + '</p>';
    h += '<div class="card tablewrap">' + entryRows(list.slice(0, state.entryLimit), { showProject: true, empty: 'No lines match.' }) + '</div>';
    if (list.length > state.entryLimit) h += '<p><button class="pill ghost" data-act="more-entries" type="button">Show more</button></p>';
    return h;
  }

  function projectOptions(sel, includeNone) {
    var ps = (state.data.projects || []).slice().sort(function (a, b) { return String(b.start || '').localeCompare(String(a.start || '')); });
    return (includeNone ? '<option value="">No project (company overhead)</option>' : '') + ps.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (String(sel) === String(p.id) ? ' selected' : '') + '>' + esc(p.name) + ' · ' + esc(p.client) + '</option>';
    }).join('');
  }

  /* ---------- review (bills to read + costs to assign) ---------- */
  function viewReview() {
    var list = toAssign(), rq = reviews(), edit = canEdit();
    var h = '<div class="titlerow"><div><h1 class="page-title">Review</h1><p class="sub">Upload supplier bills and Claude reads them and suggests which project each line belongs to. Nothing goes into the books until you approve it.</p></div></div>';
    h += editBanner();
    if (edit) {
      var busy = uploading.total > 0;
      h += '<label class="dropzone' + (busy ? ' busy' : '') + '" id="dropzone"><input type="file" id="bill-files" accept="application/pdf,image/*" multiple hidden>' +
        '<span class="dz-title">' + (busy ? 'Reading ' + Math.min(uploading.done + 1, uploading.total) + ' of ' + uploading.total + '…' : 'Upload bills') + '</span>' +
        '<span class="muted small">' + (busy ? 'Claude is reading each document. You can keep using the app.' : 'PDFs or photos. Drop them here or tap to choose. Several at once is fine.') + '</span>' +
        (busy ? '<span class="bar" style="width:100%"><i style="width:' + Math.round(uploading.done / uploading.total * 100) + '%"></i></span>' : '') + '</label>';
    }
    h += '<div class="card" style="margin-top:14px"><div class="cardhead"><h3>Bills waiting for you</h3>' + (edit && rq.length ? '<button class="pill small" data-act="start-review" type="button">Review one by one</button>' : '') + '</div>';
    if (!rq.length) h += '<div class="empty">No bills waiting. Upload some above.</div>';
    else h += '<ul class="list">' + rq.map(function (r, i) {
      var s = r.suggestion || {};
      return '<li class="clickrow" data-review="' + i + '" tabindex="0"><span><b>' + esc(s.payee || s.supplier || 'Unknown supplier') + '</b> · ' + esc(s.doc_number || 'no invoice no.') +
        '<br><span class="muted small">' + esc(s.date || '') + ' · ' + (s.lines || []).length + ' line' + ((s.lines || []).length === 1 ? '' : 's') + ' · Claude ' + esc(s.confidence || 'unsure') + '</span></span><span>' + lkr(s.total) + '</span></li>';
    }).join('') + '</ul>';
    h += '</div>';

    h += '<div class="card" style="margin-top:14px"><div class="cardhead"><h3>Costs with no project</h3>' + (edit ? '<button class="pill ghost small" data-act="add-bill" type="button">Add split bill</button>' : '') + '</div>' +
      '<p class="muted small" style="margin-top:0">Rental, crew and studio payments that came in without a project.</p>';
    if (!list.length) h += '<div class="empty">Nothing waiting.</div>';
    else h += '<div class="grid">' + list.map(function (e) {
      return '<div class="assign"><div><div class="label">' + esc(e.date) + ' · ' + esc(e.cost_type) + '</div><div class="big small-big">' + lkr(e.amount) + '</div>' +
        '<div><b>' + esc(e.payee) + '</b> · ' + esc(e.description) + (e.doc_number ? ' · ' + esc(e.doc_number) : '') + '</div>' + (e.notes ? '<div class="note">' + esc(e.notes) + '</div>' : '') + '</div>' +
        (edit ? '<div class="btns"><button class="pill small" data-split="' + esc(e.id) + '" type="button">Assign or split</button><button class="pill ghost small" data-overhead="' + esc(e.id) + '" type="button">It\'s overhead</button></div>' : '') + '</div>';
    }).join('') + '</div>';
    return h + '</div>';
  }

  /* ---------- clients ---------- */
  function clientRowsAll() { return state.data.clients || (state.meta && state.meta.clientRows) || []; }
  function clientNames() {
    var rows = clientRowsAll();
    return uniq(rows.map(function (c) { return c.name; }).concat((state.data.projects || []).map(function (p) { return p.client; })).concat((state.data.invoices || []).map(function (i) { return i.client; })));
  }
  function clientRow(name) { return clientRowsAll().filter(function (c) { return c.name === name; })[0] || { name: name }; }
  function quotesAll() { return state.data.quotes || (state.meta && state.meta.quotes) || []; }
  function clientStats(name) {
    var projects = (state.data.projects || []).filter(function (p) { return p.client === name; }), pids = projects.map(function (p) { return String(p.id); });
    var invoices = (state.data.invoices || []).filter(function (i) { return i.client === name; });
    var quotes = quotesAll().filter(function (q) { return q.client === name; });
    var income = (state.data.entries || []).filter(function (e) { return e.kind === 'income' && (e.payee === name || (pids.indexOf(String(e.project)) !== -1 && blank(e.payee))); });
    var billed = 0, paid = 0, owed = 0, earned = 0;
    invoices.forEach(function (i) { if (i.status === 'draft' || i.status === 'void' || i.status === 'cancelled') return; billed += num(i.total); var p = num(i.paid_amount) + num(i.advance_applied); paid += p; if (i.status === 'sent' || i.status === 'part paid') owed += Math.max(0, num(i.total) - p); });
    income.forEach(function (e) { earned += num(e.amount); });
    return { projects: projects, invoices: invoices, quotes: quotes, income: income, billed: billed, paid: paid, owed: owed, earned: earned };
  }

  function viewClients() {
    var names = clientNames();
    var h = '<div class="titlerow"><div><h1 class="page-title">Clients</h1><p class="sub">Tap a client for their projects, quotes, invoices and payments.</p></div>' +
      (canEdit() ? '<button class="pill" data-act="new-client" type="button">New client</button>' : '') + '</div>';
    h += editBanner();
    if (!names.length) return h + '<div class="card empty">No clients yet.</div>';
    var rows = names.map(function (n) { return { n: n, c: clientRow(n), s: clientStats(n) }; }).sort(function (a, b) { return b.s.earned - a.s.earned || a.n.localeCompare(b.n); });
    h += '<div class="card tablewrap"><table><thead><tr><th>Client</th><th>Type</th><th class="num">Projects</th><th class="num">Income</th><th class="num">Owed</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="clickrow" data-client="' + esc(r.n) + '" tabindex="0"><td><b>' + esc(r.n) + '</b></td><td class="muted">' + esc(r.c.type || '') + '</td><td class="num">' + r.s.projects.length + '</td><td class="num">' + money0(r.s.earned) + '</td><td class="num' + (r.s.owed ? ' warn' : '') + '">' + (r.s.owed ? money0(r.s.owed) : '<span class="muted">-</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return h;
  }

  function docTable(list, kind, showClient) {
    if (!list.length) return '<div class="empty">No ' + kind + 's yet.</div>';
    return '<table><thead><tr><th>Number</th><th>Date</th>' + (kind === 'invoice' ? '<th>Due</th>' : '<th>Valid until</th>') + '<th>Project</th><th>Status</th><th class="num">Total</th>' + (kind === 'invoice' ? '<th class="num">Paid</th>' : '') + '</tr></thead><tbody>' +
      list.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).map(function (i) {
        return '<tr class="clickrow" data-doc="' + kind + ':' + esc(i.number) + '" tabindex="0"><td class="nowrap"><b>' + esc(i.number) + '</b>' + (showClient ? '<br><span class="muted small">' + esc(i.client) + '</span>' : '') + '</td><td class="nowrap">' + esc(i.date) + '</td><td class="nowrap">' + esc(kind === 'invoice' ? i.due : i.valid_until) + '</td>' +
          '<td>' + esc(projectName(i.project)) + '</td><td>' + statusBadge(i.status) + '</td><td class="num">' + money0(i.total) + '</td>' + (kind === 'invoice' ? '<td class="num">' + money0(num(i.paid_amount) + num(i.advance_applied)) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  function viewClient() {
    var name = state.clientName, c = clientRow(name), s = clientStats(name), edit = canEdit();
    var h = '<button class="pill ghost" data-go="clients" type="button">&larr; All clients</button>';
    h += '<div class="titlerow" style="margin-top:14px"><div><h1 class="page-title">' + esc(name) + '</h1><p class="sub">' + [c.type, c.contact, c.phone, c.email].filter(Boolean).map(esc).join(' · ') + '</p></div>' +
      (edit ? '<div class="btns"><button class="pill" data-act="new-invoice" type="button">New invoice</button><button class="pill ghost" data-act="new-quote" type="button">New quote</button><button class="pill ghost" data-act="edit-client" type="button">Edit details</button></div>' : '') + '</div>';
    h += '<div class="grid kpis">' + kpi('Income recorded', lkr(s.earned), s.income.length + ' payment line' + (s.income.length === 1 ? '' : 's'), 'profit') +
      kpi('Invoiced', lkr(s.billed), s.invoices.length + ' invoice' + (s.invoices.length === 1 ? '' : 's')) +
      kpi('Owed', lkr(s.owed), s.owed ? 'On sent invoices' : 'Nothing outstanding', s.owed ? 'warn' : 'good') +
      kpi('Projects', String(s.projects.length), s.quotes.length + ' quote' + (s.quotes.length === 1 ? '' : 's')) + '</div>';
    if (c.notes) h += '<div class="card"><h3>Notes</h3><p class="muted" style="white-space:pre-wrap;margin:0">' + esc(c.notes) + '</p></div>';
    h += '<div class="card" style="margin-top:14px"><h3>Projects</h3>' + (s.projects.length ? '<ul class="list">' + s.projects.map(function (p) {
      return '<li class="clickrow" data-project="' + esc(p.id) + '" tabindex="0"><span>' + esc(p.name) + '<br><span class="muted small">' + esc(p.start || '') + '</span></span><span>' + statusBadge(p.status) + '</span></li>'; }).join('') + '</ul>' : '<div class="empty">No projects.</div>') + '</div>';
    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Invoices</h3>' + docTable(s.invoices, 'invoice') + '</div>';
    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Quotes</h3>' + docTable(s.quotes, 'quote') + '</div>';
    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Payments and income</h3>' + entryRows(s.income.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }), { showProject: true, empty: 'No income recorded.' }) + '</div>';
    return h;
  }

  function openClientForm(c) {
    var isNew = !c, x = c || { type: 'One-off' };
    var body = '<form class="form" novalidate>' + field('Client name', input('name', x.name, isNew ? 'required' : 'readonly')) +
      '<div class="row2">' + field('Type', select('type', pairs(['Recurring', 'One-off', 'One-off (large)']), x.type)) + field('Contact person', input('contact', x.contact)) + '</div>' +
      '<div class="row2">' + field('Phone', input('phone', x.phone, 'type="tel"')) + field('Email', input('email', x.email, 'type="email"')) + '</div>' +
      field('Notes', '<textarea name="notes" rows="3">' + esc(x.notes) + '</textarea>') +
      (isNew ? '' : '<p class="note">The name can\'t be changed here yet, because projects and invoices refer to it.</p>') +
      '<p class="form-err" id="form-err" role="alert"></p><div class="modal-actions"><span class="spacer"></span><button class="pill ghost" type="button" data-close>Cancel</button><button class="pill" type="submit">' + (isNew ? 'Add client' : 'Save') + '</button></div></form>';
    openModal(isNew ? 'New client' : 'Edit ' + x.name, body, function (m) {
      var form = m.querySelector('form');
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = formData(form);
        if (!d.name) { $('form-err').textContent = 'Enter the client name.'; return; }
        if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { $('form-err').textContent = 'That email address doesn\'t look right.'; return; }
        if (!isNew) d.original_name = x.name;
        closeModal();
        var before = clientRowsAll().slice();
        function setRows(rows) { state.data.clients = rows; if (state.meta) state.meta.clientRows = rows; }
        var ok = false;
        commit(function () { setRows(before.filter(function (r) { return r.name !== d.name; }).concat([Object.assign({}, x, d)])); if (isNew) { state.clientName = d.name; state.view = 'client'; } },
          function () { return api('obwSaveClient', [d]); }, function () { ok = true; }, isNew ? 'Client added' : 'Client saved').then(function () {
          if (!ok) { setRows(before); if (isNew) state.view = 'clients'; render(true); }
        });
      });
    });
  }

  /* ---------- sales (invoices and quotes, using the existing generator in Code.gs) ---------- */
  var docFilter = { status: '', q: '' };
  function viewSales() {
    var inv = state.data.invoices || [], q = quotesAll(), c = compute(state.data), edit = state.data.user.role === 'admin';
    var f = docFilter, qq = f.q.toLowerCase();
    function match(d) { return (!f.status || d.status === f.status) && (!qq || [d.number, d.client, d.subject, projectName(d.project)].join(' ').toLowerCase().indexOf(qq) !== -1); }
    var h = '<div class="titlerow"><div><h1 class="page-title">Invoices and quotes</h1><p class="sub">Create, preview, email and record payments. PDFs are filed in Drive automatically.</p></div>' +
      (edit ? '<div class="btns"><button class="pill" data-act="new-invoice" type="button">New invoice</button><button class="pill ghost" data-act="new-quote" type="button">New quote</button></div>' : '') + '</div>';
    h += '<div class="grid kpis">' + kpi('Owed to you', lkr(c.owed), c.openCount + ' open invoice' + (c.openCount === 1 ? '' : 's') + (c.overdue ? ' · <span class="over">' + lkr(c.overdue) + ' overdue</span>' : '')) +
      kpi('Drafts', String(inv.filter(function (x) { return x.status === 'draft'; }).length + q.filter(function (x) { return x.status === 'draft'; }).length), 'Not sent yet') +
      kpi('Quotes out', String(q.filter(function (x) { return x.status === 'sent'; }).length), 'Waiting for an answer') + '</div>';
    h += '<div class="filters card two"><input id="d-q" type="search" placeholder="Search number, client, subject" value="' + esc(f.q) + '"><select id="d-status"><option value="">Any status</option>' +
      ['draft', 'sent', 'part paid', 'paid', 'approved', 'declined', 'invoiced'].map(function (x) { return '<option' + (f.status === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>';
    h += '<div class="card tablewrap"><h3>Invoices</h3>' + docTable(inv.filter(match), 'invoice', true) + '</div>';
    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Quotes</h3>' + docTable(q.filter(match), 'quote', true) + '</div>';
    return h;
  }

  function findDoc(kind, number) { return (kind === 'quote' ? quotesAll() : (state.data.invoices || [])).filter(function (d) { return String(d.number) === String(number); })[0]; }
  function putDoc(kind, d) {
    if (!d || !d.number) return;
    var key = kind === 'quote' ? 'quotes' : 'invoices', list = state.data[key] = (state.data[key] || (kind === 'quote' && state.meta ? state.meta.quotes : []) || []).slice();
    var i = list.findIndex(function (x) { return String(x.number) === String(d.number); });
    if (i === -1) list.push(d); else list[i] = d;
  }
  function putEntries(list) { (list || []).forEach(function (e) { if (e && e.id) replaceEntry(e.id, e); }); }
  /** Applies whatever a Code.gs action returned (invoice, quote, entries, client) to the screen. */
  function applyDocResult(r) {
    if (!r) return;
    if (r.invoice) putDoc('invoice', r.invoice);
    if (r.quote) putDoc('quote', r.quote);
    if (r.entries) putEntries(r.entries);
    if (r.client) { var rows = clientRowsAll().filter(function (c) { return c.name !== r.client.name; }); rows.push(r.client); state.data.clients = rows; }
    if (r.deleted) { state.data.invoices = (state.data.invoices || []).filter(function (x) { return x.number !== r.deleted; }); state.data.quotes = quotesAll().filter(function (x) { return x.number !== r.deleted; }); }
  }
  /** Server-confirmed action (numbers, PDFs and emails come from the server, so these wait for it). */
  function docCall(btn, fn, args, okMsg, then) {
    if (btn) { btn.disabled = true; btn.setAttribute('data-label', btn.textContent); btn.textContent = 'Working…'; }
    setSaving(1);
    return api(fn, args).then(function (r) { applyDocResult(r); render(true); toast(okMsg); then && then(r); },
      function (e) { toast(e.message || 'Something went wrong', true); if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = btn.getAttribute('data-label'); } })
      .then(function () { setSaving(-1); });
  }
  function parseLines(s) { try { var v = typeof s === 'string' ? JSON.parse(s || '[]') : s; return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function addDaysIso(ymd, n) { var d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  /* ----- document view: preview + actions ----- */
  function openDoc(kind, number) {
    var d = findDoc(kind, number); if (!d) return;
    var isInv = kind === 'invoice', st = d.status, edit = state.data.user.role === 'admin';
    var bal = isInv ? num(d.total) - num(d.advance_applied) - num(d.paid_amount) : 0;
    var acts = [];
    if (edit) {
      if (st === 'draft') { acts.push('<button class="pill" type="button" data-a="email">Email to client</button>', '<button class="pill ghost" type="button" data-a="edit">Edit</button>', '<button class="pill ghost" type="button" data-a="marksent">Mark as sent (no email)</button>', '<button class="pill danger" type="button" data-a="delete">Delete draft</button>'); }
      if (isInv && (st === 'sent' || st === 'part paid')) acts.push('<button class="pill" type="button" data-a="pay">Record payment</button>', '<button class="pill ghost" type="button" data-a="email">Email again</button>');
      if (isInv && (st === 'part paid' || st === 'paid')) acts.push('<button class="pill ghost" type="button" data-a="undopay">Undo last payment</button>');
      if (isInv && st !== 'draft') acts.push('<button class="pill ghost" type="button" data-a="edit">Change due date or notes</button>');
      if (!isInv && st === 'sent') acts.push('<button class="pill" type="button" data-a="approve">Client approved</button>', '<button class="pill ghost" type="button" data-a="email">Email again</button>', '<button class="pill danger" type="button" data-a="decline">Declined</button>');
      if (!isInv && st === 'approved') acts.push('<button class="pill" type="button" data-a="convert">Turn into invoice</button>', '<button class="pill danger" type="button" data-a="decline">Declined</button>');
      if (!isInv && st === 'declined') acts.push('<button class="pill ghost" type="button" data-a="reopen">Reopen as draft</button>');
      if (!isInv && st === 'draft') acts.push('<button class="pill ghost" type="button" data-a="approve">Client approved</button>');
      acts.push('<button class="pill ghost" type="button" data-a="pdf">' + (d.pdf_url ? 'Refresh PDF' : 'Make PDF') + '</button>');
    }
    var body = '<div class="doc-head"><div>' + statusBadge(st) + ' <span class="muted">' + esc(d.client) + (d.project ? ' · ' + esc(projectName(d.project)) : '') + '</span></div>' +
      '<div class="big small-big">' + lkr(isInv ? num(d.total) - num(d.advance_applied) : d.total) + '</div>' +
      (isInv && st !== 'draft' ? '<div class="muted small">Paid ' + money0(num(d.paid_amount)) + ' · Balance ' + money0(Math.max(0, bal)) + (d.due ? ' · Due ' + esc(d.due) : '') + '</div>' : '') +
      (d.sent_at ? '<div class="muted small">Sent ' + esc(d.sent_at) + (d.to_email ? ' to ' + esc(d.to_email) : '') + '</div>' : '') +
      (d.pdf_url ? '<a class="note" href="' + esc(d.pdf_url) + '" target="_blank" rel="noopener">Open PDF in Drive</a>' : '') + '</div>' +
      '<div class="doc-frame paper" id="doc-frame"><div class="spinner"></div></div>' +
      '<div class="modal-actions doc-actions">' + acts.join('') + '</div>';
    openModal((isInv ? 'Invoice ' : 'Quote ') + d.number, body, function (m) {
      m.querySelector('.modal').classList.add('wide');
      api('renderDoc', [kind, d.number]).then(function (r) { var f = $('doc-frame'); if (f) f.innerHTML = '<iframe title="Document preview" sandbox="" srcdoc="' + esc(r.html) + '"></iframe>'; },
        function (e) { var f = $('doc-frame'); if (f) f.innerHTML = '<p class="muted">Preview unavailable: ' + esc(e.message) + '</p>'; });
      m.querySelector('.doc-actions').addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-a]'); if (!btn) return;
        var a = btn.getAttribute('data-a'), reopen = function () { closeModal(); openDoc(kind, d.number); };
        if (a === 'edit') { closeModal(); openDocForm(kind, d); }
        else if (a === 'email') { closeModal(); openEmailForm(kind, d); }
        else if (a === 'pay') { closeModal(); openPaymentForm(d); }
        else if (a === 'pdf') docCall(btn, 'previewPdf', [kind, d.number], 'PDF saved to Drive', reopen);
        else if (a === 'marksent') docCall(btn, 'sendDoc', [kind, d.number, {}], 'Marked as sent' + (isInv ? '; income line added' : ''), reopen);
        else if (a === 'undopay') { if (armed(btn, 'Tap again to undo')) docCall(btn, 'undoLastPayment', [d.number], 'Last payment undone', reopen); }
        else if (a === 'delete') { if (armed(btn, 'Tap again to delete')) docCall(btn, 'deleteDoc', [kind, d.number], 'Draft deleted', closeModal); }
        else if (a === 'approve') docCall(btn, 'quoteAction', [d.number, 'approve'], 'Quote approved', reopen);
        else if (a === 'decline') { if (armed(btn, 'Tap again to mark declined')) docCall(btn, 'quoteAction', [d.number, 'decline'], 'Quote declined', reopen); }
        else if (a === 'reopen') docCall(btn, 'quoteAction', [d.number, 'reopen'], 'Quote reopened', reopen);
        else if (a === 'convert') docCall(btn, 'convertQuote', [d.number], 'Invoice created', function (r) { closeModal(); if (r && r.invoice) openDoc('invoice', r.invoice.number); });
      });
    });
  }
  function armed(btn, label) {
    if (btn.getAttribute('data-armed') === '1') return true;
    btn.setAttribute('data-armed', '1'); btn.textContent = label; return false;
  }

  /* ----- create / edit invoice or quote ----- */
  function openDocForm(kind, d, defaults) {
    var isInv = kind === 'invoice', isNew = !d, sent = d && d.status !== 'draft';
    var st = state.data.settings || {}, x = d ? Object.assign({}, d) : Object.assign({ date: todayIso(), label: 'Full payment' }, defaults || {});
    if (isNew) { if (isInv) x.due = addDaysIso(x.date, num(st.payment_terms_days) || 14); else x.valid_until = addDaysIso(x.date, num(st.quote_valid_days) || 14); }
    var lines = parseLines(x.lines); if (!lines.length) lines = [{ desc: '', detail: '', qty: 1, rate: '', amount: '' }];
    var clients = clientNames();
    var body;
    if (sent) {
      body = '<form class="form" novalidate><p class="note">This invoice has been sent, so only the due date, notes and email details can change. Lines and amounts are locked.</p>' +
        '<div class="row2">' + field('Due date', input('due', x.due, 'type="date"')) + field('Send to (email)', input('to_email', x.to_email, 'type="email"')) + '</div>' +
        field('Email subject', input('subject', x.subject)) + field('Notes on the invoice', '<textarea name="notes" rows="2">' + esc(x.notes) + '</textarea>') +
        '<p class="form-err" id="form-err" role="alert"></p><div class="modal-actions"><span class="spacer"></span><button class="pill ghost" type="button" data-close>Cancel</button><button class="pill" type="submit">Save</button></div></form>';
    } else {
      body = '<div class="review-grid doc-edit"><div><form class="form" novalidate>' +
        '<div class="row2">' + field('Client', input('client', x.client, 'list="dl-clients" autocomplete="off" required')) + field('Project', '<select name="project">' + projectOptions(x.project, true).replace('No project (company overhead)', 'No project') + '</select>') + '</div>' +
        '<div class="row2">' + field('Date', input('date', x.date, 'type="date"')) + (isInv ? field('Due', input('due', x.due, 'type="date"')) : field('Valid until', input('valid_until', x.valid_until, 'type="date"'))) + '</div>' +
        field('Subject (shown on the document)', input('subject', x.subject, 'placeholder="e.g. CPL 2026 match days"')) +
        '<div class="label" style="margin-top:6px">Lines</div><div id="doc-lines"></div><div class="btns"><button class="pill ghost small" type="button" data-addline>Add line</button></div>' +
        (isInv ? '<div class="row2">' + field('Invoice type', select('label', pairs(['Full payment', 'Advance', 'Balance']), x.label)) + field('Advance already paid (deducted)', input('advance_applied', x.advance_applied || '', 'inputmode="decimal" placeholder="0"')) + '</div>' : '') +
        '<div class="bill-sum" id="doc-sum"></div>' +
        field('Notes on the document', '<textarea name="notes" rows="2" placeholder="' + esc(isInv ? (st.invoice_notes || '') : (st.quote_notes || '')) + '">' + esc(x.notes) + '</textarea>') +
        field('Client email (for sending)', input('to_email', x.to_email || clientRow(x.client).email || '', 'type="email"')) +
        '<p class="form-err" id="form-err" role="alert"></p>' +
        '<div class="modal-actions"><span class="spacer"></span><button class="pill ghost" type="button" data-close>Cancel</button><button class="pill" type="submit">' + (isNew ? 'Save draft' : 'Save changes') + '</button></div>' +
        datalist('dl-clients', clients) + '</form></div><div class="doc-side"><div class="label">Live preview</div><div class="doc-frame paper" id="doc-frame"><p class="muted">Add a line to see the preview.</p></div></div></div>';
    }
    openModal(isNew ? (isInv ? 'New invoice' : 'New quote') : 'Edit ' + d.number, body, function (m) {
      if (!sent) m.querySelector('.modal').classList.add('wide');
      var form = m.querySelector('form'), box = $('doc-lines'), timer;
      function readLines() {
        return Array.prototype.map.call(box.querySelectorAll('.doc-line'), function (r) {
          var q = r.querySelector('[name=d_qty]').value.trim(), rt = r.querySelector('[name=d_rate]').value.trim();
          return { desc: r.querySelector('[name=d_desc]').value.trim(), detail: r.querySelector('[name=d_detail]').value.trim(), qty: q === '' ? '' : num(q), rate: rt === '' ? '' : num(rt) };
        });
      }
      function draw() {
        box.innerHTML = lines.map(function (l, i) {
          return '<div class="bill-line doc-line">' + field('Item', input('d_desc', l.desc, 'placeholder="e.g. Photography, match day"')) +
            field('Detail (optional)', input('d_detail', l.detail)) +
            '<div class="row3">' + field('Qty', input('d_qty', l.qty == null ? '' : l.qty, 'inputmode="decimal"')) + field('Rate', input('d_rate', l.rate == null || l.rate === '' ? (l.amount || '') : l.rate, 'inputmode="decimal"')) +
            '<div class="field"><span>Amount</span><div class="amt" data-amt="' + i + '"></div></div></div>' +
            (lines.length > 1 ? '<button class="linkbtn" type="button" data-rm="' + i + '">Remove line</button>' : '') + '</div>';
        }).join('');
        sum();
      }
      function sum() {
        var ls = readLines(), t = 0;
        ls.forEach(function (l, i) { var a = (l.qty === '' ? 1 : l.qty) * (l.rate === '' ? 0 : l.rate); t += a; var el = box.querySelector('[data-amt="' + i + '"]'); if (el) el.textContent = money(a); });
        var adv = form.elements.advance_applied ? num(form.elements.advance_applied.value) : 0;
        $('doc-sum').innerHTML = 'Total <b>' + money(t) + '</b>' + (adv ? ' · less advance ' + money(adv) + ' · <b>due ' + money(t - adv) + '</b>' : '');
        clearTimeout(timer); timer = setTimeout(preview, 600);
      }
      function payload() {
        var f = formData(form), o = { number: d ? d.number : '', client: f.client, project: f.project, date: f.date, subject: f.subject, notes: f.notes, to_email: f.to_email,
          lines: readLines().map(function (l) { return { desc: l.desc, detail: l.detail, qty: l.qty === '' ? 1 : l.qty, rate: l.rate === '' ? 0 : l.rate }; }).filter(function (l) { return l.desc || l.rate; }) };
        if (isInv) { o.due = f.due; o.label = f.label; o.advance_applied = num(f.advance_applied); } else o.valid_until = f.valid_until;
        if (x.quote_no) o.quote_no = x.quote_no;
        return o;
      }
      var seq = 0;
      function preview() {
        var p = payload(), me = ++seq, fr = $('doc-frame'); if (!fr || !p.lines.length) return;
        api('renderDoc', [kind, p]).then(function (r) { if (me === seq && $('doc-frame')) $('doc-frame').innerHTML = '<iframe title="Document preview" sandbox="" srcdoc="' + esc(r.html) + '"></iframe>'; }, function () { /* preview is optional */ });
      }
      if (!sent) {
        draw();
        box.addEventListener('input', sum);
        form.addEventListener('input', function (e) { if (!box.contains(e.target)) sum(); });
        form.elements.client.addEventListener('change', function () { var em = clientRow(form.elements.client.value).email; if (em && !form.elements.to_email.value) form.elements.to_email.value = em; });
        box.addEventListener('click', function (ev) { var rm = ev.target.getAttribute && ev.target.getAttribute('data-rm'); if (rm != null) { lines = readLines(); lines.splice(Number(rm), 1); draw(); } });
        m.querySelector('[data-addline]').addEventListener('click', function () { lines = readLines(); lines.push({ desc: '', detail: '', qty: 1, rate: '' }); draw(); });
      }
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var btn = form.querySelector('button[type=submit]');
        if (sent) { var f = formData(form); return docCall(btn, 'saveInvoice', [{ number: d.number, due: f.due, notes: f.notes, to_email: f.to_email, subject: f.subject }], 'Saved', function () { closeModal(); openDoc(kind, d.number); }); }
        var p = payload(), err = '';
        if (!p.client) err = 'Choose or type the client.';
        else if (!p.lines.length) err = 'Add at least one line.';
        else if (p.to_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.to_email)) err = 'That email address doesn\'t look right.';
        if (err) { $('form-err').textContent = err; return; }
        docCall(btn, isInv ? 'saveInvoice' : 'saveQuote', [p], isNew ? 'Draft saved' : 'Draft updated', function (r) {
          var nd = r && (r.invoice || r.quote); closeModal(); if (nd) openDoc(kind, nd.number);
          if (isNew && p.client && !clientRowsAll().some(function (c) { return c.name === p.client; })) { state.data.clients = clientRowsAll().concat([{ name: p.client, type: 'One-off' }]); }
        });
      });
    });
  }

  /* ----- email ----- */
  function openEmailForm(kind, d) {
    var isInv = kind === 'invoice', st = state.data.settings || {}, c = clientRow(d.client);
    var amt = isInv ? num(d.total) - num(d.advance_applied) - num(d.paid_amount) : num(d.total);
    var to = d.to_email || c.email || '';
    var subject = (isInv ? 'Invoice ' : 'Quote ') + d.number + (d.subject ? ' · ' + d.subject : '') + ' · ' + (st.company_name || 'Offset Media');
    var bodyText = 'Dear ' + (c.contact || d.client) + ',\n\n' + (isInv ? 'Please find attached invoice ' + d.number + ' for LKR ' + money(amt) + (d.due ? ', due on ' + d.due : '') + '.\n\nBank details are on the invoice. Please use ' + d.number + ' as the payment reference.'
      : 'Please find attached our quote ' + d.number + ' for LKR ' + money(amt) + (d.valid_until ? ', valid until ' + d.valid_until : '') + '.\n\nLet us know if you would like any changes.') +
      '\n\nThank you,\n' + (state.data.user.name || 'Joshua Abraham') + '\n' + (st.company_name || 'OFFSET MEDIA (PVT) LTD') + '\n' + (st.company_phone || '');
    var body = '<form class="form" novalidate>' + field('To', input('to', to, 'type="email" required')) + field('Cc (optional)', input('cc', '', 'type="email"')) +
      field('Subject', input('subject', subject)) + field('Message', '<textarea name="body" rows="9">' + esc(bodyText) + '</textarea>') +
      '<label class="check"><input type="checkbox" name="saveEmail" ' + (c.email ? '' : 'checked') + '> Save this address on the client</label>' +
      '<p class="note">The PDF' + (isInv ? '' : ' and your terms') + ' will be attached. ' + (d.status === 'draft' ? 'Sending marks it as sent' + (isInv ? ' and adds the income line to the books.' : '.') : '') + '</p>' +
      '<p class="form-err" id="form-err" role="alert"></p><div class="modal-actions"><span class="spacer"></span><button class="pill ghost" type="button" data-close>Cancel</button><button class="pill" type="submit">Send email</button></div></form>';
    openModal('Email ' + d.number, body, function (m) {
      var form = m.querySelector('form');
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = formData(form);
        if (!/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(f.to)) { $('form-err').textContent = 'Enter one valid email address.'; return; }
        docCall(form.querySelector('button[type=submit]'), 'sendDoc', [kind, d.number, { email: true, to: f.to, cc: f.cc, subject: f.subject, body: f.body, saveEmail: form.elements.saveEmail.checked }],
          'Emailed to ' + f.to, function () { closeModal(); openDoc(kind, d.number); });
      });
    });
  }

  /* ----- payment ----- */
  function openPaymentForm(d) {
    var bal = num(d.total) - num(d.advance_applied) - num(d.paid_amount);
    var body = '<form class="form" novalidate><p class="note">Balance on ' + esc(d.number) + ': <b>' + lkr(bal) + '</b></p>' +
      '<div class="row2">' + field('Amount received', input('amount', Math.round(bal * 100) / 100, 'inputmode="decimal" required')) + field('Date received', input('date', todayIso(), 'type="date"')) + '</div>' +
      field('How it was paid', select('method', pairs(['Bank transfer', 'Cheque', 'Cash', 'Debit card']), 'Bank transfer')) +
      '<p class="form-err" id="form-err" role="alert"></p><div class="modal-actions"><span class="spacer"></span><button class="pill ghost" type="button" data-close>Cancel</button><button class="pill" type="submit">Record payment</button></div></form>';
    openModal('Payment for ' + d.number, body, function (m) {
      var form = m.querySelector('form');
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var f = formData(form), a = num(f.amount);
        if (!(a > 0)) { $('form-err').textContent = 'Enter the amount received.'; return; }
        if (a > bal + 0.005) { $('form-err').textContent = 'That is more than the balance of ' + money(bal) + '.'; return; }
        docCall(form.querySelector('button[type=submit]'), 'recordPayment', [d.number, { amount: a, date: f.date, method: f.method }], 'Payment recorded', function () { closeModal(); openDoc('invoice', d.number); });
      });
    });
  }

  /* ---------- more ---------- */
  function viewMore() {
    var u = state.data.user;
    var h = '<h1 class="page-title">More</h1><p class="sub">Signed in as ' + esc(u.name || u.email) + ' (' + esc(u.role) + ').</p>';
    h += '<div class="grid morelinks"><button class="card linkcard" data-go="clients" type="button"><span class="label">People</span><b>Clients</b><span class="muted small">Contacts and full history</span></button>' +
      '<button class="card linkcard" data-go="entries" type="button"><span class="label">Books</span><b>Entries</b><span class="muted small">Every cost and income line</span></button></div>';
    h += '<div class="card"><h3>Install Offset Books</h3><ol class="steps">' +
      '<li><b>iPhone:</b> open this page in Safari, tap Share, then <b>Add to Home Screen</b>.</li>' +
      '<li><b>Android:</b> in Chrome tap the menu, then <b>Install app</b>.</li>' +
      '<li><b>Mac or PC:</b> in Chrome or Edge click the install icon in the address bar, or the menu, then <b>Install Offset Books</b>.</li></ol></div>';
    h += '<div class="card" style="margin-top:14px"><h3>Session</h3><p class="muted">Financial data is never stored on this device. Every change is written to the AuditLog tab.</p><button class="pill" id="btn-signout" type="button">Sign out</button></div>';
    return h;
  }

  /* ---------- modal ---------- */
  function openModal(title, body, onMount) {
    closeModal();
    var m = document.createElement('div');
    m.className = 'modal-back'; m.id = 'modal';
    m.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="modal-head"><h2>' + esc(title) + '</h2><button class="x" data-close type="button" aria-label="Close">&times;</button></div><div class="modal-body">' + body + '</div></div>';
    document.body.appendChild(m);
    document.body.classList.add('noscroll');
    m.addEventListener('click', function (e) { if (e.target === m || (e.target.closest && e.target.closest('[data-close]'))) closeModal(); });
    onMount && onMount(m);
    var first = m.querySelector('input,select,textarea'); if (first && window.innerWidth > 800) first.focus();
  }
  function closeModal() { var m = $('modal'); if (m) m.remove(); document.body.classList.remove('noscroll'); }

  function field(label, html, cls) { return '<label class="field' + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + '</span>' + html + '</label>'; }
  function input(name, val, attrs) { return '<input name="' + name + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '>'; }
  function select(name, opts, val, attrs) {
    var has = opts.some(function (o) { return String(o[0]) === String(val); });
    return '<select name="' + name + '" ' + (attrs || '') + '>' + (!has && !blank(val) ? '<option value="' + esc(val) + '" selected>' + esc(val) + '</option>' : '') +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function pairs(arr) { return arr.map(function (v) { return [v, v]; }); }
  function datalist(id, arr) { return '<datalist id="' + id + '">' + arr.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>'; }
  function formData(form) {
    var o = {};
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name) o[el.name] = el.value.trim(); });
    return o;
  }
  function payees() { return uniq((state.data.entries || []).map(function (e) { return e.payee; })); }
  function shoots(pid) { return uniq((state.data.entries || []).filter(function (e) { return !pid || String(e.project) === String(pid); }).map(function (e) { return e.shoot; })); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

  /* ---------- entry form ---------- */
  function openEntryForm(entry, defaults) {
    var isNew = !entry, e = entry ? Object.assign({}, entry) : Object.assign({
      date: todayIso(), kind: 'cost', business_line: 'Production', payment_method: 'Bank transfer', paid_status: 'paid', paid_date: todayIso(), doc_status: 'none'
    }, defaults || {});
    var typeOpts = e.kind === 'income' ? INCOME_TYPES : costTypes();
    var body = '<form id="entry-form" class="form" novalidate>' +
      '<div class="row2">' + field('Type', select('kind', [['cost', 'Cost'], ['income', 'Income'], ['asset', 'Asset (equipment)']], e.kind)) + field('Date', input('date', e.date, 'type="date" required')) + '</div>' +
      '<div class="row2">' + field('Amount (LKR)', input('amount', blank(e.amount) ? '' : e.amount, 'inputmode="decimal" required placeholder="0"')) + field(e.kind === 'income' ? 'Income type' : 'Cost type', select('cost_type', pairs(typeOpts), e.cost_type)) + '</div>' +
      field('Project', '<select name="project">' + projectOptions(e.project, true) + '</select>') +
      '<div class="row2">' + field('Shoot / day', input('shoot', e.shoot, 'list="dl-shoots"')) + field('Business line', select('business_line', pairs(['Production', 'AI data']), e.business_line)) + '</div>' +
      field(e.kind === 'income' ? 'From (client)' : 'Payee', input('payee', e.payee, 'list="dl-payees" autocomplete="off"')) +
      field('Description', input('description', e.description)) +
      '<div class="row2">' + field('Paid by', select('payment_method', pairs(PAY_METHODS), e.payment_method)) + field('Status', select('paid_status', [['paid', 'Paid'], ['unpaid', 'Not paid yet']], e.paid_status)) + '</div>' +
      '<div class="row2">' + field('Paid date', input('paid_date', e.paid_date, 'type="date"')) + field('Invoice / doc no.', input('doc_number', e.doc_number)) + '</div>' +
      '<div class="row2">' + field('Proof', select('doc_status', pairs(['none', 'bank line only', 'invoice', 'receipt', 'yes']), e.doc_status)) + field('Document link', input('doc_url', e.doc_url, 'type="url" placeholder="https://drive.google.com/..."')) + '</div>' +
      field('Notes', '<textarea name="notes" rows="2">' + esc(e.notes) + '</textarea>') +
      '<div class="row2">' + field('Account', input('account', e.account, 'inputmode="numeric"')) + '<div class="acct-hint" id="acct-hint"></div></div>' +
      (!isNew && e.bill_id ? '<p class="note">This line is part of split bill ' + esc(e.bill_id) + '. Use "Edit split" to change how the bill is divided.</p>' : '') +
      '<p class="form-err" id="form-err" role="alert"></p>' +
      '<div class="modal-actions">' +
      (!isNew ? '<button class="pill danger" type="button" data-del>Delete</button>' : '') +
      (!isNew && e.kind === 'cost' ? '<button class="pill ghost" type="button" data-splitme>' + (e.bill_id ? 'Edit split' : 'Split across projects') + '</button>' : '') +
      '<span class="spacer"></span><button class="pill ghost" type="button" data-close>Cancel</button><button class="pill" type="submit">' + (isNew ? 'Add' : 'Save') + '</button></div>' +
      datalist('dl-payees', payees()) + datalist('dl-shoots', shoots(e.project)) + '</form>';

    openModal(isNew ? (e.kind === 'income' ? 'Add income' : 'Add cost') : 'Edit ' + (e.kind === 'income' ? 'income' : 'cost') + ' ' + e.id, body, function (m) {
      var form = m.querySelector('form'), acct = form.elements.account, manual = !isNew && !blank(e.account) && String(e.account) !== String(autoAccount(e));
      function syncAccount() {
        var d = formData(form), auto = autoAccount(d);
        if (!manual && auto) acct.value = auto;
        var nm = accountName(acct.value);
        $('acct-hint').textContent = (nm ? nm + '. ' : '') + (auto && acct.value !== auto ? 'Suggested: ' + auto + '.' : 'Set from cost type and project.');
      }
      acct.addEventListener('input', function () { manual = true; syncAccount(); });
      form.elements.kind.addEventListener('change', function () {
        var d = formData(form);
        d.cost_type = d.kind === 'income' ? 'Full payment' : 'Crew / freelancer';
        closeModal();
        if (entry) openEntryForm(Object.assign({}, entry, d)); else openEntryForm(null, d);
      });
      ['cost_type', 'project', 'business_line'].forEach(function (n) { form.elements[n].addEventListener('change', syncAccount); });
      syncAccount();
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = formData(form), err = '';
        if (!isDate(d.date)) err = 'Pick a date.';
        else if (d.amount === '' || !/^-?[\d,]*\.?\d+$/.test(d.amount)) err = 'Enter the amount as a number.';
        else if (d.paid_date && !isDate(d.paid_date)) err = 'Paid date is not valid.';
        if (err) { $('form-err').textContent = err; return; }
        d.amount = num(d.amount);
        if (d.project) d.allocation = '';
        closeModal();
        if (isNew) {
          var tid = tmpId(), local = Object.assign({ id: tid }, d);
          commit(function () { state.data.entries.push(local); }, function () { return api('obwSaveEntry', [d]); },
            function (saved) { replaceEntry(tid, saved); }, 'Added ' + (d.kind === 'income' ? 'income' : 'cost'));
        } else {
          d.id = e.id;
          var merged = Object.assign({}, entry, d);
          commit(function () { replaceEntry(e.id, merged); }, function () { return api('obwSaveEntry', [d]); },
            function (saved) { replaceEntry(e.id, Object.assign({}, merged, saved)); }, 'Saved ' + e.id);
        }
      });
      var del = m.querySelector('[data-del]');
      if (del) del.addEventListener('click', function () {
        if (del.getAttribute('data-armed') !== '1') { del.setAttribute('data-armed', '1'); del.textContent = 'Tap again to delete'; return; }
        closeModal();
        commit(function () { removeEntries([e.id]); }, function () { return api('obwDeleteEntry', [e.id, 'Deleted in app']); }, null, 'Deleted ' + e.id);
      });
      var sp = m.querySelector('[data-splitme]');
      if (sp) sp.addEventListener('click', function () { closeModal(); openBillFor(entry); });
    });
  }

  /* ---------- split bill form ---------- */
  function openBillFor(entry) {
    var group = entry.bill_id ? state.data.entries.filter(function (x) { return x.bill_id === entry.bill_id; }) : [entry];
    openBillForm(group);
  }

  function knownProject(id) { return id && projectById(id) ? id : ''; }

  /**
   * One supplier bill (e.g. a TG rental invoice) divided across projects.
   * existing = entries the bill replaces (empty for a new bill).
   * opts.review = a bill Claude read (from the review queue): adds the document preview, payment matching, approve / reject / skip.
   */
  function openBillForm(existing, defaults, opts) {
    existing = existing || []; opts = opts || {};
    var rv = opts.review, sg = rv ? (rv.suggestion || {}) : null;
    var first = existing[0] || {}, total = 0;
    existing.forEach(function (x) { total += num(x.amount); });
    var hdr = Object.assign({ date: todayIso(), payment_method: 'Bank transfer', paid_status: 'paid', paid_date: todayIso(), doc_status: 'invoice' }, defaults || {},
      existing.length ? { date: first.date, payee: first.payee, doc_number: first.doc_number, doc_url: first.doc_url, doc_status: first.doc_status, payment_method: first.payment_method, paid_status: first.paid_status, paid_date: first.paid_date, notes: first.notes, description: first.description } : {});
    var lines = existing.length ? existing.map(function (x) { return { project: x.project, shoot: x.shoot, cost_type: x.cost_type || 'Equipment rental', description: x.description, amount: num(x.amount) }; })
      : [{ project: state.view === 'project' ? state.projectId : '', shoot: '', cost_type: 'Equipment rental', description: '', amount: '' }];
    if (existing.length === 1 && !first.bill_id) lines.push({ project: '', shoot: '', cost_type: lines[0].cost_type, description: lines[0].description, amount: '' });
    var payments = [], dupes = [];
    if (rv) {
      hdr = Object.assign(hdr, { date: sg.date || todayIso(), payee: sg.payee || sg.supplier || '', doc_number: sg.doc_number || '', notes: sg.notes || '', paid_status: 'unpaid', payment_method: 'Not paid yet', paid_date: '' });
      total = num(sg.total);
      lines = (sg.lines && sg.lines.length ? sg.lines : [{ amount: sg.total }]).map(function (l) {
        return { project: knownProject(l.project), shoot: l.shoot || '', cost_type: costTypes().indexOf(l.cost_type) !== -1 ? l.cost_type : 'Equipment rental', description: l.description || '', amount: blank(l.amount) ? '' : num(l.amount), reason: l.reason || '' };
      });
      var m = sg.matches || {};
      payments = (m.payments || []).map(findEntry).filter(Boolean);
      dupes = (m.duplicates || []).map(findEntry).filter(Boolean);
    }

    var pane = rv ? '<div class="review-doc"><div class="doc-frame" id="doc-frame"><div class="spinner"></div></div><a class="note" href="' + esc(sg.file_url) + '" target="_blank" rel="noopener">Open in Drive</a></div>' : '';
    var aiNote = rv ? '<div class="ai-note"><span class="pillbadge ' + (sg.confidence === 'high' ? 'good' : sg.confidence === 'medium' ? '' : 'warn') + '">Claude: ' + esc(sg.confidence || 'unsure') + ' confidence</span>' +
      (sg.notes ? ' <span class="muted small">' + esc(sg.notes) + '</span>' : '') + '</div>' +
      (dupes.length ? '<div class="banner">Possible duplicate: ' + dupes.map(function (d) { return esc(d.id + ' ' + d.payee + ' ' + money0(d.amount) + ' on ' + d.date); }).join(', ') + ' already mention this invoice number.</div>' : '') +
      field('This bill was paid by', '<select name="match"><option value="">Not matched to a bank payment yet (records it as owed)</option>' + payments.map(function (p, i) {
        return '<option value="' + esc(p.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(p.date + ' · ' + p.payee + ' · ' + money0(p.amount) + ' (' + p.id + ')') + '</option>';
      }).join('') + '</select>') : '';

    var body = '<form id="bill-form" class="form" novalidate>' + (rv ? '' : '<p class="note">Enter the bill once, then divide it between projects. Each line becomes a cost on that project; leave a line\'s project empty for company overhead.</p>') + aiNote +
      '<div class="row2">' + field('Supplier', input('payee', hdr.payee, 'list="dl-payees" autocomplete="off" required')) + field('Bill date', input('date', hdr.date, 'type="date" required')) + '</div>' +
      '<div class="row2">' + field('Invoice no.', input('doc_number', hdr.doc_number)) + field('Bill total (LKR)', input('total', total || '', 'inputmode="decimal" required')) + '</div>' +
      '<div class="row2">' + field('Paid by', select('payment_method', pairs(PAY_METHODS), hdr.payment_method)) + field('Status', select('paid_status', [['paid', 'Paid'], ['unpaid', 'Not paid yet']], hdr.paid_status)) + '</div>' +
      '<div class="row2">' + field('Paid date', input('paid_date', hdr.paid_date, 'type="date"')) + (rv ? '<span></span>' : field('Document link', input('doc_url', hdr.doc_url, 'type="url" placeholder="https://drive.google.com/..."'))) + '</div>' +
      field('Notes', input('notes', hdr.notes)) +
      '<div class="label" style="margin-top:8px">How the bill is divided</div><div id="bill-lines"></div>' +
      '<div class="btns" style="margin:8px 0"><button class="pill ghost small" type="button" data-addline>Add line</button><button class="pill ghost small" type="button" data-even>Split evenly</button></div>' +
      '<div class="bill-sum" id="bill-sum"></div>' +
      '<p class="form-err" id="form-err" role="alert"></p>' +
      '<div class="modal-actions">' + (rv ? '<button class="pill danger" type="button" data-reject>Reject</button><button class="pill ghost" type="button" data-skip>Skip</button>' : '') +
      '<span class="spacer"></span><button class="pill ghost" type="button" data-close>' + (rv ? 'Close' : 'Cancel') + '</button><button class="pill" type="submit" id="bill-save">' + (rv ? 'Approve' : 'Save bill') + '</button></div>' +
      datalist('dl-payees', payees()) + datalist('dl-shoots', shoots('')) + '</form>';
    var title = rv ? 'Review bill ' + (opts.index + 1) + ' of ' + opts.count : existing.length ? (first.bill_id ? 'Edit split bill' : 'Split ' + first.id + ' across projects') : 'Add split bill';

    openModal(title, rv ? '<div class="review-grid">' + pane + '<div>' + body + '</div></div>' : body, function (m) {
      if (rv) m.querySelector('.modal').classList.add('wide');
      var form = m.querySelector('form'), box = $('bill-lines');
      function readLines() {
        return Array.prototype.map.call(box.querySelectorAll('.bill-line'), function (row, i) {
          return { project: row.querySelector('[name=l_project]').value, shoot: row.querySelector('[name=l_shoot]').value.trim(), cost_type: row.querySelector('[name=l_cost_type]').value,
            description: row.querySelector('[name=l_description]').value.trim(), amount: row.querySelector('[name=l_amount]').value.trim(), reason: (lines[i] || {}).reason || '' };
        });
      }
      function draw() {
        box.innerHTML = lines.map(function (l, i) {
          return '<div class="bill-line"><div class="row2">' + field('Project', '<select name="l_project">' + projectOptions(l.project, true) + '</select>') +
            field('Amount', input('l_amount', l.amount, 'inputmode="decimal" placeholder="0"')) + '</div>' +
            '<div class="row3">' + field('Cost type', select('l_cost_type', pairs(costTypes()), l.cost_type)) + field('Shoot / day', input('l_shoot', l.shoot, 'list="dl-shoots"')) +
            field('What for', input('l_description', l.description)) + '</div>' +
            (l.reason ? '<p class="reason">Claude: ' + esc(l.reason) + '</p>' : '') +
            (lines.length > 1 ? '<button class="linkbtn" type="button" data-rm="' + i + '">Remove line</button>' : '') + '</div>';
        }).join('');
        sum();
      }
      function sum() {
        var t = num(form.elements.total.value), s = 0;
        readLines().forEach(function (l) { s += num(l.amount); });
        var left = Math.round((t - s) * 100) / 100, ok = Math.abs(left) < 0.005 && t !== 0;
        $('bill-sum').innerHTML = 'Divided <b>' + money(s) + '</b> of ' + money(t) + ' · ' + (ok ? '<span class="good">adds up</span>' : '<span class="warn">' + (left > 0 ? money(left) + ' left to assign' : money(-left) + ' too much') + '</span>');
        $('bill-save').disabled = !ok;
      }
      function applyMatch() {
        var id = form.elements.match && form.elements.match.value, p = id && findEntry(id);
        if (p) { form.elements.payment_method.value = p.payment_method || 'Bank transfer'; form.elements.paid_status.value = 'paid'; form.elements.paid_date.value = p.paid_date || p.date; }
        else if (rv) { form.elements.payment_method.value = 'Not paid yet'; form.elements.paid_status.value = 'unpaid'; form.elements.paid_date.value = ''; }
      }
      draw();
      if (rv) { form.elements.match.addEventListener('change', applyMatch); applyMatch(); loadPreview(rv.id, $('doc-frame')); }
      box.addEventListener('input', sum);
      form.elements.total.addEventListener('input', sum);
      box.addEventListener('click', function (ev) {
        var rm = ev.target.getAttribute && ev.target.getAttribute('data-rm');
        if (rm != null) { lines = readLines(); lines.splice(Number(rm), 1); draw(); }
      });
      m.querySelector('[data-addline]').addEventListener('click', function () {
        lines = readLines(); var last = lines[lines.length - 1] || {};
        lines.push({ project: '', shoot: '', cost_type: last.cost_type || 'Equipment rental', description: last.description || '', amount: '' }); draw();
      });
      m.querySelector('[data-even]').addEventListener('click', function () {
        lines = readLines(); var t = num(form.elements.total.value), n = lines.length, each = Math.floor(t / n * 100) / 100, used = 0;
        lines.forEach(function (l, i) { l.amount = i === n - 1 ? Math.round((t - used) * 100) / 100 : each; used += each; }); draw();
      });
      if (rv) {
        m.querySelector('[data-skip]').addEventListener('click', function () { closeModal(); openReview(opts.index + 1); });
        m.querySelector('[data-reject]').addEventListener('click', function (ev) {
          var btn = ev.currentTarget;
          if (btn.getAttribute('data-armed') !== '1') { btn.setAttribute('data-armed', '1'); btn.textContent = 'Tap again to reject'; return; }
          closeModal();
          commit(function () { removeReview(rv.id); }, function () { return api('obwDecideBill', [rv.id, 'reject']); }, null, 'Bill rejected');
          openReview(opts.index);
        });
      }
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = formData(form), ls = readLines(), err = '';
        if (!d.payee) err = 'Enter the supplier.';
        else if (!isDate(d.date)) err = 'Pick the bill date.';
        else if (ls.some(function (l) { return l.amount === '' || !isFinite(num(l.amount)); })) err = 'Every line needs an amount.';
        if (err) { $('form-err').textContent = err; return; }
        var header = { date: d.date, payee: d.payee, doc_number: d.doc_number, doc_url: d.doc_url || hdr.doc_url || '', doc_status: d.doc_url ? 'invoice' : (hdr.doc_status || 'invoice'),
          payment_method: d.payment_method, paid_status: d.paid_status, paid_date: d.paid_date, notes: d.notes, business_line: first.business_line || 'Production' };
        if (first.bank_line_id) header.bank_line_id = first.bank_line_id;
        var replace = rv ? (d.match ? [d.match] : []) : existing.map(function (x) { return x.id; });
        var payload = { replace_ids: replace, total: num(d.total), header: header,
          lines: ls.map(function (l) { return { project: l.project, shoot: l.shoot, cost_type: l.cost_type, description: l.description || d.notes || ('Bill ' + (d.doc_number || '')).trim(), amount: num(l.amount) }; }) };
        var temps = payload.lines.map(function (l) {
          var x = Object.assign({ id: tmpId(), kind: 'cost' }, header, l, { bill_id: first.bill_id || 'new' });
          x.account = autoAccount(x); x.allocation = x.project ? '' : 'overhead'; return x;
        });
        closeModal();
        var msg = 'Bill saved as ' + payload.lines.length + ' line' + (payload.lines.length === 1 ? '' : 's');
        if (rv) {
          commit(function () { removeReview(rv.id); removeEntries(replace); state.data.entries = state.data.entries.concat(temps); },
            function () { return api('obwDecideBill', [rv.id, 'approve', payload]); },
            function (res) { removeEntries(temps.map(function (t) { return t.id; })); state.data.entries = state.data.entries.concat(res.bill.added); }, 'Approved: ' + msg.toLowerCase());
          openReview(opts.index);
        } else {
          commit(function () { removeEntries(payload.replace_ids); state.data.entries = state.data.entries.concat(temps); },
            function () { return api('obwSaveBill', [payload]); },
            function (res) { removeEntries(temps.map(function (t) { return t.id; })); state.data.entries = state.data.entries.concat(res.added); }, msg);
        }
      });
    });
  }

  /* ---------- bill review queue (bills Claude read) ---------- */
  function reviews() { return (state.meta && state.meta.reviews) || []; }
  function removeReview(id) { if (state.meta) state.meta.reviews = reviews().filter(function (r) { return r.id !== id; }); }
  function openReview(i) {
    var list = reviews();
    if (!list.length) { closeModal(); toast('All bills reviewed'); return; }
    if (i >= list.length) i = 0;
    openBillForm([], {}, { review: list[i], index: i, count: list.length });
  }
  var previewCache = {};
  function loadPreview(id, el) {
    function put(f) {
      if (!el || !document.body.contains(el)) return;
      if (!f.data) { el.innerHTML = '<p class="muted">Too large to preview here. Use Open in Drive.</p>'; return; }
      var bytes = atob(f.data), arr = new Uint8Array(bytes.length);
      for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: f.mime }));
      el.innerHTML = /^image\//.test(f.mime) ? '<img alt="Uploaded bill" src="' + url + '">' : '<iframe title="Uploaded bill" src="' + url + '"></iframe>';
    }
    if (previewCache[id]) return put(previewCache[id]);
    api('obwBillFile', [id]).then(function (f) { previewCache[id] = f; put(f); }, function (e) { if (el) el.innerHTML = '<p class="muted">Preview unavailable: ' + esc(e.message) + '</p>'; });
  }

  /** Shrinks phone photos before upload (faster, and cheaper for Claude to read). */
  function fileToPayload(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      if (/^image\//.test(file.type) && file.type !== 'image/gif') {
        r.onload = function () {
          var img = new Image();
          img.onload = function () {
            var max = 2000, sc = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
            c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve({ name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
          };
          img.onerror = function () { reject(new Error(file.name + ' is not an image this browser can open (try a JPG or PDF).')); };
          img.src = r.result;
        };
      } else {
        r.onload = function () { resolve({ name: file.name, mime: file.type || 'application/pdf', data: String(r.result).split(',')[1] }); };
      }
      r.readAsDataURL(file);
    });
  }

  var uploading = { total: 0, done: 0, failed: [] };
  function uploadBills(files) {
    files = Array.prototype.slice.call(files || []).filter(function (f) {
      if (f.type !== 'application/pdf' && !/^image\//.test(f.type)) { toast(f.name + ' skipped: upload PDFs or photos', true); return false; }
      if (f.size > 20 * 1024 * 1024) { toast(f.name + ' is over 20 MB', true); return false; }
      return true;
    });
    if (!files.length) return;
    uploading = { total: uploading.total - uploading.done + files.length, done: 0, failed: [] };
    render(true);
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () { return fileToPayload(f); }).then(function (p) { return api('obwUploadBill', [p]); })
        .then(function (row) { if (state.meta) state.meta.reviews = reviews().concat([row]); }, function (e) { uploading.failed.push(f.name + ': ' + e.message); })
        .then(function () { uploading.done++; render(true); });
    });
    chain.then(function () {
      var ok = uploading.done - uploading.failed.length;
      if (uploading.failed.length) toast(uploading.failed.join(' · '), true); else toast(ok + ' bill' + (ok === 1 ? '' : 's') + ' read. Ready to review.');
      uploading = { total: 0, done: 0, failed: [] }; render(true);
    });
  }

  /* ---------- project form ---------- */
  function openProjectForm(p) {
    var isNew = !p, x = p ? Object.assign({}, p) : { status: 'In production', business_line: 'Production', start: todayIso() };
    var clients = uniq(((state.meta && state.meta.clients) || []).concat((state.data.projects || []).map(function (q) { return q.client; })));
    var body = '<form class="form" novalidate>' +
      field('Project name', input('name', x.name, 'required')) +
      '<div class="row2">' + field('Client', input('client', x.client, 'list="dl-clients" autocomplete="off"')) + field('Status', select('status', pairs(STATUSES), x.status)) + '</div>' +
      '<div class="row2">' + field('Start', input('start', x.start, 'type="date"')) + field('End', input('end', x.end, 'type="date"')) + '</div>' +
      '<div class="row2">' + field('Property / league', input('property', x.property)) + field('Business line', select('business_line', pairs(['Production', 'AI data']), x.business_line)) + '</div>' +
      field('Agreed fee (LKR)', input('agreed_fee', x.agreed_fee, 'inputmode="decimal"')) +
      '<div class="label" style="margin-top:8px">Budget by cost type (LKR)</div><div class="row3">' +
      BUDGET_TYPES.map(function (t) { return field(t[0], input(t[1], x[t[1]], 'inputmode="decimal" placeholder="-"')); }).join('') + '</div>' +
      '<p class="bill-sum" id="budget-sum"></p>' +
      field('Budget sheet link', input('budget_url', x.budget_url, 'type="url"')) +
      field('Notes', '<textarea name="notes" rows="3">' + esc(x.notes) + '</textarea>') +
      '<p class="form-err" id="form-err" role="alert"></p>' +
      '<div class="modal-actions"><span class="spacer"></span><button class="pill ghost" type="button" data-close>Cancel</button><button class="pill" type="submit">' + (isNew ? 'Create project' : 'Save') + '</button></div>' +
      datalist('dl-clients', clients) + '</form>';
    openModal(isNew ? 'New project' : 'Edit ' + x.name, body, function (m) {
      var form = m.querySelector('form');
      function bsum() {
        var t = 0; BUDGET_TYPES.forEach(function (b) { t += num(form.elements[b[1]].value); });
        var fee = num(form.elements.agreed_fee.value);
        $('budget-sum').innerHTML = 'Total budget <b>' + money0(t) + '</b>' + (fee ? ' · planned margin <span class="' + (fee - t < 0 ? 'over' : 'good') + '">' + money0(fee - t) + '</span>' : '');
      }
      form.addEventListener('input', bsum); bsum();
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = formData(form), err = '';
        if (!d.name) err = 'Give the project a name.';
        ['agreed_fee'].concat(BUDGET_TYPES.map(function (b) { return b[1]; })).forEach(function (k) {
          if (d[k] !== '' && !/^[\d,]*\.?\d+$/.test(d[k])) err = 'Budgets and fee must be numbers.';
          else if (d[k] !== '') d[k] = num(d[k]);
        });
        if (err) { $('form-err').textContent = err; return; }
        closeModal();
        if (isNew) {
          var tid = tmpId(), local = Object.assign({ id: tid }, d);
          commit(function () { state.data.projects.push(local); }, function () { return api('obwSaveProject', [d]); },
            function (saved) { replaceProject(tid, saved); state.projectId = saved.id; state.view = 'project'; }, 'Project created');
        } else {
          d.id = x.id;
          var merged = Object.assign({}, p, d);
          commit(function () { replaceProject(x.id, merged); }, function () { return api('obwSaveProject', [d]); },
            function (saved) { replaceProject(x.id, Object.assign({}, merged, saved)); }, 'Project saved');
        }
      });
    });
  }

  /* ---------- render ---------- */
  function render(keepScroll) {
    var d = state.data; if (!d) return;
    var y = window.scrollY;
    $('who').innerHTML = '<b>' + esc(d.user.name || d.user.email) + '</b> · ' + esc(d.user.role);
    var navView = state.view === 'project' ? 'projects' : state.view === 'client' ? 'clients' : state.view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      var v = b.getAttribute('data-view');
      b.classList.toggle('active', v === navView);
      if (v === 'review') b.hidden = d.user.role !== 'admin';
    });
    var badge = $('assign-count'), n = canEdit() ? toAssign().length + reviews().length : 0;
    if (badge) { badge.textContent = n; badge.hidden = !n; }
    var v = state.view === 'project' ? viewProject() : state.view === 'projects' ? viewProjects() : state.view === 'entries' ? viewEntries() :
      state.view === 'review' ? viewReview() : state.view === 'clients' ? viewClients() : state.view === 'client' ? viewClient() :
      state.view === 'sales' ? viewSales() : state.view === 'more' ? viewMore() : viewDashboard();
    $('view').innerHTML = v;
    var so = $('btn-signout'); if (so) so.addEventListener('click', signOut);
    bindFilters();
    bindUpload();
    window.scrollTo(0, keepScroll ? y : 0);
  }

  function bindFilters() {
    var map = { 'f-q': 'q', 'f-kind': 'kind', 'f-month': 'month', 'f-project': 'project', 'd-q': 'q', 'd-status': 'status' };
    Object.keys(map).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener(/-q$/.test(id) ? 'input' : 'change', function () {
        if (id.charAt(0) === 'd') docFilter[map[id]] = el.value; else { state.entryFilter[map[id]] = el.value; state.entryLimit = 150; }
        var pos = el.selectionStart; render(true);
        var again = $(id); if (again) { again.focus(); if (/-q$/.test(id) && again.setSelectionRange) again.setSelectionRange(pos, pos); }
      });
    });
  }

  function bindUpload() {
    var inp = $('bill-files'), dz = $('dropzone'); if (!inp || !dz) return;
    inp.addEventListener('change', function () { uploadBills(inp.files); inp.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { uploadBills(e.dataTransfer.files); });
  }

  function go(view, pid) { state.view = view; if (pid != null) state.projectId = pid; render(); }

  function findEntry(id) { return (state.data.entries || []).filter(function (e) { return String(e.id) === String(id); })[0]; }

  function onAction(t) {
    var el;
    if ((el = t.closest('.nav-item'))) return go(el.getAttribute('data-view'));
    if ((el = t.closest('[data-go]'))) return go(el.getAttribute('data-go'));
    if ((el = t.closest('[data-entry]'))) { var en = findEntry(el.getAttribute('data-entry')); if (en) openEntryForm(en); return; }
    if ((el = t.closest('[data-project]'))) return go('project', el.getAttribute('data-project'));
    if ((el = t.closest('[data-client]'))) { state.clientName = el.getAttribute('data-client'); return go('client'); }
    if ((el = t.closest('[data-review]'))) return openReview(Number(el.getAttribute('data-review')));
    if ((el = t.closest('[data-doc]'))) { var dk = el.getAttribute('data-doc').split(':'); return openDoc(dk[0], dk.slice(1).join(':')); }
    if ((el = t.closest('[data-split]'))) { var se = findEntry(el.getAttribute('data-split')); if (se) openBillFor(se); return; }
    if ((el = t.closest('[data-overhead]'))) {
      var id = el.getAttribute('data-overhead'), oe = findEntry(id); if (!oe) return;
      return commit(function () { replaceEntry(id, Object.assign({}, oe, { allocation: 'overhead' })); },
        function () { return api('obwSaveEntry', [{ id: id, allocation: 'overhead', auto_account: true }]); },
        function (saved) { replaceEntry(id, Object.assign({}, oe, saved)); }, 'Marked as overhead');
    }
    if ((el = t.closest('[data-act]'))) {
      var a = el.getAttribute('data-act'), inProject = state.view === 'project' ? state.projectId : '';
      var p = inProject ? projectById(inProject) : null;
      if (a === 'new-project') openProjectForm(null);
      else if (a === 'edit-project' && p) openProjectForm(p);
      else if (a === 'add-cost') openEntryForm(null, { kind: 'cost', project: inProject, cost_type: 'Crew / freelancer' });
      else if (a === 'add-income') openEntryForm(null, { kind: 'income', project: inProject, cost_type: 'Full payment', payment_method: 'Bank transfer', paid_status: 'unpaid', paid_date: '', doc_status: 'invoice', payee: p ? p.client : '' });
      else if (a === 'add-bill') openBillForm([], {});
      else if (a === 'start-review') openReview(0);
      else if (a === 'new-invoice') openDocForm('invoice', null, state.view === 'client' ? { client: state.clientName } : (state.view === 'project' && p ? { client: p.client, project: p.id } : {}));
      else if (a === 'new-quote') openDocForm('quote', null, state.view === 'client' ? { client: state.clientName } : (state.view === 'project' && p ? { client: p.client, project: p.id } : {}));
      else if (a === 'new-client') openClientForm(null);
      else if (a === 'edit-client') openClientForm(clientRow(state.clientName));
      else if (a === 'more-entries') { state.entryLimit += 300; render(true); }
    }
  }

  /* ---------- start ---------- */
  function start() {
    if (state.started) return; state.started = true;
    if (!configured()) { show('screen-setup'); return; }
    show('screen-loading');
    initGsi();
    google.accounts.id.prompt(function (n) {
      if (!state.token && ((n.isNotDisplayed && n.isNotDisplayed()) || (n.isSkippedMoment && n.isSkippedMoment()) || (n.isDismissedMoment && n.isDismissedMoment()))) signedOutScreen('');
    });
    setTimeout(function () { if (!state.token && !state.data) signedOutScreen(''); }, 4000);
  }

  window.OB = { gsiReady: function () { state.gsiLoaded = true; start(); } };

  document.addEventListener('click', function (e) {
    if (!e.target.closest || ($('modal') && $('modal').contains(e.target))) return;
    if (e.target.closest('a')) return;
    onAction(e.target);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('modal')) { closeModal(); return; }
    if (e.key !== 'Enter' || $('modal')) return;
    var r = e.target.closest && e.target.closest('[data-project],[data-entry],[data-client],[data-review],[data-doc]');
    if (r) onAction(r);
  });
  $('btn-refresh').addEventListener('click', function () { loadBoot().then(function () { toast('Refreshed'); }); });
  window.addEventListener('beforeunload', function (e) { if (savingCount > 0 || uploading.total > 0) { e.preventDefault(); e.returnValue = ''; } });

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* app still works without it */ }); });
  if (window.google && window.google.accounts) start();
})();
