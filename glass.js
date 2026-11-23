// Offset Books glass layer (look and navigation only).
// - slides the selected pill in the nav, in tab/filter rows
// - desktop: collapsible icon rail + floating top bar (breadcrumb, search, + Add, theme, Inbox)
// - plays a short page-in and rolls the big figures up on each screen change
// Reads DATA only; every action goes through the app's own data-* click handlers. Writes nothing.
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var nav = doc.getElementById('nav') || doc.querySelector('nav');
  var main = doc.getElementById('main') || doc.querySelector('main');
  if (!nav || !main) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var desk = window.matchMedia ? matchMedia('(min-width: 821px)') : { matches: true };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  var I = {
    rail: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>'
  };
  var LABEL = { dashboard: 'Dashboard', inbox: 'Inbox', projects: 'Projects', project: 'Projects', entries: 'Entries', vendors: 'Vendors', bank: 'Bank', pay: 'Payments', docs: 'Invoices', doc: 'Invoices', edit: 'Invoices', clients: 'Clients', crew: 'Crew', settings: 'Settings', books: 'Books', acct: 'Accounts', more: 'More' };
  function view() { return doc.body.getAttribute('data-obview') || (window.state && state.view) || 'dashboard'; }

  /* ---------- sliding pills ---------- */
  // A pill keeps one element per row; the row is re-rendered by the app, so we remember the last box per row key
  // and glide from there to the new selection.
  var memo = {};
  function slide(row, sel, key, pad) {
    var pill = row.querySelector(':scope > .gl-pill');
    if (!pill) { pill = doc.createElement('i'); pill.className = 'gl-pill'; pill.setAttribute('aria-hidden', 'true'); row.insertBefore(pill, row.firstChild); }
    if (!sel || !sel.offsetParent) { pill.style.opacity = '0'; return; }
    var box = { x: sel.offsetLeft, y: sel.offsetTop, w: sel.offsetWidth, h: sel.offsetHeight };
    var prev = memo[key];
    function set(b) { pill.style.width = b.w + 'px'; pill.style.height = b.h + 'px'; pill.style.transform = 'translate(' + b.x + 'px,' + b.y + 'px)'; }
    if (prev && !reduce && (prev.x !== box.x || prev.y !== box.y || prev.w !== box.w) && pill.__box !== JSON.stringify(box)) {
      pill.style.transition = 'none'; set(prev); pill.style.opacity = '1'; void pill.offsetWidth; pill.style.transition = ''; set(box);
    } else { if (!pill.__box) { pill.style.transition = 'none'; set(box); void pill.offsetWidth; pill.style.transition = ''; } else set(box); pill.style.opacity = '1'; }
    pill.__box = JSON.stringify(box); memo[key] = box;
  }
  function pills() {
    slide(nav, nav.querySelector('a.on'), 'nav');
    var v = view();
    main.querySelectorAll('.filters').forEach(function (row, i) {
      var ons = row.querySelectorAll(':scope > .chip.on');
      if (ons.length !== 1) { row.classList.remove('gl-slide'); var op = row.querySelector(':scope > .gl-pill'); if (op) op.remove(); return; }
      row.classList.add('gl-slide'); slide(row, ons[0], v + ':' + i);
    });
  }

  /* ---------- rail (desktop) ---------- */
  function railState() { var r = ls('ob_rail'); return r === null ? '1' : r; }
  function applyRail() { root.classList.toggle('gl-rail', desk.matches && railState() === '1'); }
  function railBtn() {
    if (nav.querySelector('.gl-railbtn')) return;
    var b = doc.createElement('button'); b.type = 'button'; b.className = 'gl-railbtn';
    b.innerHTML = I.rail; b.setAttribute('aria-label', 'Collapse or expand the side panel');
    b.addEventListener('click', function (e) { e.stopPropagation(); ls('ob_rail', railState() === '1' ? '0' : '1'); applyRail(); setTimeout(pills, 420); });
    var logo = nav.querySelector('.logo'); if (logo) logo.appendChild(b); else nav.insertBefore(b, nav.firstChild);
    nav.querySelectorAll('a[data-view]').forEach(function (a) { var l = a.querySelector('.lbl'); if (l && !a.title) a.title = l.textContent; });
  }

  /* ---------- top bar (desktop) ---------- */
  var top = doc.createElement('header'); top.id = 'gl-top'; top.setAttribute('aria-label', 'Top bar');
  top.innerHTML =
    '<div class="gl-crumb" role="navigation" aria-label="You are here"></div>' +
    '<div class="gl-search" role="search"><span class="gl-sico">' + I.search + '</span>' +
    '<input id="gl-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search projects, invoices, entries, clients" aria-label="Search" aria-controls="gl-res">' +
    '<kbd>/</kbd><div id="gl-res" role="listbox" hidden></div></div>' +
    '<button type="button" class="btn primary gl-add" data-act="new-entry">' + I.plus + '<span>Add</span></button>' +
    '<button type="button" class="gl-ib" data-obx="theme-flip" aria-label="Switch theme">' + I.sun + '</button>' +
    '<button type="button" class="gl-ib gl-bell" data-view="inbox" aria-label="Inbox">' + I.bell + '<span class="gl-dot" hidden></span></button>';
  main.parentNode.insertBefore(top, main);
  var crumb = top.querySelector('.gl-crumb'), q = top.querySelector('#gl-q'), res = top.querySelector('#gl-res'), dot = top.querySelector('.gl-dot');
  function topbar() {
    var v = view(), h1 = main.querySelector('h1'), parts = ['Offset Media', LABEL[v] || (v.charAt(0).toUpperCase() + v.slice(1))];
    if ((v === 'project' || v === 'doc' || v === 'edit') && h1) parts.push(h1.textContent.trim());
    crumb.innerHTML = parts.map(function (p, i) { return (i ? '<span class="gl-sep" aria-hidden="true">›</span>' : '') + '<span' + (i === parts.length - 1 ? ' aria-current="page"' : '') + '>' + esc(p) + '</span>'; }).join('');
    var add = top.querySelector('.gl-add'); var role = window.ROLE || 'admin';
    add.hidden = !(role === 'admin' || role === 'viewer');
    var n = 0; try { n = (window.OBX && OBX.unread) ? OBX.unread() : 0; } catch (e) {}
    dot.hidden = !n; top.querySelector('.gl-bell').setAttribute('aria-label', n ? 'Inbox, ' + n + ' unread' : 'Inbox');
  }

  /* search: reads DATA already loaded in the app, opens items through the app's own handlers */
  var hits = [], cur = -1;
  function money(x) { var n = Number(String(x).replace(/,/g, '')); return isFinite(n) && n ? n.toLocaleString('en-US') : ''; }
  function find(term) {
    var D = window.DATA || {}, t = term.toLowerCase().trim(), out = [];
    if (t.length < 2) return out;
    function has() { for (var i = 0; i < arguments.length; i++) if (String(arguments[i] || '').toLowerCase().indexOf(t) >= 0) return true; return false; }
    (D.projects || []).forEach(function (p) { if (has(p.name, p.client, p.id)) out.push({ k: 'Project', a: 'data-gl-pid', v: p.id, t: p.name, s: p.client }); });
    (D.invoices || []).forEach(function (i) { if (has(i.number, i.client, i.subject)) out.push({ k: 'Invoice', a: 'data-doc', v: 'invoice|' + i.number, t: i.number + (i.subject ? ' · ' + i.subject : ''), s: i.client, m: money(i.total) }); });
    (D.quotes || []).forEach(function (i) { if (has(i.number, i.client, i.subject)) out.push({ k: 'Quote', a: 'data-doc', v: 'quote|' + i.number, t: i.number + (i.subject ? ' · ' + i.subject : ''), s: i.client, m: money(i.total) }); });
    var role = window.ROLE || 'admin';
    if (role === 'admin' || role === 'accountant') (D.entries || []).forEach(function (e) { if (has(e.description, e.vendor, e.client, e.invoice_no, e.id, e.cost_type)) out.push({ k: e.kind === 'income' ? 'Income' : 'Cost', a: 'data-eid', v: e.id, t: e.description || e.cost_type || e.id, s: [e.date, e.vendor || e.client].filter(Boolean).join(' · '), m: money(e.amount) }); });
    (D.clients || []).forEach(function (c) { var n = c.name || c.client || ''; if (n && has(n)) out.push({ k: 'Client', a: 'data-view', v: 'clients', t: n, s: 'Clients' }); });
    return out.slice(0, 12);
  }
  function draw() {
    if (!hits.length) { res.innerHTML = q.value.trim().length > 1 ? '<div class="gl-none">Nothing matches “' + esc(q.value.trim()) + '”</div>' : ''; res.hidden = q.value.trim().length < 2; return; }
    res.innerHTML = hits.map(function (h, i) {
      return '<button type="button" role="option" class="gl-hit' + (i === cur ? ' on' : '') + '" ' + h.a + '="' + esc(h.v) + '" data-gl-i="' + i + '">' +
        '<span class="gl-k">' + esc(h.k) + '</span><span class="gl-t"><b>' + esc(h.t) + '</b><small>' + esc(h.s || '') + '</small></span>' + (h.m ? '<span class="gl-m">' + esc(h.m) + '</span>' : '') + '</button>';
    }).join('');
    res.hidden = false;
  }
  function close() { res.hidden = true; cur = -1; }
  q.addEventListener('input', function () { hits = find(q.value); cur = hits.length ? 0 : -1; draw(); });
  q.addEventListener('focus', function () { if (q.value.trim().length > 1) { hits = find(q.value); draw(); } });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!hits.length) return; cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; draw(); }
    else if (e.key === 'Enter') { var b = res.querySelector('.gl-hit.on'); if (b) { e.preventDefault(); b.click(); } }
    else if (e.key === 'Escape') { q.value = ''; close(); q.blur(); }
  });
  res.addEventListener('click', function (e) {
    var pb = e.target.closest && e.target.closest('[data-gl-pid]'); if (pb && typeof window.openProject === 'function') window.openProject(pb.getAttribute('data-gl-pid')); setTimeout(function () { q.value = ''; close(); q.blur(); }, 0); }); // the app's own document handler opens the item first
  doc.addEventListener('click', function (e) { if (!top.contains(e.target)) close(); });
  doc.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag) && !e.target.isContentEditable && desk.matches && !doc.querySelector('.mback:not([hidden]), #modal.on, #obx-modal.on')) { e.preventDefault(); q.focus(); }
  });


  /* ---------- pass 2: small charts (read-only, drawn from figures the app already computes) ---------- */
  function svgEl(w, h, body, cls) { return '<svg class="' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + body + '</svg>'; }
  function spark(vals, hi) {
    var W = 120, H = 36, n = vals.length; if (n < 2) return '';
    var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals.concat([0])); if (mx === mn) mx = mn + 1;
    var pts = vals.map(function (v, i) { return [i * (W - 8) / (n - 1) + 4, H - 5 - (v - mn) / (mx - mn) * (H - 10)]; });
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var k = 0; k < n - 1; k++) { // smooth (Catmull-Rom to Bezier), clamped so the curve never overshoots the data
      var p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
      var c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      var lo = Math.min(p1[1], p2[1]), hi2 = Math.max(p1[1], p2[1]); c1[1] = Math.max(lo, Math.min(hi2, c1[1])); c2[1] = Math.max(lo, Math.min(hi2, c2[1]));
      d += ' C' + c1[0].toFixed(1) + ' ' + c1[1].toFixed(1) + ' ' + c2[0].toFixed(1) + ' ' + c2[1].toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    var area = d + ' L' + pts[n - 1][0].toFixed(1) + ' ' + H + ' L' + pts[0][0].toFixed(1) + ' ' + H + ' Z';
    var last = pts[n - 1];
    return svgEl(W, H, '<defs><linearGradient id="glsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#glsg)" stroke="none"/><path class="gl-line" d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6" class="' + (hi ? 'gl-hot' : 'gl-cold') + '"/>', 'gl-spark');
  }
  function gauge(r) {
    var p = Math.max(0, Math.min(1, r)), a = Math.PI * (1 - p), cx = 60, cy = 56, R = 46;
    var x = cx + R * Math.cos(a), y = cy - R * Math.sin(a);
    var arc = 'M' + (cx - R) + ' ' + cy + ' A' + R + ' ' + R + ' 0 0 1 ';
    return '<svg class="gl-gauge" viewBox="0 0 120 64" aria-hidden="true" focusable="false">' +
      '<path d="' + arc + (cx + R) + ' ' + cy + '" fill="none" stroke="currentColor" stroke-opacity=".14" stroke-width="8" stroke-linecap="round"/>' +
      (p > 0.002 ? '<path class="gl-garc" d="' + arc + x.toFixed(2) + ' ' + y.toFixed(2) + '" fill="none" stroke-width="8" stroke-linecap="round"/>' : '') +
      '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="5" class="gl-gknob"/></svg>';
  }
  function charts() {
    if (view() !== 'dashboard' || typeof window.mo !== 'function' || typeof window.fyMonths !== 'function') return;
    var ms, m; try { ms = fyMonths(); m = (window.state && state.month) || ms[ms.length - 1]; } catch (e) { return; }
    var i = ms.indexOf(m); if (i < 0) return;
    var win = ms.slice(Math.max(0, i - 5), i + 1); if (win.length < 2) return;
    var rows = win.map(function (x) { var o = mo(x) || {}; return { rev: +o.rev || 0, cost: +o.cost || 0 }; });
    main.querySelectorAll('.card').forEach(function (c) {
      if (c.querySelector('.gl-spark')) return;
      var lab = (c.querySelector('.mono') || {}).textContent || '', vals = null, hi = false;
      if (/^Profit this month/i.test(lab)) { vals = rows.map(function (r) { return r.rev - r.cost; }); hi = true; }
      else if (/^Revenue$/i.test(lab.trim())) vals = rows.map(function (r) { return r.rev; });
      else if (/^Costs$/i.test(lab.trim())) vals = rows.map(function (r) { return r.cost; });
      if (!vals) return;
      var wrap = doc.createElement('div'); wrap.className = 'gl-sparkwrap'; wrap.setAttribute('aria-hidden', 'true');
      wrap.innerHTML = spark(vals, hi) + '<span class="gl-sparkcap">' + win.length + ' months</span>';
      c.classList.add('gl-hasspark'); c.appendChild(wrap);
    });
    main.querySelectorAll('.panel').forEach(function (p) {
      var t = p.querySelector('.ptitle strong'); if (!t || !/^Claude spend$/.test(t.textContent.trim()) || p.querySelector('.gl-gauge')) return;
      var bar = p.querySelector('.bar > i'); if (!bar) return;
      var r = parseFloat(bar.style.width) / 100 || 0;
      var g = doc.createElement('div'); g.className = 'gl-gaugewrap'; g.innerHTML = gauge(r) + '<span class="gl-gpct">' + Math.round(r * 100) + '%<small>of budget</small></span>';
      p.classList.add('gl-hasgauge'); p.insertBefore(g, p.querySelector('.bar'));
    });
  }

  /* ---------- page-in + rolling figures ---------- */
  var lastView = null, timer;
  function roll() {
    if (reduce) return;
    main.querySelectorAll('.big, .kpi .big, .card .big').forEach(function (el) {
      if (el.childNodes.length !== 1 || el.firstChild.nodeType !== 3 || el.__rolled) return;
      var txt = el.textContent, m = txt.match(/^(\D*?)(-?)([\d,]+)(\.\d+)?(\D*)$/); if (!m) return;
      var end = Number(m[3].replace(/,/g, '') + (m[4] || '')); if (!isFinite(end) || end === 0) return;
      var dec = m[4] ? m[4].length - 1 : 0, comma = m[3].indexOf(',') >= 0 || end >= 1000, t0 = performance.now(), dur = 700;
      el.__rolled = true; el.style.minWidth = el.offsetWidth + 'px';
      (function step(now) {
        if (!el.isConnected) return;
        var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3), v = end * e;
        var s = dec ? v.toFixed(dec) : String(Math.round(v)); if (comma) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        el.firstChild.nodeValue = p < 1 ? m[1] + m[2] + s + m[5] : txt;
        if (p < 1) requestAnimationFrame(step); else el.style.minWidth = '';
      })(t0);
    });
  }
  function onRender() {
    var v = view();
    if (v !== lastView) {
      if (lastView !== null && !reduce) { main.classList.remove('gl-enter'); void main.offsetWidth; main.classList.add('gl-enter'); clearTimeout(timer); timer = setTimeout(function () { main.classList.remove('gl-enter'); }, 700); }
      if (lastView !== null) roll();
      lastView = v;
    }
    topbar(); pills(); charts();
  }

  /* ---------- wiring ---------- */
  var q1 = false;
  function soon() { if (q1) return; q1 = true; requestAnimationFrame(function () { q1 = false; railBtn(); onRender(); }); }
  new MutationObserver(soon).observe(nav, { childList: true });
  new MutationObserver(soon).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(soon).observe(doc.body, { attributes: true, attributeFilter: ['data-obview'] });
  (desk.addEventListener ? desk.addEventListener('change', function () { applyRail(); soon(); }) : desk.addListener(function () { applyRail(); soon(); }));
  window.addEventListener('resize', soon);
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(soon);
  applyRail(); soon(); setTimeout(soon, 300);
})();
