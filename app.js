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
    var cls = (s === 'Delivered' || s === 'Closed') ? 'good' : (s === 'Cancelled' ? 'late' : '');
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
    if (na) h += '<button class="banner warnb" data-go="assign" type="button"><b>' + na + ' supplier cost' + (na === 1 ? '' : 's') + '</b> need a project. Tap to assign or split them.</button>';
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
    if (edit) h += '<button class="pill ghost" data-act="edit-project" type="button">Edit project and budget</button>';
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

    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Invoices</h3>' + (invs.length ?
      '<table><thead><tr><th>Number</th><th>Date</th><th>Due</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th></tr></thead><tbody>' +
      invs.map(function (i) {
        return '<tr><td>' + (i.pdf_url ? '<a href="' + esc(i.pdf_url) + '" target="_blank" rel="noopener">' + esc(i.number) + '</a>' : esc(i.number)) + '</td><td>' + esc(i.date) + '</td><td>' + esc(i.due) + '</td><td>' + statusBadge(i.status) + '</td><td class="num">' + money0(i.total) + '</td><td class="num">' + money0(num(i.paid_amount) + num(i.advance_applied)) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">No invoices for this project.</div>') + '</div>';

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

  /* ---------- to assign ---------- */
  function viewAssign() {
    var list = toAssign();
    var h = '<div class="titlerow"><div><h1 class="page-title">To assign</h1><p class="sub">Supplier costs (rentals, crew, studios) with no project yet. Assign each one to a project, split it across several, or mark it as overhead.</p></div>' +
      (canEdit() ? '<button class="pill" data-act="add-bill" type="button">Add split bill</button>' : '') + '</div>';
    h += editBanner();
    if (!list.length) return h + '<div class="card empty">Nothing waiting. New rental and crew payments without a project will show up here.</div>';
    h += '<div class="grid">' + list.map(function (e) {
      return '<div class="card assign"><div><div class="label">' + esc(e.date) + ' · ' + esc(e.cost_type) + '</div><div class="big small-big">' + lkr(e.amount) + '</div>' +
        '<div><b>' + esc(e.payee) + '</b> · ' + esc(e.description) + (e.doc_number ? ' · ' + esc(e.doc_number) : '') + '</div>' + (e.notes ? '<div class="note">' + esc(e.notes) + '</div>' : '') + '</div>' +
        (canEdit() ? '<div class="btns"><button class="pill small" data-split="' + esc(e.id) + '" type="button">Assign or split</button><button class="pill ghost small" data-overhead="' + esc(e.id) + '" type="button">It\'s overhead</button></div>' : '') + '</div>';
    }).join('') + '</div>';
    return h;
  }

  /* ---------- more ---------- */
  function viewMore() {
    var u = state.data.user;
    var h = '<h1 class="page-title">More</h1><p class="sub">Signed in as ' + esc(u.name || u.email) + ' (' + esc(u.role) + ').</p>';
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

  /**
   * One supplier bill (e.g. a TG rental invoice) divided across projects.
   * existing = entries the bill replaces (empty for a new bill).
   */
  function openBillForm(existing, defaults) {
    existing = existing || [];
    var first = existing[0] || {}, total = 0;
    existing.forEach(function (x) { total += num(x.amount); });
    var hdr = Object.assign({ date: todayIso(), payment_method: 'Bank transfer', paid_status: 'paid', paid_date: todayIso(), doc_status: 'invoice' }, defaults || {},
      existing.length ? { date: first.date, payee: first.payee, doc_number: first.doc_number, doc_url: first.doc_url, doc_status: first.doc_status, payment_method: first.payment_method, paid_status: first.paid_status, paid_date: first.paid_date, notes: first.notes, description: first.description } : {});
    var lines = existing.length ? existing.map(function (x) { return { project: x.project, shoot: x.shoot, cost_type: x.cost_type || 'Equipment rental', description: x.description, amount: num(x.amount) }; })
      : [{ project: state.view === 'project' ? state.projectId : '', shoot: '', cost_type: 'Equipment rental', description: '', amount: '' }];
    if (existing.length === 1 && !first.bill_id) lines.push({ project: '', shoot: '', cost_type: lines[0].cost_type, description: lines[0].description, amount: '' });

    var body = '<form id="bill-form" class="form" novalidate>' +
      '<p class="note">Enter the bill once, then divide it between projects. Each line becomes a cost on that project; leave a line\'s project empty for company overhead.</p>' +
      '<div class="row2">' + field('Supplier', input('payee', hdr.payee, 'list="dl-payees" autocomplete="off" required')) + field('Bill date', input('date', hdr.date, 'type="date" required')) + '</div>' +
      '<div class="row2">' + field('Invoice no.', input('doc_number', hdr.doc_number)) + field('Bill total (LKR)', input('total', existing.length ? total : '', 'inputmode="decimal" required')) + '</div>' +
      '<div class="row2">' + field('Paid by', select('payment_method', pairs(PAY_METHODS), hdr.payment_method)) + field('Status', select('paid_status', [['paid', 'Paid'], ['unpaid', 'Not paid yet']], hdr.paid_status)) + '</div>' +
      '<div class="row2">' + field('Paid date', input('paid_date', hdr.paid_date, 'type="date"')) + field('Document link', input('doc_url', hdr.doc_url, 'type="url" placeholder="https://drive.google.com/..."')) + '</div>' +
      field('Notes', input('notes', hdr.notes)) +
      '<div class="label" style="margin-top:8px">How the bill is divided</div><div id="bill-lines"></div>' +
      '<div class="btns" style="margin:8px 0"><button class="pill ghost small" type="button" data-addline>Add line</button><button class="pill ghost small" type="button" data-even>Split evenly</button></div>' +
      '<div class="bill-sum" id="bill-sum"></div>' +
      '<p class="form-err" id="form-err" role="alert"></p>' +
      '<div class="modal-actions"><span class="spacer"></span><button class="pill ghost" type="button" data-close>Cancel</button><button class="pill" type="submit" id="bill-save">Save bill</button></div>' +
      datalist('dl-payees', payees()) + datalist('dl-shoots', shoots('')) + '</form>';

    openModal(existing.length ? (first.bill_id ? 'Edit split bill' : 'Split ' + first.id + ' across projects') : 'Add split bill', body, function (m) {
      var form = m.querySelector('form'), box = $('bill-lines');
      function readLines() {
        return Array.prototype.map.call(box.querySelectorAll('.bill-line'), function (row) {
          return { project: row.querySelector('[name=l_project]').value, shoot: row.querySelector('[name=l_shoot]').value.trim(), cost_type: row.querySelector('[name=l_cost_type]').value,
            description: row.querySelector('[name=l_description]').value.trim(), amount: row.querySelector('[name=l_amount]').value.trim() };
        });
      }
      function draw() {
        box.innerHTML = lines.map(function (l, i) {
          return '<div class="bill-line"><div class="row2">' + field('Project', '<select name="l_project">' + projectOptions(l.project, true) + '</select>') +
            field('Amount', input('l_amount', l.amount, 'inputmode="decimal" placeholder="0"')) + '</div>' +
            '<div class="row3">' + field('Cost type', select('l_cost_type', pairs(costTypes()), l.cost_type)) + field('Shoot / day', input('l_shoot', l.shoot, 'list="dl-shoots"')) +
            field('What for', input('l_description', l.description)) + '</div>' +
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
      draw();
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
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = formData(form), ls = readLines(), err = '';
        if (!d.payee) err = 'Enter the supplier.';
        else if (!isDate(d.date)) err = 'Pick the bill date.';
        else if (ls.some(function (l) { return l.amount === '' || !isFinite(num(l.amount)); })) err = 'Every line needs an amount.';
        if (err) { $('form-err').textContent = err; return; }
        var header = { date: d.date, payee: d.payee, doc_number: d.doc_number, doc_url: d.doc_url, doc_status: d.doc_url ? 'invoice' : (hdr.doc_status || 'invoice'),
          payment_method: d.payment_method, paid_status: d.paid_status, paid_date: d.paid_date, notes: d.notes, business_line: first.business_line || 'Production' };
        if (first.bank_line_id) header.bank_line_id = first.bank_line_id;
        var payload = { replace_ids: existing.map(function (x) { return x.id; }), total: num(d.total), header: header,
          lines: ls.map(function (l) { return { project: l.project, shoot: l.shoot, cost_type: l.cost_type, description: l.description || d.notes || ('Bill ' + (d.doc_number || '')).trim(), amount: num(l.amount) }; }) };
        var temps = payload.lines.map(function (l) {
          var x = Object.assign({ id: tmpId(), kind: 'cost' }, header, l, { bill_id: first.bill_id || 'new' });
          x.account = autoAccount(x); x.allocation = x.project ? '' : 'overhead'; return x;
        });
        closeModal();
        commit(function () { removeEntries(payload.replace_ids); state.data.entries = state.data.entries.concat(temps); },
          function () { return api('obwSaveBill', [payload]); },
          function (res) { removeEntries(temps.map(function (t) { return t.id; })); state.data.entries = state.data.entries.concat(res.added); },
          'Bill saved as ' + payload.lines.length + ' line' + (payload.lines.length === 1 ? '' : 's'));
      });
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
    var navView = state.view === 'project' ? 'projects' : state.view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      var v = b.getAttribute('data-view');
      b.classList.toggle('active', v === navView);
      if (v === 'assign') b.hidden = d.user.role !== 'admin';
    });
    var badge = $('assign-count'), n = canEdit() ? toAssign().length : 0;
    if (badge) { badge.textContent = n; badge.hidden = !n; }
    var v = state.view === 'project' ? viewProject() : state.view === 'projects' ? viewProjects() : state.view === 'entries' ? viewEntries() :
      state.view === 'assign' ? viewAssign() : state.view === 'more' ? viewMore() : viewDashboard();
    $('view').innerHTML = v;
    var so = $('btn-signout'); if (so) so.addEventListener('click', signOut);
    bindFilters();
    window.scrollTo(0, keepScroll ? y : 0);
  }

  function bindFilters() {
    var map = { 'f-q': 'q', 'f-kind': 'kind', 'f-month': 'month', 'f-project': 'project' };
    Object.keys(map).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener(id === 'f-q' ? 'input' : 'change', function () {
        state.entryFilter[map[id]] = el.value; state.entryLimit = 150;
        var pos = el.selectionStart; render(true);
        var again = $(id); if (again) { again.focus(); if (id === 'f-q' && again.setSelectionRange) again.setSelectionRange(pos, pos); }
      });
    });
  }

  function go(view, pid) { state.view = view; if (pid != null) state.projectId = pid; render(); }

  function findEntry(id) { return (state.data.entries || []).filter(function (e) { return String(e.id) === String(id); })[0]; }

  function onAction(t) {
    var el;
    if ((el = t.closest('.nav-item'))) return go(el.getAttribute('data-view'));
    if ((el = t.closest('[data-go]'))) return go(el.getAttribute('data-go'));
    if ((el = t.closest('[data-entry]'))) { var en = findEntry(el.getAttribute('data-entry')); if (en) openEntryForm(en); return; }
    if ((el = t.closest('[data-project]'))) return go('project', el.getAttribute('data-project'));
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
    var r = e.target.closest && e.target.closest('[data-project],[data-entry]');
    if (r) onAction(r);
  });
  $('btn-refresh').addEventListener('click', function () { loadBoot().then(function () { toast('Refreshed'); }); });
  window.addEventListener('beforeunload', function (e) { if (savingCount > 0) { e.preventDefault(); e.returnValue = ''; } });

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* app still works without it */ }); });
  if (window.google && window.google.accounts) start();
})();
