(function () {
  'use strict';
  var CFG = window.OB_CONFIG || {};
  var state = { token: '', data: null, view: 'dashboard', projectId: '', gsiLoaded: false, started: false, tokenWaiters: [], refreshTimer: null };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function money(n) { return Math.round(num(n)).toLocaleString('en-US'); }
  function lkr(n) { return 'LKR ' + money(n); }
  function ym(d) { return String(d || '').slice(0, 7); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monLabel(m) { return MON[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4); }
  function show(id) { ['screen-signin', 'screen-setup', 'screen-loading'].forEach(function (s) { $(s).hidden = s !== id; }); $('app').hidden = true; }
  function showApp() { ['screen-signin', 'screen-setup', 'screen-loading'].forEach(function (s) { $(s).hidden = true; }); $('app').hidden = false; }
  var toastTimer;
  function toast(msg, isErr) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 6000 : 2500);
  }
  function jwtExp(tok) { try { var p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return Number(p.exp) || 0; } catch (e) { return 0; } }

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

  /** Asks Google for a fresh token; resolves true if one arrives soon. */
  function renewToken() {
    return new Promise(function (resolve) {
      state.tokenWaiters.push(resolve);
      try { google.accounts.id.prompt(); } catch (e) { resolve(false); }
      setTimeout(function () { resolve(false); }, 8000);
    });
  }

  function signedOutScreen(msg) {
    state.token = ''; state.data = null;
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
    return api('getBootData').then(function (d) {
      state.data = d; showApp(); render();
    }).catch(function (e) {
      if (e.code === 'auth' || e.code === 'noaccess') { signedOutScreen(e.message); return; }
      if (state.data) toast(e.message, true);
      else { signedOutScreen(e.message || 'Could not reach the server. Check your connection.'); }
    }).then(function () { $('btn-refresh').disabled = false; });
  }

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

  /* ---------- views ---------- */
  function kpi(label, value, note, cls) {
    return '<div class="card' + (cls === 'profit' ? ' profit' : '') + '"><div class="label">' + esc(label) + '</div><div class="big' + (cls && cls !== 'profit' ? ' ' + cls : '') + '">' + value + '</div>' + (note ? '<div class="note">' + note + '</div>' : '') + '</div>';
  }

  function chartSvg(c) {
    var W = 640, H = 200, padL = 8, padB = 22, padT = 8, n = c.months.length, bw = (W - padL) / n, max = 1;
    c.months.forEach(function (m) { max = Math.max(max, c.inM[m], c.outM[m]); });
    var parts = [];
    c.months.forEach(function (m, i) {
      var x = padL + i * bw, h1 = (c.inM[m] / max) * (H - padB - padT), h2 = (c.outM[m] / max) * (H - padB - padT), base = H - padB, w = bw * 0.34;
      parts.push('<rect x="' + (x + bw * 0.1).toFixed(1) + '" y="' + (base - h1).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h1.toFixed(1) + '" rx="3" fill="#2B4BFF"><title>' + esc(monLabel(m)) + ' income ' + esc(lkr(c.inM[m])) + '</title></rect>');
      parts.push('<rect x="' + (x + bw * 0.1 + w + 2).toFixed(1) + '" y="' + (base - h2).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h2.toFixed(1) + '" rx="3" fill="#FF2E8A"><title>' + esc(monLabel(m)) + ' costs ' + esc(lkr(c.outM[m])) + '</title></rect>');
      parts.push('<text x="' + (x + bw * 0.45).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="#8E87AA" font-family="JetBrains Mono, monospace">' + MON[Number(m.slice(5, 7)) - 1].toUpperCase() + '</text>');
    });
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Income and costs by month">' + parts.join('') + '</svg>' +
      '<div class="legend"><span><i style="background:#2B4BFF"></i>Income</span><span><i style="background:#FF2E8A"></i>Costs</span></div>';
  }

  function viewDashboard() {
    var d = state.data, c = compute(d), u = d.user, h = '';
    h += '<h1 class="page-title">Dashboard</h1><p class="sub">Financial year from ' + esc(monLabel(c.months[0])) + '. Accrual basis, LKR.</p>';
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
      return '<li><span>' + esc(x.p.name) + '<br><span class="muted" style="font-size:12px">' + esc(x.p.client) + '</span></span><span class="' + (pr < 0 ? 'over' : 'good') + '">' + lkr(pr) + '</span></li>';
    }).join('') + '</ul>';
  }

  function statusBadge(s) {
    var cls = (s === 'Delivered' || s === 'Closed') ? 'good' : (s === 'Cancelled' ? 'late' : '');
    return '<span class="pillbadge ' + cls + '">' + esc(s || '') + '</span>';
  }

  function viewProjects() {
    var d = state.data, c = compute(d);
    var rows = Object.keys(c.byProject).map(function (k) { return c.byProject[k]; }).filter(function (x) { return x.p.business_line !== 'AI data'; })
      .sort(function (a, b) { return String(b.p.start || '').localeCompare(String(a.p.start || '')) || b.inv - a.inv; });
    var h = '<h1 class="page-title">Projects</h1><p class="sub">Tap a project to see its budget, costs, income and invoices.</p>';
    if (!rows.length) return h + '<div class="card empty">No projects yet.</div>';
    h += '<div class="card tablewrap"><table><thead><tr><th>Project</th><th>Client</th><th>Status</th><th class="num">Agreed</th><th class="num">Invoiced</th><th class="num">Costs</th><th class="num">Profit</th></tr></thead><tbody>';
    rows.forEach(function (x) {
      var pr = x.inv - x.cost;
      h += '<tr class="clickrow" data-project="' + esc(x.p.id) + '" tabindex="0"><td><b>' + esc(x.p.name) + '</b></td><td>' + esc(x.p.client) + '</td><td>' + statusBadge(x.p.status) + '</td>' +
        '<td class="num">' + (x.p.agreed_fee === '' || x.p.agreed_fee == null ? '<span class="muted">-</span>' : money(x.p.agreed_fee)) + '</td>' +
        '<td class="num">' + money(x.inv) + '</td><td class="num">' + money(x.cost) + '</td><td class="num ' + (pr < 0 ? 'over' : 'good') + '">' + money(pr) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    var ai = c.ai;
    if (ai.income || ai.cost) h += '<div class="card" style="margin-top:14px"><div class="label">AI data (monthly totals only)</div><div class="big">' + lkr(ai.income - ai.cost) + '</div><div class="note">Income ' + lkr(ai.income) + ' · Costs ' + lkr(ai.cost) + '</div></div>';
    return h;
  }


  var BUDGET_TYPES = [
    ['Equipment rental', 'budget_equipment_rental'], ['Crew / freelancer', 'budget_crew'], ['Transport', 'budget_transport'],
    ['Food', 'budget_food'], ['Location & venue', 'budget_location'], ['Other', 'budget_other']
  ];

  function viewProject() {
    var d = state.data, p = (d.projects || []).filter(function (x) { return String(x.id) === String(state.projectId); })[0];
    if (!p) { state.view = 'projects'; return viewProjects(); }
    var entries = (d.entries || []).filter(function (e) { return String(e.project) === String(p.id) && String(e.account) !== '1400'; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var costs = entries.filter(function (e) { return e.kind === 'cost'; }), income = entries.filter(function (e) { return e.kind === 'income'; });
    var totCost = 0, totInc = 0, byType = {};
    costs.forEach(function (e) { var a = num(e.amount); totCost += a; byType[e.cost_type] = (byType[e.cost_type] || 0) + a; });
    income.forEach(function (e) { totInc += num(e.amount); });
    var invs = (d.invoices || []).filter(function (i) { return String(i.project) === String(p.id) || String(i.project) === String(p.name); });
    var agreed = p.agreed_fee === '' || p.agreed_fee == null ? null : num(p.agreed_fee);
    var profit = totInc - totCost;

    var h = '<button class="pill ghost" id="btn-back" type="button">&larr; All projects</button>';
    h += '<h1 class="page-title" style="margin-top:14px">' + esc(p.name) + '</h1>';
    h += '<p class="sub">' + esc(p.client) + ' · ' + statusBadge(p.status) + (p.start ? ' · ' + esc(p.start) + (p.end ? ' to ' + esc(p.end) : '') : '') + (p.property ? ' · ' + esc(p.property) : '') + '</p>';

    h += '<div class="grid kpis">';
    h += kpi('Profit so far', lkr(profit), 'Income recorded less costs', 'profit');
    h += kpi('Agreed fee', agreed == null ? '<span class="muted">-</span>' : lkr(agreed), agreed == null ? 'No fee set' : 'Recorded income ' + lkr(totInc) + (agreed ? ' (' + Math.round(totInc / agreed * 100) + '%)' : ''));
    h += kpi('Costs', lkr(totCost), costs.length + ' line' + (costs.length === 1 ? '' : 's'));
    h += '</div>';

    // budget vs actual
    var rows = '', budgetTotal = 0;
    BUDGET_TYPES.forEach(function (t) {
      var b = p[t[1]] === '' || p[t[1]] == null ? null : num(p[t[1]]), a = byType[t[0]] || 0;
      if (b == null && !a) return;
      if (b != null) budgetTotal += b;
      var pct = b ? Math.min(100, a / b * 100) : 0, cls = b && a > b ? 'over' : (b && pct >= 75 ? 'warn' : '');
      rows += '<tr><td>' + esc(t[0]) + '</td><td class="num">' + (b == null ? '<span class="muted">-</span>' : money(b)) + '</td><td class="num">' + money(a) + '</td>' +
        '<td class="num ' + (b != null && a > b ? 'over' : '') + '">' + (b == null ? '<span class="muted">-</span>' : money(b - a)) + '</td>' +
        '<td style="min-width:90px">' + (b ? '<div class="bar ' + cls + '" style="margin:0"><i style="width:' + pct.toFixed(0) + '%"></i></div>' : '') + '</td></tr>';
    });
    Object.keys(byType).forEach(function (k) {
      if (!BUDGET_TYPES.some(function (t) { return t[0] === k; })) rows += '<tr><td>' + esc(k || 'Uncategorised') + '</td><td class="num"><span class="muted">-</span></td><td class="num">' + money(byType[k]) + '</td><td class="num"><span class="muted">-</span></td><td></td></tr>';
    });
    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Budget vs actual</h3>' +
      (rows ? '<table><thead><tr><th>Cost type</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Left</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="empty">No budget or costs yet.</div>') +
      (p.budget_url ? '<p class="note"><a href="' + esc(p.budget_url) + '" target="_blank" rel="noopener">Open budget sheet</a></p>' : '') + '</div>';

    function entryTable(list, empty) {
      if (!list.length) return '<div class="empty">' + empty + '</div>';
      return '<table><thead><tr><th>Date</th><th>Payee</th><th>Description</th><th>Type</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>' +
        list.map(function (e) {
          return '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.payee) + '</td><td>' + esc(e.description) + '</td><td>' + esc(e.cost_type) + '</td><td>' +
            '<span class="pillbadge ' + (e.paid_status === 'paid' ? 'good' : 'warn') + '">' + esc(e.paid_status || '') + '</span>' +
            (e.doc_url ? ' <a href="' + esc(e.doc_url) + '" target="_blank" rel="noopener">doc</a>' : '') + '</td><td class="num">' + money(e.amount) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Costs</h3>' + entryTable(costs, 'No costs recorded against this project.') + '</div>';
    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Income</h3>' + entryTable(income, 'No income recorded against this project.') + '</div>';

    h += '<div class="card tablewrap" style="margin-top:14px"><h3>Invoices</h3>' + (invs.length ?
      '<table><thead><tr><th>Number</th><th>Date</th><th>Due</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th></tr></thead><tbody>' +
      invs.map(function (i) {
        return '<tr><td>' + (i.pdf_url ? '<a href="' + esc(i.pdf_url) + '" target="_blank" rel="noopener">' + esc(i.number) + '</a>' : esc(i.number)) + '</td><td>' + esc(i.date) + '</td><td>' + esc(i.due) + '</td><td>' + statusBadge(i.status) + '</td><td class="num">' + money(i.total) + '</td><td class="num">' + money(num(i.paid_amount) + num(i.advance_applied)) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="empty">No invoices for this project.</div>') + '</div>';

    if (p.notes) h += '<div class="card" style="margin-top:14px"><h3>Notes</h3><p class="muted" style="white-space:pre-wrap">' + esc(p.notes) + '</p></div>';
    return h;
  }

  function viewMore() {
    var u = state.data.user;
    var h = '<h1 class="page-title">More</h1><p class="sub">Signed in as ' + esc(u.name || u.email) + ' (' + esc(u.role) + ').</p>';
    h += '<div class="card"><h3>Install Offset Books</h3><ol class="steps">' +
      '<li><b>iPhone:</b> open this page in Safari, tap Share, then <b>Add to Home Screen</b>.</li>' +
      '<li><b>Android:</b> in Chrome tap the menu, then <b>Install app</b>.</li>' +
      '<li><b>Mac or PC:</b> in Chrome or Edge click the install icon in the address bar, or the menu, then <b>Install Offset Books</b>.</li></ol></div>';
    h += '<div class="card" style="margin-top:14px"><h3>Session</h3><p class="muted">Financial data is never stored on this device.</p><button class="pill" id="btn-signout" type="button">Sign out</button></div>';
    return h;
  }

  function render() {
    var d = state.data; if (!d) return;
    $('who').innerHTML = '<b>' + esc(d.user.name || d.user.email) + '</b> · ' + esc(d.user.role);
    document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === (state.view === 'project' ? 'projects' : state.view)); });
    var v = state.view === 'project' ? viewProject() : state.view === 'projects' ? viewProjects() : (state.view === 'more' ? viewMore() : viewDashboard());
    $('view').innerHTML = v;
    var so = $('btn-signout'); if (so) so.addEventListener('click', signOut);
    var bk = $('btn-back'); if (bk) bk.addEventListener('click', function () { state.view = 'projects'; render(); });
    window.scrollTo(0, 0);
  }

  /* ---------- start ---------- */
  function start() {
    if (state.started) return; state.started = true;
    if (!configured()) { show('screen-setup'); return; }
    show('screen-loading');
    initGsi();
    // If Google can sign in silently, onCredential fires. Otherwise show the button.
    google.accounts.id.prompt(function (n) {
      if (!state.token && ((n.isNotDisplayed && n.isNotDisplayed()) || (n.isSkippedMoment && n.isSkippedMoment()) || (n.isDismissedMoment && n.isDismissedMoment()))) signedOutScreen('');
    });
    setTimeout(function () { if (!state.token && !state.data) signedOutScreen(''); }, 4000);
  }

  window.OB = { gsiReady: function () { state.gsiLoaded = true; start(); } };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.nav-item');
    if (b) { state.view = b.getAttribute('data-view'); render(); return; }
    var r = e.target.closest && e.target.closest('[data-project]');
    if (r) { state.projectId = r.getAttribute('data-project'); state.view = 'project'; render(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var r = e.target.closest && e.target.closest('[data-project]');
    if (r) { state.projectId = r.getAttribute('data-project'); state.view = 'project'; render(); }
  });
  $('btn-refresh').addEventListener('click', function () { loadBoot().then(function () { toast('Refreshed'); }); });

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* app still works without it */ }); });
  if (window.google && window.google.accounts) start();
})();
