/**
 * Offset Books - server (Session 5: bank statements, sorting rules, Claude sorting, spend checker)
 * Container-bound to the "Offset Books DB" Google Sheet.
 * Run setup() once, then Deploy > New deployment > Web app.
 * Run setupMirror() once (as contact@) to create the accountant's mirror sheet.
 * Run setupSession3() once (as contact@) to add the new columns and settings and authorise Drive and email.
 * Run setupSession4() once (as contact@) to add the entry and approval columns and create the Drive folders.
 * Run setupSession5() once (as contact@) to add the bank tabs, starting sorting rules and settings, and to authorise Calendar and external requests.
 * The Claude key is NOT in this file: add ANTHROPIC_API_KEY under Project Settings > Script properties.
 */
var TZ = 'Asia/Colombo';
var EDITABLE = { Projects: 'id', Clients: 'name', Crew: 'name' };

function setup() {
  var s = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('DB_ID', s.getId());
  Logger.log('Database linked: ' + s.getName() + ' (' + s.getId() + ')');
}

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v;
}

function read_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) return [];
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  var head = vals[0], out = [];
  for (var i = 1; i < vals.length; i++) {
    var row = vals[i];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var o = {};
    for (var j = 0; j < head.length; j++) o[head[j]] = cell_(row[j]);
    out.push(o);
  }
  return out;
}

function currentUser_() {
  var email = (API_EMAIL_ || Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) return null;
  var users = read_('Users');
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email) {
      return { email: email, name: users[i].name, role: users[i].role,
               hideLoans: String(users[i].hide_director_loans).toLowerCase() === 'yes' };
    }
  }
  return null;
}

function bootData_(u) {
  var settings = {};
  read_('Settings').forEach(function (r) { settings[r.key] = r.value; });
  var entries = read_('Entries');
  if (u.hideLoans) entries = entries.filter(function (e) { return String(e.account) !== '1400'; });
  // Viewers (Ahron) never receive director loans or director salary: filtered here so the data does not reach their device at all.
  if (u.role === 'viewer') entries = entries.filter(function (e) {
    var a = String(e.account);
    return a !== '1400' && a !== '6010' && !(String(e.cost_type) === 'Staff & salaries' && /josh|director/i.test(String(e.payee)));
  });
  var data = {
    user: u, settings: settings, entries: entries,
    projects: read_('Projects'), clients: read_('Clients'), crew: read_('Crew'),
    accounts: read_('Accounts'), invoices: read_('Invoices'), quotes: read_('Quotes'), recurring: read_('Recurring'),
    serverTime: new Date().getTime()
  };
  data.costmap = read_('CostTypeMap');
  if (u.role === 'admin' || u.role === 'accountant') {
    var stm = read_('Statements').filter(function (x) { return x.id; }).sort(function (x, y) { return String(x.to).localeCompare(String(y.to)); }), last = stm[stm.length - 1];
    data.cash = last ? { balance: toNum_(last.closing), as_at: String(last.to).slice(0, 10) } : null;
  }
  data.months = read_('Months').filter(function (m) { return m.month; }).map(function (m) { return { month: String(m.month).slice(0, 7), status: m.status, by: m.by, at: m.at, note: m.note }; });
  if (u.role === 'admin' || u.role === 'accountant') data.changes = read_('AccountantChanges').filter(function (c) { return c.id; }).slice(-300).reverse();
  if (u.role === 'admin') { data.users = read_('Users'); data.aiusage = read_('AIUsage'); }
  if (u.role === 'admin' || u.role === 'accountant') data.mirror = mirrorInfo_();
  if (u.role === 'admin' || u.role === 'viewer') {
    data.approvals = read_('Approvals').filter(function (a) {
      return a.id && (u.role === 'admin' || String(a.submitted_by).toLowerCase() === u.email);
    });
  }
  return data;
}

function safeJson_(o) {
  return JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function doGet() {
  var u = currentUser_();
  if (!u) {
    return HtmlService.createHtmlOutput(
      '<body style="background:#07060D;color:#EEEAF4;font-family:sans-serif;padding:40px">' +
      '<h2>No access</h2><p>This Google account is not set up for Offset Books. Ask Joshua to add you.</p></body>');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  t.boot = safeJson_(bootData_(u));
  return t.evaluate().setTitle('Offset Books')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Called by the Refresh button. */
function getBootData() {
  var u = currentUser_();
  if (!u) throw new Error('No access');
  return bootData_(u);
}

/** Admin-only save for Projects / Clients / Crew. Writes only the fields sent, logs old and new to AuditLog. */
function saveRow(tab, obj, reason) {
  var u = currentUser_();
  if (!u || u.role !== 'admin') throw new Error('Only the admin can edit.');
  var keyCol = EDITABLE[tab];
  if (!keyCol) throw new Error('This tab cannot be edited here.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var result;
  try {
    var sh = ss_().getSheetByName(tab);
    var vals = sh.getDataRange().getValues();
    var head = vals[0], kc = head.indexOf(keyCol), now = new Date(), log = [];
    var rowIdx = -1;
    for (var i = 1; i < vals.length; i++) if (String(vals[i][kc]) === String(obj[keyCol])) { rowIdx = i; break; }
    if (rowIdx < 0) {
      var nr = head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
      sh.appendRow(nr);
      log.push([now, u.email, tab, obj[keyCol], '(new row)', '', JSON.stringify(obj), reason || '']);
    } else {
      head.forEach(function (h, c) {
        if (obj[h] === undefined || h === keyCol) return;
        var old = cell_(vals[rowIdx][c]);
        if (String(old) !== String(obj[h])) {
          sh.getRange(rowIdx + 1, c + 1).setValue(obj[h]);
          log.push([now, u.email, tab, obj[keyCol], h, old, obj[h], reason || '']);
        }
      });
    }
    if (log.length) {
      var al = ss_().getSheetByName('AuditLog');
      al.getRange(al.getLastRow() + 1, 1, log.length, 8).setValues(log);
    }
    result = { ok: true, changes: log.length };
  } finally { lock.releaseLock(); }
  // Keep the accountant's mirror in step. A failure here must never fail the save.
  if (result.changes && mirrorId_()) { try { syncMirror_(); } catch (e) { Logger.log('Mirror sync after save failed: ' + e); } }
  return result;
}

/* =====================  Accountant mirror sheet  ===================== */

var MIRROR_COPY_TABS = ['Entries', 'Invoices', 'Quotes', 'Clients', 'Crew', 'Accounts'];

function mirrorId_() { return PropertiesService.getScriptProperties().getProperty('MIRROR_ID'); }

function mirrorInfo_() {
  var id = mirrorId_();
  if (!id) return null;
  return { url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
           last: PropertiesService.getScriptProperties().getProperty('MIRROR_LAST') || '' };
}

/**
 * Run once from the editor, signed in as contact@offset-media.com.
 * Creates "Offset Books - Accountant mirror" in the Offset Books Drive folder, shares it
 * (view only) with every user whose role is accountant, and installs an hourly sync.
 * Safe to run again: it reuses the same mirror and only refreshes sharing, trigger and data.
 */
function setupMirror() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MIRROR_ID'), sp = null;
  if (id) { try { sp = SpreadsheetApp.openById(id); } catch (e) { sp = null; } }
  if (!sp) {
    sp = SpreadsheetApp.create('Offset Books - Accountant mirror');
    props.setProperty('MIRROR_ID', sp.getId());
    var settings = {};
    read_('Settings').forEach(function (r) { settings[r.key] = r.value; });
    if (settings.drive_root_id) {
      try { DriveApp.getFileById(sp.getId()).moveTo(DriveApp.getFolderById(String(settings.drive_root_id))); }
      catch (e) { Logger.log('Could not move the mirror into the Offset Books folder: ' + e); }
    }
  }
  var file = DriveApp.getFileById(sp.getId());
  read_('Users').forEach(function (u) {
    if (String(u.role) === 'accountant' && u.email) {
      try { file.addViewer(String(u.email)); Logger.log('Shared (view) with ' + u.email); }
      catch (e) { Logger.log('Could not share with ' + u.email + ': ' + e); }
    }
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncMirrorTimer') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncMirrorTimer').timeBased().everyHours(1).create();
  syncMirror_();
  Logger.log('Mirror ready: ' + sp.getUrl());
}

/** Hourly trigger: catches edits made directly in the database sheet. */
function syncMirrorTimer() { if (mirrorId_()) syncMirror_(); }

/** Settings / Books "Sync now" button. */
function syncMirrorNow() {
  var u = currentUser_();
  if (!u || (u.role !== 'admin' && u.role !== 'accountant')) throw new Error('Not allowed.');
  if (!mirrorId_()) throw new Error('The mirror has not been set up yet. Run setupMirror() in the script editor.');
  syncMirror_();
  return { ok: true, last: PropertiesService.getScriptProperties().getProperty('MIRROR_LAST') };
}

function rawTab_(name) {
  var sh = ss_().getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : [];
}

function writeTab_(sp, name, rows) {
  var sh = sp.getSheetByName(name) || sp.insertSheet(name);
  sh.clear();
  if (!rows.length) return;
  var cols = 1;
  rows.forEach(function (r) { if (r.length > cols) cols = r.length; });
  rows = rows.map(function (r) { var c = r.slice(); while (c.length < cols) c.push(''); return c; });
  sh.getRange(1, 1, rows.length, cols).setValues(rows);
  sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#15122A').setFontColor('#EEEAF4');
  sh.setFrozenRows(1);
  if (cols <= 24) sh.autoResizeColumns(1, cols);
}

function fyMonths_(settings) {
  var p = String(settings.fy_start || '2026-04-01').split('-'), y = Number(p[0]), m = Number(p[1]) - 1, out = [];
  for (var i = 0; i < 12; i++) {
    var yy = y + Math.floor((m + i) / 12), mm = (m + i) % 12;
    out.push(yy + '-' + ('0' + (mm + 1)).slice(-2));
  }
  return out;
}

function toNum_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function r2_(n) { return Math.round(n * 100) / 100; }
/** Amount received on an income entry: full amount if paid, else the part-payment column. */
function paidOf_(e) { return e.paid_status === 'paid' ? toNum_(e.amount) : toNum_(e.paid_amount); }

function projectTotals_(projects, entries) {
  var by = {};
  projects.forEach(function (p) { by[p.id] = { inv: 0, rec: 0, cost: 0 }; });
  entries.forEach(function (e) {
    var s = e.project && by[e.project] ? by[e.project] : null;
    if (!s) return;
    var a = toNum_(e.amount);
    if (e.kind === 'income') { s.inv += a; s.rec += paidOf_(e); }
    else if (e.kind === 'cost' && String(e.account) !== '1400') s.cost += a;
  });
  var rows = [['id', 'name', 'client', 'status', 'agreed_fee', 'invoiced', 'received', 'owed', 'costs', 'profit', 'margin']];
  projects.forEach(function (p) {
    var s = by[p.id], profit = s.inv - s.cost;
    rows.push([p.id, p.name, p.client, p.status, p.agreed_fee === '' ? '' : toNum_(p.agreed_fee),
      r2_(s.inv), r2_(s.rec), r2_(s.inv - s.rec), r2_(s.cost), r2_(profit), s.inv ? Math.round(profit / s.inv * 1000) / 1000 : '']);
  });
  return rows;
}

function booksGrid_(settings, accounts, entries) {
  var months = fyMonths_(settings), names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var sums = {};
  entries.forEach(function (e) {
    if (e.kind === 'income' || e.kind === 'cost') {
      var k = e.account + '|' + String(e.date).slice(0, 7);
      sums[k] = (sums[k] || 0) + toNum_(e.amount);
    }
  });
  var head = ['Account'].concat(months.map(function (m) { return names[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4); })).concat(['Total']);
  var rows = [head];
  function block(type, title) {
    rows.push([title]);
    var tot = months.map(function () { return 0; });
    accounts.filter(function (a) { return a.type === type; }).forEach(function (a) {
      var vals = months.map(function (m, i) { var v = r2_(sums[a.code + '|' + m] || 0); tot[i] += v; return v; });
      var t = vals.reduce(function (x, y) { return x + y; }, 0);
      if (!t) return;
      rows.push([a.code + ' ' + a.name].concat(vals).concat([r2_(t)]));
    });
    rows.push(['Total ' + title].concat(tot.map(r2_)).concat([r2_(tot.reduce(function (x, y) { return x + y; }, 0))]));
    return tot;
  }
  var inc = block('Revenue', 'Income'), exp = block('Expense', 'Expenses');
  var net = inc.map(function (v, i) { return r2_(v - exp[i]); });
  rows.push(['Net profit'].concat(net).concat([r2_(net.reduce(function (x, y) { return x + y; }, 0))]));
  return rows;
}

/** Rewrites every mirror tab from the database. Read-only copy for the accountant. */
function syncMirror_() {
  var id = mirrorId_();
  if (!id) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;           // another sync is running
  try {
    var sp = SpreadsheetApp.openById(id);
    var settings = {};
    read_('Settings').forEach(function (r) { settings[r.key] = r.value; });
    var entries = read_('Entries'), projects = read_('Projects'), accounts = read_('Accounts');
    var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');

    writeTab_(sp, 'Read me', [
      ['Offset Books - Accountant mirror'],
      ['Read-only copy of the Offset Books database. Refreshed every hour and within minutes of saves in the app. Approved entries only: items waiting for approval are not shown.'],
      ['Do not edit here: changes are overwritten at the next sync. Reclassify and adjust in Offset Books (accountant tools arrive in a later session).'],
      ['Last synced', now],
      ['Basis', 'Accrual: income on invoice date, costs on cost date. LKR.'],
      ['Tabs', 'Books (income and expenses by account and month) / Project totals / Entries / Invoices / Quotes / Clients / Crew / Accounts']
    ]);
    writeTab_(sp, 'Books', booksGrid_(settings, accounts, entries));
    writeTab_(sp, 'Project totals', projectTotals_(projects, entries));
    writeTab_(sp, 'Projects', rawTab_('Projects'));
    MIRROR_COPY_TABS.forEach(function (n) { writeTab_(sp, n, rawTab_(n)); });

    var order = ['Read me', 'Books', 'Project totals', 'Projects', 'Entries', 'Invoices', 'Quotes', 'Clients', 'Crew', 'Accounts'];
    order.forEach(function (n, i) { var sh = sp.getSheetByName(n); if (sh) { sp.setActiveSheet(sh); sp.moveActiveSheet(i + 1); } });
    var def = sp.getSheetByName('Sheet1');
    if (def && sp.getSheets().length > 1) sp.deleteSheet(def);
    sp.setActiveSheet(sp.getSheetByName('Books'));

    PropertiesService.getScriptProperties().setProperty('MIRROR_LAST', now);
    PropertiesService.getScriptProperties().setProperty('MIRROR_TS', String(new Date().getTime()));
  } finally { lock.releaseLock(); }
}

/* =====================  Session 3: quotes and invoices  ===================== */

var NEW_COLS_ = {
  Invoices: ['notes', 'label', 'paid_amount', 'payments', 'quote_no', 'to_email', 'subject'],
  Quotes: ['valid_until', 'notes', 'to_email', 'invoice_no', 'subject'],
  Entries: ['paid_amount', 'doc_number'],
  Projects: ['budget_url', 'budget_planned'],
  Approvals: ['id', 'source', 'submitted_by', 'submitted_at', 'kind', 'date', 'amount', 'payee', 'description', 'project', 'shoot', 'cost_type', 'account',
    'business_line', 'payment_method', 'paid_status', 'paid_date', 'paid_amount', 'doc_url', 'doc_status', 'doc_number', 'note', 'decided_by', 'decided_at', 'entry_id', 'reason',
    'confidence', 'rule', 'adjust_entry', 'adjust_amount'],
  Statements: ['id', 'month', 'from', 'to', 'file_url', 'opening', 'closing', 'lines', 'imported_by', 'imported_at'],
  BankLines: ['id', 'statement', 'date', 'ref', 'description', 'amount', 'balance', 'net', 'matched_entry', 'status', 'approval_id', 'note'],
  Rules: ['order', 'match', 'action', 'active', 'added'],
  AIUsage: ['time', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'purpose'],
  Months: ['month', 'status', 'by', 'at', 'note'],
  AccountantChanges: ['id', 'time', 'by', 'entry_id', 'action', 'old', 'new', 'reason', 'undone', 'undone_by', 'undone_at']
};
var S3_SETTINGS_ = [
  ['last_quote_number', 'QT-1206202639'],
  ['quote_valid_days', '14'],
  ['payment_terms_days', '14'],
  ['company_address', 'NO. 49D, ANANDABALIKA MAWATHA, PAGODA ROAD, NUGEGODA 10250, SRI LANKA'],
  ['company_phone', '+94 777 462 382'],
  ['company_email', 'contact@offset-media.com'],
  ['company_website', 'www.offset-media.com'],
  ['company_reg', '00362745'],
  ['invoice_notes', 'Looking forward for your business.'],
  ['quote_notes', ''],
  ['bank_details', ''],
  ['bank_account_name', 'OFFSET MEDIA (PVT) LTD'],
  ['bank_account_number', '027010422242'],
  ['bank_name', 'HATTON NATIONAL BANK PLC'],
  ['bank_branch', 'Nugegoda'],
  ['terms_file_id', ''],
  ['invoice_terms', 'Payment is due within 14 days of the invoice date. Overdue amounts may carry interest of 2% per month. Final deliverables are licensed for use on full and final payment.'],
  ['quote_terms', 'An advance is required before the scheduled production date unless agreed in writing. Up to 5 major revision rounds are included. Cancellation or rescheduling within 7 days of the shoot carries a fee of 50% of the production fee, and within 48 hours 100%. Final deliverables are licensed on full and final payment. Full Terms & Conditions of Service attached.'],
  ['logo_file_id', '1Tq5pBoS4HBh52HYIgl5-u6dVGvxHleij']
];

function settings_() { var s = {}; read_('Settings').forEach(function (r) { s[r.key] = r.value; }); return s; }

function setSetting_(key, val) {
  var sh = ss_().getSheetByName('Settings'), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === key) { sh.getRange(i + 1, 2).setNumberFormat('@').setValue(val); return; }
  var n = sh.getLastRow() + 1;
  sh.getRange(n, 1).setValue(key);
  sh.getRange(n, 2).setNumberFormat('@').setValue(val);
}

function ensureCols_(name, cols) {
  var sh = ss_().getSheetByName(name);
  if (!sh) {
    var first = name === 'Approvals' ? ['bank_line', 'suggestion', 'status'].concat(cols) : cols;
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, first.length).setValues([first]);
    sh.setFrozenRows(1);
    if (name === 'Months') sh.getRange('A:A').setNumberFormat('@');
    return;
  }
  var last = Math.max(1, sh.getLastColumn()), head = sh.getRange(1, 1, 1, last).getValues()[0];
  cols.forEach(function (c) {
    if (head.indexOf(c) < 0) { sh.getRange(1, head.length + 1).setValue(c); head.push(c); }
  });
}

function ensureSchema_() {
  Object.keys(NEW_COLS_).forEach(function (t) { ensureCols_(t, NEW_COLS_[t]); });
}

/** Run once from the editor as contact@. Adds columns and settings, and asks for Drive and email permission. */
function setupSession3() {
  ensureSchema_();
  var have = settings_();
  S3_SETTINGS_.forEach(function (kv) { if (have[kv[0]] === undefined || (kv[0] === 'logo_file_id' && !String(have[kv[0]]).trim())) setSetting_(kv[0], kv[1]); });
  // repair values Sheets mangled earlier (phone read as a formula, company ID lost its leading zeros)
  var cur = settings_();
  if (/^#|^$/.test(String(cur.company_phone || ''))) setSetting_('company_phone', '+94 777 462 382');
  var reg = String(cur.company_reg || '').replace(/^PV\s*/i, '');
  if (/^\d+$/.test(reg) && reg.length < 8) setSetting_('company_reg', ('00000000' + reg).slice(-8));
  if (!String(cur.bank_account_number || '').trim()) setSetting_('bank_account_number', '027010422242');
  Logger.log('Email quota left today: ' + MailApp.getRemainingDailyQuota());
  var st = settings_();
  Logger.log('Drive folder: ' + DriveApp.getFolderById(String(st.drive_root_id)).getName());
  if (!String(st.bank_account_number || '').trim() && !String(st.bank_details || '').trim()) Logger.log('Fill in the bank_ settings so invoices show how to pay.');
  Logger.log('Session 3 ready.');
}

function admin_() {
  var u = currentUser_();
  if (!u || u.role !== 'admin') throw new Error('Only the admin can do this.');
  return u;
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function addDays_(ymd, n) {
  var p = String(ymd).slice(0, 10).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}
function parseJson_(s, dflt) { try { var v = JSON.parse(s); return v == null ? dflt : v; } catch (e) { return dflt; } }

function logAudit_(u, rows) {
  if (!rows.length) return;
  var al = ss_().getSheetByName('AuditLog');
  al.getRange(al.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
}

/** Insert or patch one row. Returns the row as an object. Logs every changed field. */
function upsert_(u, tab, keyCol, obj, reason) {
  var sh = ss_().getSheetByName(tab), vals = sh.getDataRange().getValues(), head = vals[0], kc = head.indexOf(keyCol);
  var idx = -1, log = [], now = new Date(), out = {};
  for (var i = 1; i < vals.length; i++) if (String(vals[i][kc]) === String(obj[keyCol])) { idx = i; break; }
  if (idx < 0) {
    var nr = head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
    sh.appendRow(nr);
    head.forEach(function (h, c) { out[h] = cell_(nr[c]); });
    log.push([now, u.email, tab, obj[keyCol], '(new row)', '', JSON.stringify(obj), reason || '']);
  } else {
    var row = vals[idx].slice(), changed = false;
    head.forEach(function (h, c) {
      if (obj[h] === undefined || h === keyCol) return;
      var old = cell_(row[c]);
      if (String(old) !== String(obj[h])) { log.push([now, u.email, tab, obj[keyCol], h, old, obj[h], reason || '']); row[c] = obj[h]; changed = true; }
    });
    if (changed) sh.getRange(idx + 1, 1, 1, head.length).setValues([row]);
    head.forEach(function (h, c) { out[h] = cell_(row[c]); });
  }
  logAudit_(u, log);
  return out;
}

function findRow_(tab, keyCol, key) {
  var rows = read_(tab);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][keyCol]) === String(key)) return rows[i];
  return null;
}

function deleteRow_(u, tab, keyCol, key, reason) {
  var sh = ss_().getSheetByName(tab), vals = sh.getDataRange().getValues(), kc = vals[0].indexOf(keyCol);
  for (var i = 1; i < vals.length; i++) if (String(vals[i][kc]) === String(key)) {
    sh.deleteRow(i + 1);
    logAudit_(u, [[new Date(), u.email, tab, key, '(deleted)', JSON.stringify(vals[i]), '', reason || '']]);
    return true;
  }
  return false;
}

/** Next number in a series: keeps the prefix and width, adds one to the trailing digits. */
function nextNumber_(settingKey, dflt) {
  var st = settings_(), last = String(st[settingKey] || dflt), m = /^(.*?)(\d+)$/.exec(last);
  if (!m) throw new Error('Cannot read the last number in Settings (' + settingKey + ').');
  var n = String(Number(m[2]) + 1);
  while (n.length < m[2].length) n = '0' + n;
  var next = m[1] + n;
  setSetting_(settingKey, next);
  return next;
}

function normLines_(lines) {
  return (lines || []).map(function (l) {
    var q = (l.qty === '' || l.qty == null) ? null : toNum_(l.qty), r = (l.rate === '' || l.rate == null) ? null : toNum_(l.rate);
    var amt = (q != null && r != null) ? r2_(q * r) : r2_(toNum_(l.amount));
    return { desc: String(l.desc || '').trim(), detail: String(l.detail || '').trim(), qty: q, rate: r, amount: amt };
  }).filter(function (l) { return l.desc || l.amount; });
}
function sumLines_(lines) { return r2_(lines.reduce(function (t, l) { return t + l.amount; }, 0)); }
function dueOf_(inv) { return r2_(toNum_(inv.total) - toNum_(inv.advance_applied)); }
function paidInv_(inv) { return inv.status === 'paid' ? dueOf_(inv) : toNum_(inv.paid_amount); }

function ensureClient_(u, name) {
  if (!findRow_('Clients', 'name', name)) {
    var sh = ss_().getSheetByName('Clients'), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var o = { name: name, type: 'One-off' };
    sh.appendRow(head.map(function (h) { return o[h] === undefined ? '' : o[h]; }));
    logAudit_(u, [[new Date(), u.email, 'Clients', name, '(new row)', '', JSON.stringify(o), 'Created from a quote or invoice']]);
  }
}

function afterWrite_() {
  if (mirrorId_()) { try { syncMirror_(); } catch (e) { Logger.log('Mirror sync failed: ' + e); } }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- save / delete ---------- */

function saveInvoice(o) {
  var u = admin_(), out;
  withLock_(function () {
    ensureSchema_();
    var st = settings_(), ex = o.number ? findRow_('Invoices', 'number', o.number) : null;
    if (ex && ex.status !== 'draft') {
      var p = { number: ex.number, due: o.due || ex.due, notes: o.notes == null ? ex.notes : o.notes, to_email: o.to_email == null ? ex.to_email : o.to_email, subject: o.subject == null ? ex.subject : o.subject };
      out = { invoice: upsert_(u, 'Invoices', 'number', p, 'Edited after sending') };
      return;
    }
    var client = String(o.client || '').trim();
    if (!client) throw new Error('Choose a client.');
    var lines = normLines_(o.lines);
    if (!lines.length) throw new Error('Add at least one line.');
    var total = sumLines_(lines), adv = r2_(toNum_(o.advance_applied));
    if (total <= 0) throw new Error('The total must be more than zero.');
    if (adv < 0 || adv > total) throw new Error('The advance deducted cannot be more than the total.');
    ensureClient_(u, client);
    var date = o.date || today_(), terms = Number(st.payment_terms_days);
    var row = {
      number: ex ? ex.number : nextNumber_('last_invoice_number', 'INV-26052052'),
      client: client, project: o.project || '', date: date,
      due: o.due || addDays_(date, isFinite(terms) ? terms : 14),
      lines: JSON.stringify(lines), total: total, advance_applied: adv,
      status: 'draft', status_dates: ex ? ex.status_dates : '{}', pdf_url: ex ? ex.pdf_url : '', sent_at: '',
      notes: o.notes == null ? '' : o.notes, subject: String(o.subject || '').trim(), label: o.label || (adv > 0 ? 'Balance' : 'Full payment'),
      paid_amount: 0, payments: '[]', quote_no: o.quote_no || (ex ? ex.quote_no : ''), to_email: o.to_email || ''
    };
    out = { invoice: upsert_(u, 'Invoices', 'number', row, ex ? 'Draft edited' : 'Draft created') };
  });
  return out;
}

function saveQuote(o) {
  var u = admin_(), out;
  withLock_(function () {
    ensureSchema_();
    var st = settings_(), ex = o.number ? findRow_('Quotes', 'number', o.number) : null;
    if (ex && ex.status !== 'draft') throw new Error('Only a draft quote can be edited. Reopen it or make a new one.');
    var client = String(o.client || '').trim();
    if (!client) throw new Error('Choose a client.');
    var lines = normLines_(o.lines);
    if (!lines.length) throw new Error('Add at least one line.');
    var total = sumLines_(lines);
    if (total <= 0) throw new Error('The total must be more than zero.');
    ensureClient_(u, client);
    var date = o.date || today_(), vd = Number(st.quote_valid_days);
    var row = {
      number: ex ? ex.number : nextNumber_('last_quote_number', 'QT-1206202639'),
      client: client, project: o.project || '', date: date, lines: JSON.stringify(lines), total: total,
      status: 'draft', status_dates: ex ? ex.status_dates : '{}', pdf_url: ex ? ex.pdf_url : '', sent_at: '',
      valid_until: o.valid_until || addDays_(date, isFinite(vd) ? vd : 14), notes: o.notes == null ? '' : o.notes, subject: String(o.subject || '').trim(),
      to_email: o.to_email || '', invoice_no: ex ? ex.invoice_no : ''
    };
    out = { quote: upsert_(u, 'Quotes', 'number', row, ex ? 'Draft edited' : 'Draft created') };
  });
  return out;
}

function deleteDoc(type, number) {
  var u = admin_(), out = {};
  withLock_(function () {
    var tab = type === 'quote' ? 'Quotes' : 'Invoices', d = findRow_(tab, 'number', number);
    if (!d) throw new Error('Not found.');
    if (d.status !== 'draft') throw new Error('Only drafts can be deleted.');
    deleteRow_(u, tab, 'number', number, 'Draft deleted');
    if (type === 'invoice' && d.quote_no) {
      var q = findRow_('Quotes', 'number', d.quote_no);
      if (q && q.status === 'invoiced') out.quote = upsert_(u, 'Quotes', 'number', { number: q.number, status: 'approved', invoice_no: '' }, 'Draft invoice deleted');
    }
    out.deleted = number;
  });
  return out;
}

/* ---------- quote status ---------- */

function quoteAction(number, action) {
  var u = admin_(), out;
  withLock_(function () {
    var q = findRow_('Quotes', 'number', number);
    if (!q) throw new Error('Quote not found.');
    var sd = parseJson_(q.status_dates, {}), to;
    if (action === 'approve') {
      if (['draft', 'sent'].indexOf(q.status) < 0) throw new Error('Only a draft or sent quote can be approved.');
      to = 'approved'; sd.approved = today_();
    } else if (action === 'decline') {
      if (['sent', 'approved'].indexOf(q.status) < 0) throw new Error('This quote cannot be declined now.');
      to = 'declined'; sd.declined = today_();
    } else if (action === 'reopen') {
      if (q.status !== 'declined') throw new Error('Only a declined quote can be reopened.');
      to = 'draft'; delete sd.declined;
    } else throw new Error('Unknown action.');
    out = { quote: upsert_(u, 'Quotes', 'number', { number: number, status: to, status_dates: JSON.stringify(sd) }, 'Quote ' + action) };
  });
  return out;
}

function convertQuote(number) {
  var u = admin_(), out;
  withLock_(function () {
    ensureSchema_();
    var q = findRow_('Quotes', 'number', number), st = settings_();
    if (!q) throw new Error('Quote not found.');
    if (q.status !== 'approved') throw new Error('Approve the quote first.');
    var date = today_(), terms = Number(st.payment_terms_days);
    var inv = upsert_(u, 'Invoices', 'number', {
      number: nextNumber_('last_invoice_number', 'INV-26052052'), client: q.client, project: q.project, date: date,
      due: addDays_(date, isFinite(terms) ? terms : 14), lines: q.lines, total: q.total, advance_applied: 0,
      status: 'draft', status_dates: '{}', pdf_url: '', sent_at: '', notes: q.notes || '', subject: q.subject || '', label: 'Full payment',
      paid_amount: 0, payments: '[]', quote_no: q.number, to_email: q.to_email || ''
    }, 'Created from ' + q.number);
    var sd = parseJson_(q.status_dates, {}); sd.invoiced = date;
    var nq = upsert_(u, 'Quotes', 'number', { number: q.number, status: 'invoiced', invoice_no: inv.number, status_dates: JSON.stringify(sd) }, 'Converted to ' + inv.number);
    out = { invoice: inv, quote: nq };
  });
  return out;
}

/* =====================  Session 4: entries, approval queue, Drive filing  ===================== */

var COST_MAP_FALLBACK_ = {
  'Equipment rental': ['5010', '6050'], 'Crew / freelancer': ['5020', '6020'], 'Transport': ['5040', '6060'], 'Food': ['5050', '6060'],
  'Location & venue': ['5030', '6050'], 'Other': ['5060', '6050'], 'Staff & salaries': ['5020', '6010']
};
var DOC_STATUSES_ = ['invoice', 'receipt', 'quote only', 'bank line only', 'none', ''];
var PAID_STATUSES_ = ['paid', 'unpaid', 'part'];

/** Books account for a cost type: 50xx when it belongs to a project, 60xx as company overhead (CostTypeMap tab, with a built-in fallback). */
function accountFor_(kind, costType, project, businessLine) {
  if (kind === 'income') return project ? '4010' : (businessLine === 'AI data' ? '4020' : '4090');
  var map = ref_('CostTypeMap'), pair = null;
  for (var i = 0; i < map.length; i++) {
    if (String(map[i].cost_type) === String(costType) && (String(map[i].project_account) || String(map[i].overhead_account))) {
      pair = [String(map[i].project_account), String(map[i].overhead_account)];
    }
  }
  if (!pair) pair = COST_MAP_FALLBACK_[costType] || ['5060', '6050'];
  var code = project ? pair[0] : pair[1];
  return code || (project ? '5060' : '6050');
}

/** Checks and tidies the fields of a cost or income entry coming from the screen. Throws a plain-English error. */
var REF_CACHE_ = {};
/** Reference tabs read once per script run (Accounts, CostTypeMap, Projects change rarely). */
function ref_(name) { if (!REF_CACHE_[name]) REF_CACHE_[name] = read_(name); return REF_CACHE_[name]; }

function normEntry_(o) {
  var kind = o.kind === 'income' ? 'income' : 'cost';
  var date = String(o.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid date.');
  var amount = r2_(toNum_(String(o.amount == null ? '' : o.amount).replace(/,/g, '')));
  if (!(amount > 0)) throw new Error('The amount must be more than zero.');
  var payee = String(o.payee || '').trim();
  if (!payee) throw new Error(kind === 'income' ? 'Enter who paid.' : 'Enter who was paid.');
  var project = String(o.project || '').trim(), proj = null;
  if (project) { proj = (ref_('Projects').filter(function (p) { return String(p.id) === project; })[0] || null); if (!proj) throw new Error('That project was not found.'); }
  var costType = String(o.cost_type || '').trim();
  if (kind === 'cost' && !costType) throw new Error('Choose a cost type.');
  if (kind === 'income' && !costType) costType = project ? 'Full payment' : 'Other income';
  var line = (o.business_line === 'AI data' || o.business_line === 'Production') ? o.business_line : ((proj && proj.business_line) || 'Production');
  var account = String(o.account || '').trim();
  if (account) {
    var ok = ref_('Accounts').some(function (a) { return String(a.code) === account; });
    if (!ok) throw new Error('That books account does not exist.');
  } else account = accountFor_(kind, costType, project, line);
  var ps = PAID_STATUSES_.indexOf(o.paid_status) >= 0 ? o.paid_status : 'unpaid', pa = 0, pd = '';
  if (ps === 'paid') { pa = amount; pd = String(o.paid_date || '').slice(0, 10) || date; }
  else if (ps === 'part') {
    pa = r2_(toNum_(String(o.paid_amount == null ? '' : o.paid_amount).replace(/,/g, '')));
    if (!(pa > 0 && pa < amount)) throw new Error('For a part payment, enter an amount paid that is less than the total.');
  }
  var ds = String(o.doc_status == null ? '' : o.doc_status).toLowerCase();
  if (DOC_STATUSES_.indexOf(ds) < 0) ds = kind === 'cost' ? 'none' : '';
  return {
    date: date, kind: kind, account: account, amount: amount, business_line: line, project: project, shoot: project ? String(o.shoot || '').trim() : '',
    cost_type: costType, payee: payee, description: String(o.description || '').trim(),
    payment_method: ps === 'unpaid' ? '' : String(o.payment_method || '').trim(), paid_status: ps, paid_date: pd, paid_amount: pa,
    doc_status: ds, doc_number: String(o.doc_number || '').trim(), notes: String(o.notes || '').trim()
  };
}

/** True for income lines created from an invoice in the Invoices tab: those are changed from the invoice page, not here. */
function isInvoiceEntry_(e) {
  if (e.kind !== 'income') return false;
  var m = /(NOINV-[\w-]+|INV-\d+)/.exec(String(e.description || ''));
  return !!(m && findRow_('Invoices', 'number', m[1]));
}

/* ---------- Drive filing with standard names ---------- */

function safeName_(s, max) {
  var t = String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (t || 'Unknown').slice(0, max || 28).replace(/-+$/, '');
}
function extOf_(name, mime) {
  var m = /\.([A-Za-z0-9]{2,5})$/.exec(String(name || ''));
  if (m) return m[1].toLowerCase();
  if (/pdf/.test(mime)) return 'pdf';
  if (/png/.test(mime)) return 'png';
  if (/webp/.test(mime)) return 'webp';
  return 'jpg';
}
/** YYYY-MM-DD_Supplier_DocNumber_Amount.ext (the document number is left out when there is none). */
function stdName_(e, ext) {
  var parts = [String(e.date).slice(0, 10), safeName_(e.payee)], dn = String(e.doc_number || '').trim();
  if (dn) parts.push(safeName_(dn, 30));
  parts.push(String(Math.round(toNum_(e.amount))));
  return parts.join('_') + '.' + ext;
}
function entryFolder_(st, e) {
  var root = DriveApp.getFolderById(String(st.drive_root_id)), fy = ensureFolder_(root, fyFolderName_(st));
  if (e.kind === 'income') return ensureFolder_(fy, 'Income receipts');
  function bills(a, b) { var f = ensureFolder_(ensureFolder_(fy, 'Bills in'), a); return b ? ensureFolder_(f, b) : f; }
  var t = String(e.cost_type);
  if (t === 'Equipment rental') return bills('Rentals', e.payee);
  if (t === 'Crew / freelancer' || t === 'Staff & salaries') return bills('Crew', e.payee);
  if (t === 'Location & venue') return bills('Studios');
  if (t === 'Transport' || t === 'Food') return ensureFolder_(fy, 'Receipts and transport');
  if (t === 'Other' && e.project) return bills('Props');
  return bills('Other');
}
function inboxFolder_(st) { return ensureFolder_(DriveApp.getFolderById(String(st.drive_root_id)), 'Inbox'); }

/** file = { name, mime, b64 } sent from the browser (photos are already shrunk there). */
function uploadBlob_(file) {
  if (!file || !file.b64) return null;
  var mime = String(file.mime || '');
  if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(mime)) throw new Error('Attach a PDF, JPG or PNG file.');
  if (String(file.b64).length > 16000000) throw new Error('That file is too large (limit about 12 MB).');
  return Utilities.newBlob(Utilities.base64Decode(file.b64), mime, String(file.name || 'document'));
}
function trashDoc_(url) {
  var id = fileIdFromUrl_(url);
  if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ } }
}
/** Saves a new upload in its standard folder under its standard name. Returns the file URL. */
function fileEntryDoc_(st, e, blob) {
  var ext = extOf_(blob.getName(), blob.getContentType());
  return entryFolder_(st, e).createFile(blob.setName(stdName_(e, ext))).getUrl();
}
/** Moves an existing file (for example from the Inbox) to its standard folder and name. Returns the URL. */
function refileDoc_(st, e, url) {
  var id = fileIdFromUrl_(url);
  if (!id) return url;
  try {
    var f = DriveApp.getFileById(id);
    f.moveTo(entryFolder_(st, e));
    f.setName(stdName_(e, extOf_(f.getName(), f.getMimeType())));
    return f.getUrl();
  } catch (err) { Logger.log('Could not re-file the document: ' + err); return url; }
}
function needsDoc_(e, url) {
  if (e.kind === 'cost' && (e.doc_status === 'invoice' || e.doc_status === 'receipt') && !url) {
    throw new Error('Attach the document, or choose "No document yet" or "Bank line only".');
  }
}

/** Light mirror refresh: skips the sync when one ran in the last 5 minutes (the hourly timer catches up). */
function afterWriteSoon_() {
  if (!mirrorId_()) return;
  var last = Number(PropertiesService.getScriptProperties().getProperty('MIRROR_TS') || 0);
  if (new Date().getTime() - last < 5 * 60 * 1000) return;
  afterWrite_();
}

/** Run once from the editor as contact@. Adds the new columns and creates the Drive folder tree. */
function setupSession4() {
  ensureSchema_();
  var st = settings_(), root = DriveApp.getFolderById(String(st.drive_root_id)), fy = ensureFolder_(root, fyFolderName_(st));
  ensureFolder_(root, 'Inbox');
  ['Invoices out', 'Quotes', 'Bills in', 'Receipts and transport', 'Bank statements', 'Income receipts'].forEach(function (n) { ensureFolder_(fy, n); });
  var bills = ensureFolder_(fy, 'Bills in');
  ['Rentals', 'Crew', 'Studios', 'Props', 'Other'].forEach(function (n) { ensureFolder_(bills, n); });
  Logger.log('Drive folders ready under ' + root.getName() + ' / ' + fyFolderName_(st) + '. Session 4 ready.');
}

/* ---------- add, edit, delete an entry (admin) ---------- */

function saveEntry(o, file) {
  var u = admin_(), out = {};
  withLock_(function () {
    ensureSchema_();
    var st = settings_(), ex = o.id ? findRow_('Entries', 'id', o.id) : null;
    if (o.id && !ex) throw new Error('Entry not found.');
    if (ex && isInvoiceEntry_(ex)) throw new Error('This entry comes from an invoice. Change it from the invoice page.');
    var e = normEntry_(o), oldUrl = ex ? String(ex.doc_url || '') : '', url = oldUrl, blob = uploadBlob_(file);
    assertOpen_(e.date); if (ex) assertOpen_(ex.date);
    if (blob) {
      url = fileEntryDoc_(st, e, blob);
      if (oldUrl && oldUrl !== url) trashDoc_(oldUrl);
    } else if (ex && oldUrl) {
      var moved = ['date', 'payee', 'amount', 'cost_type', 'doc_number'].some(function (k) { return String(ex[k]) !== String(e[k]); });
      if (moved) url = refileDoc_(st, e, oldUrl);
    }
    needsDoc_(e, url);
    if (e.kind === 'income') e.doc_status = url ? 'receipt' : '';
    e.doc_url = url;
    if (ex) e.id = ex.id;
    else { e.id = nextEntryId_(read_('Entries')); e.created_by = u.email; e.created_at = now_(); e.bank_line_id = ''; }
    out.entry = upsert_(u, 'Entries', 'id', e, ex ? 'Entry edited' : 'Entry added');
  });
  afterWriteSoon_();
  return out;
}

/** Removes an entry. Its document stays in Drive. */
function deleteEntry(id) {
  var u = admin_(), out = {};
  withLock_(function () {
    var ex = findRow_('Entries', 'id', id);
    if (!ex) throw new Error('Entry not found.');
    if (isInvoiceEntry_(ex)) throw new Error('This entry belongs to an invoice. Delete or change it from the invoice page.');
    assertOpen_(ex.date);
    deleteRow_(u, 'Entries', 'id', id, 'Entry deleted');
    out.removedEntry = id;
  });
  afterWriteSoon_();
  return out;
}

/* ---------- Session 3 continues: PDF ---------- */

function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function money_(n) { return toNum_(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function dlong_(s) {
  var p = String(s || '').slice(0, 10).split('-'), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return p.length < 3 ? '' : (+p[2]) + ' ' + M[+p[1] - 1] + ' ' + p[0];
}
function nl2br_(s) { return esc_(s).replace(/\r?\n/g, '<br>'); }

/* Borders-and-text-only layout: Apps Script's PDF converter ignores background colours. */
function logoImg_(st, h) {
  var id = String(st.logo_file_id || '').trim();
  if (!id) return '';
  try {
    var cache = CacheService.getScriptCache(), key = 'logo_' + id, uri = cache.get(key);
    if (!uri) {
      var b = DriveApp.getFileById(id).getBlob();
      uri = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
      if (uri.length < 95000) cache.put(key, uri, 21600);
    }
    return '<img src="' + uri + '" height="' + h + '" style="height:' + h + 'px">';
  } catch (e) { return ''; }
}

function companyId_(st) {
  var r = String(st.company_reg || '').replace(/^PV\s*/i, '').trim();
  if (/^\d+$/.test(r)) while (r.length < 8) r = '0' + r;
  return r ? 'PV ' + r : '';
}

function bankLines_(st) {
  var rows = [['Account name', st.bank_account_name], ['Account number', st.bank_account_number], ['Bank', st.bank_name], ['Branch', st.bank_branch]]
    .filter(function (r) { return String(r[1] || '').trim(); });
  if (!rows.length && String(st.bank_details || '').trim()) return null;
  return rows;
}

function docHtml_(type, d, client, st, projectName) {
  var isInv = type === 'invoice', lines = parseJson_(d.lines, []);
  var COBALT = '#2B4BFF', MAG = '#FF2E8A', TEAL = '#12A3A3', INK = '#15122A', GREY = '#6B6683', RULE = '#DAD6E8';
  var FONT = 'Arial,Helvetica,sans-serif';
  var logo = logoImg_(st, 54);
  if (!logo) logo = '<span style="font-size:30px;font-weight:bold;color:' + COBALT + ';letter-spacing:2px">OFFSET</span> <span style="font-size:9px;color:' + TEAL + ';letter-spacing:3px;font-weight:bold">MEDIA</span>';
  var total = toNum_(d.total), adv = isInv ? toNum_(d.advance_applied) : 0, due = isInv ? dueOf_(d) : total, paid = isInv ? paidInv_(d) : 0;
  var isPaid = isInv && d.status === 'paid', balance = r2_(due - paid);
  function lab(t, color) { return '<div style="font-size:8px;letter-spacing:2px;font-weight:bold;color:' + (color || TEAL) + '">' + t + '</div>'; }

  // header
  var mark = '';
  if (isPaid) mark = '<div style="margin-top:6px"><span style="font-size:10px;font-weight:bold;letter-spacing:3px;color:' + TEAL + ';border:1.5px solid ' + TEAL + ';padding:2px 10px">PAID</span></div>';
  else if (d.status === 'draft') mark = '<div style="margin-top:6px"><span style="font-size:10px;font-weight:bold;letter-spacing:3px;color:' + MAG + ';border:1.5px solid ' + MAG + ';padding:2px 10px">DRAFT</span></div>';
  var head = '<table width="100%" cellspacing="0" cellpadding="0"><tr>' +
    '<td valign="middle" width="50%">' + logo + '</td>' +
    '<td valign="middle" align="right" width="50%"><div style="font-size:26px;letter-spacing:8px;color:' + INK + ';font-weight:bold">' + (isInv ? 'INVOICE' : 'QUOTATION') + '</div>' + mark + '</td></tr></table>';

  // meta strip
  function cell(k, v, w, strong) {
    return '<td width="' + w + '%" valign="top" style="padding:10px 0 10px 0;border-top:2px solid ' + INK + ';border-bottom:1px solid ' + RULE + '">' + lab(k) +
      '<div style="font-size:' + (strong ? 15 : 12) + 'px;font-weight:bold;color:' + (strong ? COBALT : INK) + ';margin-top:4px">' + v + '</div></td>';
  }
  var meta = '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr>' +
    cell(isInv ? 'INVOICE NO' : 'QUOTE NO', esc_(d.number), 25) +
    cell('DATE', esc_(dlong_(d.date)), 22) +
    cell(isInv ? 'DUE DATE' : 'VALID UNTIL', esc_(dlong_(isInv ? d.due : d.valid_until)), 22) +
    cell(isInv ? (isPaid ? 'AMOUNT PAID' : (paid > 0 ? 'BALANCE DUE' : 'AMOUNT DUE')) : 'TOTAL', 'LKR ' + money_(isPaid ? due : (isInv ? balance : total)), 31, true) +
    '</tr></table>';

  // from / to
  var fromBlock = '<div style="font-size:12px;font-weight:bold;color:' + INK + ';margin-top:4px">' + esc_(st.company_name || 'Offset Media (Pvt) Ltd') + '</div>' +
    '<div style="font-size:10px;color:' + GREY + ';line-height:1.6;margin-top:2px">' + esc_(st.company_address) + '<br>' + esc_(st.company_phone) + (st.company_email ? ' &nbsp;|&nbsp; ' + esc_(st.company_email) : '') + (companyId_(st) ? '<br>Company ID : ' + esc_(companyId_(st)) : '') + '</div>';
  var cl = client || {};
  var toLines = [cl.contact, cl.address, cl.phone, cl.email].filter(function (x) { return String(x || '').trim(); }).map(esc_).join('<br>');
  var toBlock = '<div style="font-size:12px;font-weight:bold;color:' + INK + ';margin-top:4px">' + esc_(d.client) + '</div>' +
    (toLines ? '<div style="font-size:10px;color:' + GREY + ';line-height:1.6;margin-top:2px">' + toLines + '</div>' : '') +
    (projectName ? '<div style="font-size:10px;color:' + GREY + ';margin-top:4px">Project: <b style="color:' + INK + '">' + esc_(projectName) + '</b></div>' : '');
  var parties = '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr>' +
    '<td width="50%" valign="top" style="padding-right:20px">' + lab('FROM') + fromBlock + '</td>' +
    '<td width="50%" valign="top">' + lab(isInv ? 'BILLED TO' : 'PREPARED FOR') + toBlock + '</td></tr></table>';

  var subject = String(d.subject || '').trim();
  var subj = subject ? '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr><td style="border-left:3px solid ' + MAG + ';padding:2px 0 2px 10px">' + lab('SUBJECT', MAG) + '<div style="font-size:13px;font-weight:bold;color:' + INK + ';margin-top:3px">' + esc_(subject) + '</div></td></tr></table>' : '';

  // items
  var th = 'font-size:8px;letter-spacing:2px;font-weight:bold;color:' + GREY + ';padding:8px 6px;border-bottom:2px solid ' + INK;
  var rows = lines.map(function (l, i) {
    var hasQR = l.qty != null && l.rate != null && l.qty !== '' && l.rate !== '';
    var td = 'padding:10px 6px;border-bottom:1px solid ' + RULE + ';font-size:11px;color:' + INK;
    return '<tr><td valign="top" style="' + td + ';color:' + GREY + '">' + (i + 1) + '</td>' +
      '<td valign="top" style="' + td + '"><b>' + esc_(l.desc) + '</b>' + (l.detail ? '<div style="font-size:9.5px;color:' + GREY + ';line-height:1.5;margin-top:3px">' + nl2br_(l.detail) + '</div>' : '') + '</td>' +
      '<td valign="top" align="right" style="' + td + '">' + (hasQR ? esc_(l.qty) : '') + '</td>' +
      '<td valign="top" align="right" style="' + td + '">' + (hasQR ? money_(l.rate) : '') + '</td>' +
      '<td valign="top" align="right" style="' + td + ';font-weight:bold">' + money_(l.amount) + '</td></tr>';
  }).join('');
  var items = '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px"><tr>' +
    '<td width="5%" style="' + th + '">#</td><td style="' + th + '">ITEM &amp; DESCRIPTION</td>' +
    '<td width="9%" align="right" style="' + th + '">QTY</td><td width="17%" align="right" style="' + th + '">RATE</td><td width="19%" align="right" style="' + th + '">AMOUNT</td></tr>' + rows + '</table>';

  // totals
  function trow(k, v, big) {
    var s = 'padding:5px 6px;font-size:' + (big ? 13 : 11) + 'px;' + (big ? 'font-weight:bold;color:' + INK : 'color:' + GREY);
    return '<tr><td style="' + s + '">' + k + '</td><td align="right" style="' + s + ';' + (big ? '' : 'color:' + INK) + '">' + v + '</td></tr>';
  }
  var tot = '';
  if (isInv && (adv > 0 || paid > 0)) tot += trow('Sub total', 'LKR ' + money_(total));
  if (adv > 0) tot += trow('Less: advance already invoiced', '- LKR ' + money_(adv));
  tot += '<tr><td colspan="2" style="border-top:2px solid ' + MAG + ';font-size:1px;line-height:1px">&nbsp;</td></tr>';
  tot += trow(isInv ? 'Total due' : 'Total', 'LKR ' + money_(due), true);
  if (isInv && paid > 0) tot += trow('Paid', '- LKR ' + money_(paid)) + (isPaid ? '' : trow('Balance due', 'LKR ' + money_(balance), true));
  var totals = '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px"><tr><td width="50%">&nbsp;</td><td width="50%"><table width="100%" cellspacing="0" cellpadding="0">' + tot + '</table></td></tr></table>';

  // payment + notes
  var bank = bankLines_(st), bankHtml = '';
  if (bank === null) bankHtml = '<div style="font-size:10.5px;line-height:1.6;color:' + INK + '">' + nl2br_(st.bank_details) + '</div>';
  else if (bank.length) bankHtml = '<table cellspacing="0" cellpadding="0">' + bank.map(function (r) {
    return '<tr><td style="font-size:9.5px;color:' + GREY + ';padding:2px 14px 2px 0">' + r[0] + '</td><td style="font-size:10.5px;font-weight:bold;color:' + INK + ';padding:2px 0">' + esc_(r[1]) + '</td></tr>';
  }).join('') + '</table>';
  var notes = String(d.notes || '').trim() || String(isInv ? st.invoice_notes : st.quote_notes || '').trim();
  var leftCol = (isInv && bankHtml) ? lab('PAYMENT DETAILS') + '<div style="margin-top:5px">' + bankHtml + '</div>' +
      '<div style="font-size:9px;color:' + GREY + ';margin-top:6px">Please use ' + esc_(d.number) + ' as the payment reference.</div>' : '';
  var rightCol = notes ? lab('NOTES') + '<div style="font-size:10px;color:' + GREY + ';line-height:1.6;margin-top:5px">' + nl2br_(notes) + '</div>' : '';
  var lower = (leftCol || rightCol) ? '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px"><tr>' +
    '<td width="50%" valign="top" style="padding-right:20px;border-top:1px solid ' + RULE + ';padding-top:12px">' + leftCol + '</td>' +
    '<td width="50%" valign="top" style="border-top:1px solid ' + RULE + ';padding-top:12px">' + rightCol + '</td></tr></table>' : '';

  // quote acceptance
  var accept = '';
  if (!isInv) {
    var sl = 'border-bottom:1px solid ' + INK + ';height:28px;font-size:1px';
    accept = '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px"><tr><td colspan="5">' + lab('ACCEPTANCE') +
      '<div style="font-size:9.5px;color:' + GREY + ';margin:4px 0 6px 0">By signing, the client accepts this quotation and the attached Terms &amp; Conditions of Service.</div></td></tr>' +
      '<tr><td width="38%" style="' + sl + '">&nbsp;</td><td width="3%">&nbsp;</td><td width="30%" style="' + sl + '">&nbsp;</td><td width="3%">&nbsp;</td><td width="26%" style="' + sl + '">&nbsp;</td></tr>' +
      '<tr><td style="font-size:8px;letter-spacing:1.5px;color:' + GREY + ';padding-top:3px">NAME &amp; DESIGNATION</td><td>&nbsp;</td><td style="font-size:8px;letter-spacing:1.5px;color:' + GREY + ';padding-top:3px">SIGNATURE</td><td>&nbsp;</td><td style="font-size:8px;letter-spacing:1.5px;color:' + GREY + ';padding-top:3px">DATE</td></tr></table>';
  }

  var terms = String(isInv ? st.invoice_terms : st.quote_terms || '').trim();
  var termsHtml = terms ? '<div style="margin-top:20px">' + lab('TERMS IN BRIEF') + '<div style="font-size:8.5px;color:' + GREY + ';line-height:1.6;margin-top:4px">' + nl2br_(terms) + '</div></div>' : '';

  var footer = [st.company_name, st.company_website, st.company_email].filter(function (x) { return String(x || '').trim(); }).map(esc_).join(' &nbsp;&middot;&nbsp; ');
  var foot = '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px"><tr><td align="center" style="border-top:1px solid ' + RULE + ';padding-top:8px;font-size:8.5px;letter-spacing:1px;color:' + GREY + '">' + footer + '</td></tr></table>';

  return '<html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;font-family:' + FONT + ';color:' + INK + '">' +
    head + meta + parties + subj + items + totals + lower + accept + termsHtml + foot + '</body></html>';
}

/** HTML of a document for the on-screen preview. numberOrDraft: a number, or {type fields} for an unsaved draft. */
function renderDoc(type, src) {
  var u = currentUser_();
  if (!u) throw new Error('Not signed in.');
  var st = settings_(), tab = type === 'quote' ? 'Quotes' : 'Invoices', d;
  if (src && typeof src === 'object') {
    var lines = normLines_(src.lines), date = src.date || today_(), terms = Number(st.payment_terms_days), vd = Number(st.quote_valid_days);
    d = {
      number: src.number || (type === 'quote' ? 'QT-DRAFT' : 'INV-DRAFT'), client: src.client || '', project: src.project || '', date: date,
      due: src.due || addDays_(date, isFinite(terms) ? terms : 14), valid_until: src.valid_until || addDays_(date, isFinite(vd) ? vd : 14),
      lines: JSON.stringify(lines), total: sumLines_(lines), advance_applied: r2_(toNum_(src.advance_applied)), status: 'draft',
      notes: src.notes || '', subject: src.subject || '', paid_amount: 0, quote_no: src.quote_no || ''
    };
  } else {
    d = findRow_(tab, 'number', src);
    if (!d) throw new Error('Not found.');
  }
  var client = findRow_('Clients', 'name', d.client) || { name: d.client };
  var proj = d.project ? findRow_('Projects', 'id', d.project) : null;
  return { html: docHtml_(type, d, client, st, proj ? proj.name : '') };
}

function ensureFolder_(parent, name) {
  var clean = String(name || 'Unnamed').replace(/[\\\/]/g, '-').trim() || 'Unnamed', it = parent.getFoldersByName(clean);
  return it.hasNext() ? it.next() : parent.createFolder(clean);
}
function fyFolderName_(st) {
  var s = String(st.fy_start || '2026-04-01').slice(0, 4), e = Number(s) + 1;
  return 'FY ' + s + '-' + String(e).slice(2);
}
function fileIdFromUrl_(url) { var m = /[-\w]{25,}/.exec(String(url || '')); return m ? m[0] : ''; }

/** Builds the PDF, files it in Drive (replacing the previous copy) and returns {url, blob}. */
function makePdf_(type, d) {
  var st = settings_(), isInv = type === 'invoice';
  var client = findRow_('Clients', 'name', d.client) || { name: d.client };
  var proj = d.project ? findRow_('Projects', 'id', d.project) : null;
  var html = docHtml_(type, d, client, st, proj ? proj.name : '');
  var amt = Math.round(isInv ? dueOf_(d) : toNum_(d.total));
  var name = String(d.date).slice(0, 10) + '_OffsetMedia_' + d.number + '_' + amt + '.pdf';
  var blob = Utilities.newBlob(html, 'text/html', 'doc.html').getAs('application/pdf').setName(name);
  var root = DriveApp.getFolderById(String(st.drive_root_id));
  var folder = ensureFolder_(ensureFolder_(ensureFolder_(root, fyFolderName_(st)), isInv ? 'Invoices out' : 'Quotes'), d.client);
  var oldId = fileIdFromUrl_(d.pdf_url);
  if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* already gone */ } }
  var file = folder.createFile(blob);
  return { url: file.getUrl(), blob: blob };
}

function previewPdf(type, number) {
  var u = admin_(), out;
  withLock_(function () {
    var tab = type === 'quote' ? 'Quotes' : 'Invoices', d = findRow_(tab, 'number', number);
    if (!d) throw new Error('Not found.');
    var r = makePdf_(type, d);
    out = { url: r.url };
    out[type === 'quote' ? 'quote' : 'invoice'] = upsert_(u, tab, 'number', { number: number, pdf_url: r.url }, 'PDF generated');
  });
  return out;
}

/* ---------- income entries for invoices ---------- */

function nextEntryId_(entries) {
  var max = 0;
  entries.forEach(function (e) { var n = Number(String(e.id).replace(/\D/g, '')); if (n > max) max = n; });
  var s = String(max + 1); while (s.length < 4) s = '0' + s;
  return 'E' + s;
}
function invEntries_(number) {
  return read_('Entries').filter(function (e) {
    if (e.kind !== 'income') return false;
    var m = /(NOINV-[\w-]+|INV-\d+)/.exec(String(e.description || ''));
    return m && m[1] === number;
  });
}
function createIncomeEntry_(u, inv, pdfUrl) {
  var amount = dueOf_(inv);
  if (amount <= 0) return null;
  if (invEntries_(inv.number).length) return null;
  var label = inv.label || 'Full payment', entries = read_('Entries');
  return upsert_(u, 'Entries', 'id', {
    id: nextEntryId_(entries), date: inv.date, kind: 'income', account: inv.project ? '4010' : '4090', amount: amount,
    business_line: 'Production', project: inv.project || '', shoot: '', cost_type: label, payee: inv.client,
    description: inv.number + ' (' + label + ')', payment_method: '', paid_status: 'unpaid', paid_date: '', paid_amount: 0,
    doc_url: pdfUrl || '', doc_status: 'invoice', bank_line_id: '', created_by: u.email, created_at: now_(), notes: ''
  }, 'Income from ' + inv.number);
}
/** Spreads the total paid on an invoice over its income entries, in order. */
function allocatePaid_(u, inv, paidTotal, lastDate, method) {
  var ents = invEntries_(inv.number).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)); });
  var rem = paidTotal, out = [];
  ents.forEach(function (e) {
    var amt = toNum_(e.amount), p = Math.max(0, Math.min(amt, rem)); rem = r2_(rem - p);
    var full = p >= amt - 0.005;
    out.push(upsert_(u, 'Entries', 'id', {
      id: e.id, paid_amount: r2_(p), paid_status: full ? 'paid' : (p > 0 ? 'part' : 'unpaid'),
      paid_date: full ? (lastDate || today_()) : '', payment_method: p > 0 ? (method || e.payment_method) : e.payment_method
    }, 'Payment on ' + inv.number));
  });
  return out;
}

/* ---------- approval queue ---------- */

function nextApprovalId_(rows) {
  var max = 0;
  rows.forEach(function (a) { var n = Number(String(a.id).replace(/\D/g, '')); if (n > max) max = n; });
  var s = String(max + 1); while (s.length < 4) s = '0' + s;
  return 'A' + s;
}

/**
 * Admin: posts the entry straight away. Viewer: the cost waits in the Approvals tab (document goes to the Inbox
 * folder) until the admin approves it. Nothing a viewer or the AI sorts reaches the books without approval.
 */
function submitItem(o, file) {
  var u = currentUser_();
  if (!u || (u.role !== 'admin' && u.role !== 'viewer')) throw new Error('Not allowed.');
  if (u.role === 'admin') return saveEntry(o, file);
  var out = {};
  withLock_(function () {
    ensureSchema_();
    var st = settings_(), e = normEntry_(o);
    if (e.kind !== 'cost') throw new Error('Only costs can be submitted. Ask Joshua to add income.');
    var blob = uploadBlob_(file), url = '';
    if (blob) {
      try { url = inboxFolder_(st).createFile(blob.setName(stdName_(e, extOf_(blob.getName(), blob.getContentType())))).getUrl(); }
      catch (err) { throw new Error('The document could not be saved to Drive. Ask Joshua to check your access to the Offset Books folder.'); }
    }
    needsDoc_(e, url);
    var row = {
      id: nextApprovalId_(read_('Approvals')), status: 'pending', source: 'manual', submitted_by: u.email, submitted_at: now_(),
      kind: e.kind, date: e.date, amount: e.amount, payee: e.payee, description: e.description, project: e.project, shoot: e.shoot,
      cost_type: e.cost_type, account: e.account, business_line: e.business_line, payment_method: e.payment_method, paid_status: e.paid_status,
      paid_date: e.paid_date, paid_amount: e.paid_amount, doc_url: url, doc_status: e.doc_status, doc_number: e.doc_number, note: e.notes
    };
    out.approval = upsert_(u, 'Approvals', 'id', row, 'Submitted for approval');
  });
  return out;
}

/** Admin approves a queued item (optionally corrected on screen): it becomes an entry and its document is filed. */
function approveItem(id, o, file) {
  var u = admin_(), out = {}, a0 = findRow_('Approvals', 'id', id);
  if (!a0) throw new Error('Item not found.');
  if (a0.status !== 'pending') throw new Error('This item has already been decided.');
  if (a0.kind === 'payment') return approvePayment_(u, a0);
  if (a0.kind === 'adjust') return approveAdjust_(u, a0);
  withLock_(function () {
    ensureSchema_();
    var st = settings_(), a = findRow_('Approvals', 'id', id);
    if (!a || a.status !== 'pending') throw new Error('This item has already been decided.');
    var e = normEntry_(o), url = String(a.doc_url || ''), blob = uploadBlob_(file);
    assertOpen_(e.date);
    if (blob) { if (url) trashDoc_(url); url = fileEntryDoc_(st, e, blob); }
    else if (url) url = refileDoc_(st, e, url);
    needsDoc_(e, url);
    if (e.kind === 'income') e.doc_status = url ? 'receipt' : '';
    e.doc_url = url; e.id = nextEntryId_(read_('Entries'));
    e.created_by = a.submitted_by || u.email; e.created_at = now_(); e.bank_line_id = a.bank_line || '';
    out.entry = upsert_(u, 'Entries', 'id', e, 'Approved from queue ' + id);
    out.approval = upsert_(u, 'Approvals', 'id', { id: id, status: 'approved', decided_by: u.email, decided_at: now_(), entry_id: e.id, doc_url: url }, 'Approved');
    if (a.bank_line) upsert_(u, 'BankLines', 'id', { id: a.bank_line, status: 'posted', matched_entry: e.id }, 'Posted from approval ' + id);
    if (o && String(o.remember_match || '').trim()) addRuleFromEntry_(o.remember_match, e);
  });
  afterWriteSoon_();
  return out;
}

/** A credit that settles an open invoice: records the payment on the invoice (no new income entry). */
function approvePayment_(u, a) {
  var out = recordPayment(a.doc_number, { amount: toNum_(a.amount), date: String(a.date).slice(0, 10), method: a.payment_method || 'Bank transfer' });
  withLock_(function () {
    out.approval = upsert_(u, 'Approvals', 'id', { id: a.id, status: 'approved', decided_by: u.email, decided_at: now_(), entry_id: a.doc_number }, 'Approved payment');
    if (a.bank_line) upsert_(u, 'BankLines', 'id', { id: a.bank_line, status: 'posted', matched_entry: a.doc_number }, 'Posted from approval ' + a.id);
  });
  return out;
}

/** A bank refund or reversal of a cost that is already in the books: lowers that entry, or removes it when nothing is left. */
function approveAdjust_(u, a) {
  var out = {};
  withLock_(function () {
    var e = findRow_('Entries', 'id', a.adjust_entry);
    if (!e) throw new Error('Entry ' + a.adjust_entry + ' no longer exists.');
    if (isInvoiceEntry_(e)) throw new Error('That entry belongs to an invoice. Adjust it from the invoice page.');
    assertOpen_(e.date);
    var rest = r2_(toNum_(e.amount) - toNum_(a.adjust_amount));
    if (rest <= 0.005) { deleteRow_(u, 'Entries', 'id', e.id, 'Removed: bank reversal ' + a.bank_line); out.removedEntry = e.id; }
    else out.entry = upsert_(u, 'Entries', 'id', { id: e.id, amount: rest, paid_amount: e.paid_status === 'paid' ? rest : e.paid_amount }, 'Reduced by bank refund ' + a.bank_line);
    out.approval = upsert_(u, 'Approvals', 'id', { id: a.id, status: 'approved', decided_by: u.email, decided_at: now_(), entry_id: e.id }, 'Approved adjustment');
    if (a.bank_line) upsert_(u, 'BankLines', 'id', { id: a.bank_line, status: 'posted', matched_entry: e.id }, 'Posted from approval ' + a.id);
  });
  afterWriteSoon_();
  return out;
}

function approvalObj_(a) {
  return { kind: a.kind, date: a.date, amount: a.amount, payee: a.payee, description: a.description, project: a.project, shoot: a.shoot, cost_type: a.cost_type, account: a.account,
    business_line: a.business_line, payment_method: a.payment_method, paid_status: a.paid_status || 'paid', paid_date: a.paid_date, paid_amount: a.paid_amount,
    doc_status: a.doc_status, doc_number: a.doc_number, notes: a.note };
}

/** Approves many queued items as they stand (up to 60 per call). Items that need a person's eye are skipped and listed in errors. */
function approveMany(ids) {
  var u = admin_(), out = { done: 0, errors: [] }, later = [];
  ids = (ids || []).slice(0, 60);
  withLock_(function () {
    ensureSchema_();
    var apps = {}; read_('Approvals').forEach(function (a) { apps[a.id] = a; });
    var seq = nextSeq_(read_('Entries'), 'E', 4), rows = [], ap = {}, bl = {}, log = [];
    ids.forEach(function (id) {
      var a = apps[id];
      if (!a || a.status !== 'pending') return;
      if (a.kind === 'payment' || a.kind === 'adjust') { later.push(a); return; }
      try {
        if (a.doc_url) throw new Error('has a document to file: open it');
        var e = normEntry_(approvalObj_(a));
        assertOpen_(e.date);
        if (e.kind === 'income') e.doc_status = '';
        e.doc_url = ''; e.id = seq.make(); e.created_by = a.submitted_by || u.email; e.created_at = now_(); e.bank_line_id = a.bank_line || '';
        rows.push(e);
        ap[id] = { status: 'approved', decided_by: u.email, decided_at: now_(), entry_id: e.id };
        if (a.bank_line) bl[a.bank_line] = { status: 'posted', matched_entry: e.id };
        log.push([new Date(), u.email, 'Entries', e.id, '(new row)', '', JSON.stringify(e), 'Approved from queue ' + id]);
        out.done++;
      } catch (err) { out.errors.push(id + ': ' + String(err.message || err)); }
    });
    appendRows_('Entries', rows);
    patchRows_('Approvals', 'id', ap);
    patchRows_('BankLines', 'id', bl);
    logAudit_(u, log);
  });
  later.forEach(function (a) {
    try { if (a.kind === 'payment') approvePayment_(u, a); else approveAdjust_(u, a); out.done++; }
    catch (err) { out.errors.push(a.id + ': ' + String(err.message || err)); }
  });
  afterWriteSoon_();
  return out;
}

function rejectItem(id, reason) {
  var u = admin_(), out = {};
  withLock_(function () {
    var a = findRow_('Approvals', 'id', id);
    if (!a) throw new Error('Item not found.');
    if (a.status !== 'pending') throw new Error('This item has already been decided.');
    out.approval = upsert_(u, 'Approvals', 'id', { id: id, status: 'rejected', decided_by: u.email, decided_at: now_(), reason: String(reason || '').trim() }, 'Rejected');
    if (a.bank_line) upsert_(u, 'BankLines', 'id', { id: a.bank_line, status: 'ignored', note: String(reason || '').trim() || 'Rejected from the queue' }, 'Rejected ' + id);
  });
  return out;
}

/** The person who submitted an item (or the admin) can take it back while it is still pending. A bank line goes back to unsorted. */
function withdrawItem(id) {
  var u = currentUser_(), out = {};
  if (!u || (u.role !== 'admin' && u.role !== 'viewer')) throw new Error('Not allowed.');
  withLock_(function () {
    var a = findRow_('Approvals', 'id', id);
    if (!a) throw new Error('Item not found.');
    if (u.role !== 'admin' && String(a.submitted_by).toLowerCase() !== u.email) throw new Error('This is not your item.');
    if (a.status !== 'pending') throw new Error('This item has already been decided.');
    if (a.doc_url) trashDoc_(a.doc_url);
    out.approval = upsert_(u, 'Approvals', 'id', { id: id, status: 'withdrawn', decided_by: u.email, decided_at: now_(), doc_url: '' }, 'Withdrawn');
    if (a.bank_line) upsert_(u, 'BankLines', 'id', { id: a.bank_line, status: 'new', approval_id: '' }, 'Withdrawn ' + id);
  });
  return out;
}

/** "Remember this": adds a sorting rule from an approved entry. The text is matched against the bank text (capitals, no spaces). */
function addRuleFromEntry_(text, e) {
  var m = sqz_(text);
  if (m.length < 3) return;
  var rules = read_('Rules'), max = 0, dup = false;
  rules.forEach(function (r) { if (toNum_(r.order) > max) max = toNum_(r.order); if (sqz_(r.match) === sqz_(escRe_(m)) || sqz_(r.match) === m) dup = true; });
  if (dup) return;
  function clean(s) { return String(s || '').replace(/[;=]/g, ' ').replace(/\s+/g, ' ').trim(); }
  var act = ['kind=' + e.kind, 'dir=' + (e.kind === 'income' ? 'credit' : 'debit')];
  if (e.kind === 'cost' && e.cost_type) act.push('type=' + clean(e.cost_type));
  if (e.business_line === 'AI data') act.push('line=AI data');
  if (e.project) act.push('project=' + clean(e.project));
  if (e.account && e.account !== accountFor_(e.kind, e.cost_type, e.project, e.business_line)) act.push('account=' + e.account);
  if (e.payee) act.push('payee=' + clean(e.payee));
  if (e.description) act.push('desc=' + clean(e.description));
  if (e.kind === 'cost' && (e.doc_status === 'bank line only' || e.doc_status === 'none')) act.push('doc=' + e.doc_status);
  appendRows_('Rules', [{ order: max + 10, match: escRe_(m), action: act.join('; '), active: 'yes', added: today_() }]);
}

/* ---------- send, mark sent, payments ---------- */

/**
 * opts: { email: true|false, to, cc, subject, body, saveEmail }.
 * email:false = mark as sent without emailing (e.g. sent by WhatsApp).
 */
function sendDoc(type, number, opts) {
  var u = admin_(), out;
  opts = opts || {};
  withLock_(function () {
    ensureSchema_();
    var isInv = type === 'invoice', tab = isInv ? 'Invoices' : 'Quotes', d = findRow_(tab, 'number', number), st = settings_();
    if (!d) throw new Error('Not found.');
    if (isInv && d.status === 'paid') throw new Error('This invoice is already paid.');
    if (!isInv && ['declined', 'invoiced'].indexOf(d.status) >= 0) throw new Error('This quote can no longer be sent.');
    var to = String(opts.to || '').trim();
    if (opts.email && !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(to)) throw new Error('Enter a valid email address to send to.');
    var forPdf = {}; Object.keys(d).forEach(function (k) { forPdf[k] = d[k]; });
    if (forPdf.status === 'draft') forPdf.status = 'sent';      // the PDF that goes out must not say DRAFT
    var r = makePdf_(type, forPdf);
    if (opts.email) {
      var mail = { to: to, subject: String(opts.subject || (isInv ? 'Invoice ' : 'Quote ') + number), body: String(opts.body || ''), name: st.company_name || 'Offset Media', attachments: [r.blob] };
      if (!isInv && String(st.terms_file_id || '').trim()) { try { mail.attachments.push(DriveApp.getFileById(String(st.terms_file_id).trim()).getBlob().setName('Offset Media Terms and Conditions.pdf')); } catch (e) { Logger.log('Terms file not found: ' + e); } }
      if (String(opts.cc || '').trim()) mail.cc = String(opts.cc).trim();
      MailApp.sendEmail(mail);
    }
    var sd = parseJson_(d.status_dates, {}), patch = { number: number, pdf_url: r.url };
    if (opts.email) { sd.emailed = today_(); patch.to_email = to; }
    var firstSend = d.status === 'draft';
    if (firstSend) { sd.sent = today_(); patch.status = 'sent'; patch.sent_at = now_(); }
    patch.status_dates = JSON.stringify(sd);
    out = {};
    d = upsert_(u, tab, 'number', patch, opts.email ? 'Emailed to ' + to : (firstSend ? 'Marked as sent' : 'PDF refreshed'));
    out[isInv ? 'invoice' : 'quote'] = d;
    if (isInv && firstSend) {
      var ent = createIncomeEntry_(u, d, r.url);
      out.entries = ent ? [ent] : [];
    }
    if (opts.email && opts.saveEmail) {
      var c = findRow_('Clients', 'name', d.client);
      if (c && String(c.email || '') !== to) out.client = upsert_(u, 'Clients', 'name', { name: d.client, email: to }, 'Email saved when sending ' + number);
    }
  });
  if (out.entries && out.entries.length) afterWrite_();
  return out;
}

function recordPayment(number, p) {
  var u = admin_(), out;
  withLock_(function () {
    ensureSchema_();
    var inv = findRow_('Invoices', 'number', number);
    if (!inv) throw new Error('Invoice not found.');
    if (inv.status === 'draft') throw new Error('Send the invoice before recording a payment.');
    if (inv.status === 'paid') throw new Error('This invoice is already paid.');
    var amt = r2_(toNum_(p.amount)), bal = r2_(dueOf_(inv) - toNum_(inv.paid_amount));
    if (!(amt > 0)) throw new Error('Enter the amount received.');
    if (amt > bal + 0.005) throw new Error('That is more than the balance of ' + money_(bal) + '.');
    var date = p.date || today_(), pays = parseJson_(inv.payments, []);
    pays.push({ date: date, amount: amt, method: p.method || '' });
    var total = r2_(pays.reduce(function (t, x) { return t + toNum_(x.amount); }, 0)), full = total >= dueOf_(inv) - 0.005;
    var sd = parseJson_(inv.status_dates, {});
    if (full) sd.paid = date;
    var saved = upsert_(u, 'Invoices', 'number', { number: number, payments: JSON.stringify(pays), paid_amount: total, status: full ? 'paid' : 'part paid', status_dates: JSON.stringify(sd) }, 'Payment ' + money_(amt));
    out = { invoice: saved, entries: allocatePaid_(u, saved, total, date, p.method) };
  });
  afterWrite_();
  return out;
}

function undoLastPayment(number) {
  var u = admin_(), out;
  withLock_(function () {
    var inv = findRow_('Invoices', 'number', number);
    if (!inv) throw new Error('Invoice not found.');
    var pays = parseJson_(inv.payments, []);
    if (!pays.length) throw new Error('There is no recorded payment to undo. This invoice was marked paid before payments were tracked here.');
    pays.pop();
    var total = r2_(pays.reduce(function (t, x) { return t + toNum_(x.amount); }, 0)), sd = parseJson_(inv.status_dates, {});
    delete sd.paid;
    var saved = upsert_(u, 'Invoices', 'number', { number: number, payments: JSON.stringify(pays), paid_amount: total, status: total > 0 ? 'part paid' : 'sent', status_dates: JSON.stringify(sd) }, 'Payment undone');
    out = { invoice: saved, entries: allocatePaid_(u, saved, total, pays.length ? pays[pays.length - 1].date : '', '') };
  });
  afterWrite_();
  return out;
}
/* =====================  Session 5: bank statements, rules, Claude sorting  ===================== */

var CLAUDE_URL_ = 'https://api.anthropic.com/v1/messages';
var PRICES_ = { 'claude-haiku-5-5': { i: 0.10, o: 0.50 }, 'claude-sonnet-5-5': { i: 2, o: 10 } };   // USD per million tokens; change here if the Console prices change
var SORT_CHUNK_ = 30;
var SORTER_ = 'sorter@offset-books';

var S5_SETTINGS_ = [
  ['claude_monthly_budget_usd', '4'],
  ['claude_model_fast', 'claude-haiku-5-5'],
  ['claude_model_strong', 'claude-sonnet-5-5'],
  ['calendar_ids', 'c_c3df9ba21bcc1a3ececd6dadeb7a6594a8b0f891e4038175925acf48eb0b3d48@group.calendar.google.com,contact@offset-media.com'],
  ['payee_aliases', 'Aaron = Brijesh P J E; Thulaasha = T G Liyanage; Shallum = S M P Senanayaka; Sh\'lom = S L D J Fernando (a different person from Shallum); TS Talent = Thushanth Mahendran (Dushan), who pays Waleed and Mithesh; Creator Space = MSA Perera; Kageeban = Sivanesan Kageeban / Rolleiflexgraphy; FlashMe = Flashme (PVT) LTD; TG = T G Studio (PVT) LTD; GLX = Good LifeX (the advance came as Hyacinthesis Photography); Sharon = Sharon Samuel; Senuka = Senuka Devmin Nagodavithana; Ahron = Triple A Production (monthly contractor fee)']
];

/** Rules are matched against the bank text in capitals with all spaces removed. action = key=value pairs split by ; (kind, dir, line, type, account, project, payee, desc, doc, day). */
var S5_RULES_ = [
  ['ECOM/UBEREATS', 'kind=cost; dir=debit; type=Food; payee=Uber Eats; day=shoot; doc=bank line only'],
  ['ECOM/UBER', 'kind=cost; dir=debit; type=Transport; payee=Uber; day=shoot; doc=bank line only'],
  ['ECOM/PICKME', 'kind=cost; dir=debit; type=Transport; payee=PickMe; day=shoot; doc=bank line only'],
  ['^HNBTXBCEFTCHG', 'kind=cost; dir=debit; type=Other; account=7010; payee=HNB; desc=Bank charge (CEFT); doc=bank line only'],
  ['^ECOM/ZOHO', 'kind=cost; dir=debit; type=Other; account=6030; payee=Zoho Books; desc=Software subscription; doc=none'],
  ['SRILANKATELECOM', 'kind=cost; dir=debit; type=Other; account=6040; payee=Sri Lanka Telecom; desc=Telephone and internet; doc=none'],
  ['^AISTAFF', 'kind=cost; dir=debit; line=AI data; type=Crew / freelancer; payee=AI staff; doc=none'],
  ['^AIMODEL', 'kind=cost; dir=debit; line=AI data; type=Crew / freelancer; payee=AI models; doc=none'],
  ['^AILOC', 'kind=cost; dir=debit; line=AI data; type=Location & venue; payee=AI location; doc=none'],
  ['^AIRENT', 'kind=cost; dir=debit; line=AI data; type=Equipment rental; payee=AI equipment rental; doc=none'],
  ['^AIDATA', 'kind=cost; dir=debit; line=AI data; type=Other; payee=AI data; doc=none'],
  ['(FINALPAY|UPFRONT).*SETS', 'kind=income; dir=credit; line=AI data; account=4020; payee=AI data client; desc=AI data sets payment'],
  ['^DRALOAN', 'kind=cost; dir=debit; account=1400; type=Other; payee=Joshua (director loan); desc=Director loan; doc=none'],
  ['^PROPS_?MABROC', 'kind=cost; dir=debit; type=Other; project=Mabroc; payee=Joshua (props); desc=Props for Mabroc shoot; doc=none']
];

/** Run once from the editor as contact@. Adds the Session 5 tabs, settings and starting rules, and asks for Calendar permission. */
function setupSession5() {
  ensureSchema_();
  var have = settings_();
  S5_SETTINGS_.forEach(function (kv) { if (have[kv[0]] === undefined || (kv[0] === 'claude_monthly_budget_usd' && !String(have[kv[0]]).trim())) setSetting_(kv[0], kv[1]); });
  var rules = read_('Rules'), seen = {}, max = 0;
  rules.forEach(function (r) { seen[sqz_(r.match)] = 1; if (toNum_(r.order) > max) max = toNum_(r.order); });
  var add = [];
  S5_RULES_.forEach(function (r) { if (!seen[sqz_(r[0])]) { max += 10; add.push({ order: max, match: r[0], action: r[1], active: 'yes', added: today_() }); } });
  if (add.length) appendRows_('Rules', add);
  var root = DriveApp.getFolderById(String(settings_().drive_root_id));
  ensureFolder_(ensureFolder_(root, fyFolderName_(settings_())), 'Bank statements');
  Logger.log('Rules added: ' + add.length + ' (existing rules were left alone).');
  Logger.log(PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') ? 'Claude key found in Script properties.' : 'Claude key NOT set yet: add ANTHROPIC_API_KEY under Project Settings > Script properties.');
  calendarIds_().forEach(function (id) {
    try { var c = CalendarApp.getCalendarById(id); Logger.log('Calendar ' + (c ? 'OK: ' + c.getName() : 'not found: ' + id)); } catch (e) { Logger.log('Calendar problem for ' + id + ': ' + e); }
  });
  Logger.log('Session 5 ready.');
}

/** Appends row objects to a tab in one write. Columns come from the tab's header row. */
function appendRows_(tab, objs) {
  if (!objs.length) return;
  var sh = ss_().getSheetByName(tab), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rows = objs.map(function (o) { return head.map(function (h) { return o[h] === undefined ? '' : o[h]; }); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}

/** Changes several rows of one tab with one read and one write. patches = { key: { column: value } }. */
function patchRows_(tab, keyCol, patches) {
  var keys = Object.keys(patches);
  if (!keys.length) return 0;
  var sh = ss_().getSheetByName(tab), rng = sh.getDataRange(), vals = rng.getValues(), head = vals[0], kc = head.indexOf(keyCol), n = 0;
  for (var i = 1; i < vals.length; i++) {
    var p = patches[String(vals[i][kc])];
    if (!p) continue;
    Object.keys(p).forEach(function (col) { var c = head.indexOf(col); if (c >= 0) vals[i][c] = p[col]; });
    n++;
  }
  if (n) rng.setValues(vals);
  return n;
}

function nextSeq_(rows, prefix, width) {
  var max = 0;
  rows.forEach(function (r) { var m = /(\d+)$/.exec(String(r.id)); if (m && String(r.id).indexOf(prefix) === 0 && Number(m[1]) > max) max = Number(m[1]); });
  return { n: max, make: function () { max++; var s = String(max); while (s.length < width) s = '0' + s; return prefix + s; } };
}

function sqz_(s) { return String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ''); }
function isoDmy_(s) { var p = String(s).split('/'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : String(s).slice(0, 10); }
function escRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------- rules ---------- */

function loadRules_() {
  return read_('Rules').filter(function (r) { return String(r.match || '').trim() && String(r.active == null || r.active === '' ? 'yes' : r.active).toLowerCase() !== 'no'; })
    .sort(function (a, b) { return toNum_(a.order) - toNum_(b.order); });
}
function parseAction_(s) {
  var o = {};
  String(s || '').split(';').forEach(function (p) { var i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim(); });
  return o;
}
function findRule_(rules, line) {
  var key = sqz_(line.description), credit = toNum_(line.amount) > 0;
  for (var i = 0; i < rules.length; i++) {
    var act = parseAction_(rules[i].action), re;
    if (act.dir === 'debit' && credit) continue;
    if (act.dir === 'credit' && !credit) continue;
    try { re = new RegExp(sqz_(rules[i].match), 'i'); } catch (e) { continue; }
    if (re.test(key)) return { rule: rules[i], act: act };
  }
  return null;
}
/** Matches "Mabroc" or an id to a project. Returns the project id or ''. */
function resolveProject_(txt, projects) {
  var t = String(txt || '').trim().toLowerCase();
  if (!t) return '';
  var byId = projects.filter(function (p) { return String(p.id).toLowerCase() === t; })[0];
  if (byId) return byId.id;
  var hits = projects.filter(function (p) { return String(p.name).toLowerCase().indexOf(t) >= 0; });
  return hits.length === 1 ? hits[0].id : '';
}

/* ---------- shoot days from Google Calendar ---------- */

function calendarIds_() { return String(settings_().calendar_ids || '').split(/[,\n]/).map(function (x) { return x.trim(); }).filter(String); }
var DAY_CACHE_ = {};
function normWords_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
/** Events on a date and the projects they point to. { events: [titles], projects: [ids], error: '' } */
function dayInfo_(iso, projects) {
  if (DAY_CACHE_[iso]) return DAY_CACHE_[iso];
  var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0), titles = [], err = '';
  calendarIds_().forEach(function (id) {
    try {
      var c = CalendarApp.getCalendarById(id);
      if (!c) { err = 'Calendar not found: ' + id; return; }
      c.getEventsForDay(d).forEach(function (ev) { var t = String(ev.getTitle() || '').trim(); if (t && titles.indexOf(t) < 0) titles.push(t); });
    } catch (e) { err = String(e.message || e); }
  });
  var hit = {};
  titles.forEach(function (t) {
    var nt = ' ' + normWords_(t) + ' ';
    projects.forEach(function (pr) {
      [pr.name, pr.id, pr.client].forEach(function (k) {
        var nk = normWords_(k);
        if (nk.length >= 4 && nt.indexOf(' ' + nk + ' ') >= 0) hit[pr.id] = (hit[pr.id] || 0) + (k === pr.client ? 1 : 2);
      });
    });
  });
  var ids = Object.keys(hit);
  if (ids.length > 1) { var best = Math.max.apply(null, ids.map(function (i) { return hit[i]; })); ids = ids.filter(function (i) { return hit[i] === best; }); }
  return (DAY_CACHE_[iso] = { events: titles, projects: ids, error: err });
}

/* ---------- Claude API, usage and budget ---------- */

function claudeKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!k || !String(k).trim()) throw new Error('The Claude key is not set. In Apps Script open Project Settings, scroll to Script properties and add ANTHROPIC_API_KEY.');
  return String(k).trim();
}
function spendState_() {
  var st = settings_(), budget = toNum_(st.claude_monthly_budget_usd) || 4, month = today_().slice(0, 7), used = 0;
  read_('AIUsage').forEach(function (r) { if (String(r.time).slice(0, 7) === month) used += toNum_(r.cost_usd); });
  return { used: r2_(used * 10000) / 10000, budget: budget, paused: used >= budget };
}
function modelFast_() { return String(settings_().claude_model_fast || 'claude-haiku-5-5').trim(); }
function modelStrong_() { return String(settings_().claude_model_strong || 'claude-sonnet-5-5').trim(); }

/** One Messages API call. Records the tokens and cost in AIUsage. Returns the text of the reply. */
function claudeOff_() { return String(settings_().claude_off || '').toLowerCase() === 'yes'; }
function callClaude_(model, system, userText, maxTokens, purpose) {
  if (claudeOff_()) throw new Error('PAUSED: Claude is switched off in Settings.');
  var sp = spendState_();
  if (sp.paused) throw new Error('PAUSED: this month\'s Claude budget (USD ' + sp.budget.toFixed(2) + ') is used up. Raise claude_monthly_budget_usd in Settings to continue.');
  var key = claudeKey_(), payload = JSON.stringify({ model: model, max_tokens: maxTokens, system: system, messages: [{ role: 'user', content: userText }] });
  function go(auth) {
    var h = { 'anthropic-version': '2023-06-01' };
    if (auth === 'bearer') h['Authorization'] = 'Bearer ' + key; else h['x-api-key'] = key;
    return UrlFetchApp.fetch(CLAUDE_URL_, { method: 'post', contentType: 'application/json', headers: h, payload: payload, muteHttpExceptions: true });
  }
  var res = go('key');
  if (res.getResponseCode() === 401) res = go('bearer');
  if (res.getResponseCode() === 429 || res.getResponseCode() === 529 || res.getResponseCode() === 503) { Utilities.sleep(4000); res = go('key'); if (res.getResponseCode() === 401) res = go('bearer'); }
  var code = res.getResponseCode(), body = res.getContentText(), j = parseJson_(body, null);
  if (code !== 200 || !j) {
    var msg = (j && j.error && j.error.message) ? j.error.message : body.slice(0, 200);
    throw new Error('Claude API error ' + code + ': ' + msg);
  }
  var u = j.usage || {}, pr = PRICES_[model] || PRICES_['claude-sonnet-5-5'];
  var cost = (toNum_(u.input_tokens) * pr.i + toNum_(u.output_tokens) * pr.o) / 1000000;
  appendRows_('AIUsage', [{ time: now_(), model: model, input_tokens: toNum_(u.input_tokens), output_tokens: toNum_(u.output_tokens), cost_usd: Math.round(cost * 1000000) / 1000000, purpose: purpose }]);
  return (j.content || []).map(function (b) { return b.type === 'text' ? b.text : ''; }).join('');
}
/** Pulls the first JSON array out of a reply (tolerates code fences and a short preamble). */
function jsonArray_(text) {
  var t = String(text || ''), a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a < 0 || b <= a) throw new Error('Claude did not return a list. Try again.');
  var v = parseJson_(t.slice(a, b + 1), null);
  if (!Array.isArray(v)) throw new Error('Claude\'s reply could not be read. Try again.');
  return v;
}

/** "Test connection" button: one tiny call plus a calendar check. */
function testClaude() {
  admin_();
  var out = { ok: false, calendars: [] };
  calendarIds_().forEach(function (id) {
    try { var c = CalendarApp.getCalendarById(id); out.calendars.push(c ? 'OK: ' + c.getName() : 'Not found: ' + id); } catch (e) { out.calendars.push('Problem: ' + String(e.message || e)); }
  });
  var m = modelFast_(), t = callClaude_(m, 'Reply with the single word OK.', 'Connection test', 16, 'connection test');
  out.ok = true; out.model = m; out.reply = String(t).trim().slice(0, 40); out.spend = spendState_();
  return out;
}

/** Bank page data: statements, line counts, spend and whether the key is set. */
function bankOverview() {
  admin_();
  var counts = {}, per = {};
  read_('BankLines').forEach(function (b) {
    var s = String(b.status || 'new'); counts[s] = (counts[s] || 0) + 1;
    var k = b.statement; per[k] = per[k] || {}; per[k][s] = (per[k][s] || 0) + 1;
  });
  var sts = read_('Statements').filter(function (s) { return s.id; }).map(function (s) { s.counts = per[s.id] || {}; return s; })
    .sort(function (a, b) { return String(b.to).localeCompare(String(a.to)); });
  return { statements: sts, counts: counts, spend: spendState_(), keySet: !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'), rules: loadRules_().length };
}

/* ---------- import a statement ---------- */

/**
 * rows: oldest first, each { date: 'DD/MM/YYYY', ref, amount (+ credit, - debit), balance, text }, read from the PDF in the browser.
 * meta: { opening, closing }. The running balance is checked line by line before anything is saved.
 */
function importStatement(meta, rows, file) {
  var u = admin_(), out = {};
  if (!rows || !rows.length) throw new Error('No transaction lines were found in that file.');
  if (rows.length > 3000) throw new Error('That statement has too many lines (limit 3000).');
  var prev = r2_(toNum_(meta && meta.opening)), i;
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(r.date))) throw new Error('Line ' + (i + 1) + ' has no valid date.');
    if (Math.abs(r2_(prev + toNum_(r.amount)) - r2_(toNum_(r.balance))) > 0.015) {
      throw new Error('The balance does not add up at line ' + (i + 1) + ' (' + r.date + ', ' + r.amount + '). Nothing was imported.');
    }
    prev = r2_(toNum_(r.balance));
  }
  if (meta && meta.closing != null && Math.abs(prev - r2_(toNum_(meta.closing))) > 0.015) throw new Error('The last balance does not match the statement closing balance. Nothing was imported.');
  withLock_(function () {
    ensureSchema_();
    var st = settings_(), have = read_('BankLines'), seen = {};
    have.forEach(function (b) { seen[[b.ref, r2_(toNum_(b.amount)), r2_(toNum_(b.balance))].join('|')] = 1; });
    var from = isoDmy_(rows[0].date), to = isoDmy_(rows[rows.length - 1].date), month = to.slice(0, 7);
    var stRows = read_('Statements'), sid = nextSeq_(stRows, 'ST', 3).make();
    var url = '', blob = uploadBlob_(file);
    if (blob) {
      var folder = ensureFolder_(ensureFolder_(ensureFolder_(DriveApp.getFolderById(String(st.drive_root_id)), fyFolderName_(st)), 'Bank statements'), month);
      url = folder.createFile(blob.setName(to + '_HNB_Statement_' + from + '_to_' + to + '.pdf')).getUrl();
    }
    var seq = nextSeq_(have, 'BL', 5), add = [], dup = 0;
    rows.forEach(function (r) {
      var k = [String(r.ref), r2_(toNum_(r.amount)), r2_(toNum_(r.balance))].join('|');
      if (seen[k]) { dup++; return; }
      seen[k] = 1;
      add.push({ id: seq.make(), statement: sid, date: isoDmy_(r.date), ref: String(r.ref), description: String(r.text || '').replace(/\s+/g, ' ').trim(), amount: r2_(toNum_(r.amount)),
        balance: r2_(toNum_(r.balance)), net: Math.abs(r2_(toNum_(r.amount))), matched_entry: '', status: 'new', approval_id: '', note: '' });
    });
    appendRows_('BankLines', add);
    var srow = { id: sid, month: month, from: from, to: to, file_url: url, opening: r2_(toNum_(meta.opening)), closing: r2_(toNum_(meta.closing)), lines: add.length, imported_by: u.email, imported_at: now_() };
    appendRows_('Statements', [srow]);
    logAudit_(u, [[new Date(), u.email, 'Statements', sid, '(imported)', '', add.length + ' lines, ' + dup + ' already known', from + ' to ' + to]]);
    out = { statement: srow, added: add.length, duplicates: dup };
  });
  return out;
}

/* ---------- reversals and adjustments ---------- */

function netOf_(l, patches) {
  var p = patches[l.id];
  if (p && p.net !== undefined) return p.net;
  var n = toNum_(l.net); return n > 0 ? n : Math.abs(toNum_(l.amount));
}
function statOf_(l, patches) { var p = patches[l.id]; return (p && p.status) || String(l.status || 'new'); }

/** Pairs "ECOM REV" credits with the debit they cancel and "ADJ FOR ..." credits with the ride they reduce. Safe to run again. */
function pairPass_() {
  var lines = read_('BankLines').sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
  var patches = {}, apatch = {}, adjust = [], res = { reversed: 0, adjusted: 0 }, apps = null, seq = null;
  function newAdjust(l, entryId, amt, why) {
    if (!seq) seq = nextSeq_(read_('Approvals'), 'A', 4);
    var id = seq.make();
    adjust.push({ id: id, status: 'pending', source: 'rule', submitted_by: SORTER_, submitted_at: now_(), kind: 'adjust', date: l.date, amount: amt, payee: 'Reduce ' + entryId, description: why,
      bank_line: l.id, suggestion: l.description, confidence: 'high', adjust_entry: entryId, adjust_amount: amt, note: why });
    patches[l.id] = { status: 'queued', approval_id: id };
  }
  function live(d, patches) { var s = statOf_(d, patches); return s === 'new' || s === 'queued' || s === 'posted'; }
  function applyTo(l, d, amt, whole, why) {
    var s = statOf_(d, patches);
    if (s === 'posted') { newAdjust(l, d.matched_entry, amt, why); return; }
    var net = r2_(netOf_(d, patches) - amt), p = patches[d.id] || {};
    if (whole) { p.status = 'reversed'; p.note = 'Reversed by ' + l.id; } else { p.net = net; }
    patches[d.id] = p;
    if (s === 'queued' && d.approval_id) { apatch[d.approval_id] = whole ? { status: 'withdrawn', reason: 'Reversed by the bank (' + l.id + ')', decided_at: now_() } : { amount: net, paid_amount: net }; }
    patches[l.id] = { status: whole ? 'reversed' : 'adjusted', note: (whole ? 'Reverses ' : 'Applied to ') + d.id };
  }
  lines.forEach(function (l, idx) {
    if (statOf_(l, patches) !== 'new' || toNum_(l.amount) <= 0) return;
    var key = sqz_(l.description), amt = r2_(toNum_(l.amount)), j, d;
    if (/^ECOMREV/.test(key)) {
      for (j = idx - 1; j >= 0; j--) {
        d = lines[j];
        if (toNum_(d.amount) >= 0 || !live(d, patches) || sqz_(d.description).indexOf('ECOM/') !== 0) continue;
        if (Math.abs(netOf_(d, patches) - amt) < 0.005 && Math.abs(Math.abs(toNum_(d.amount)) - amt) < 0.005) { applyTo(l, d, amt, true, 'Bank reversed ' + d.id); res.reversed++; break; }
      }
      return;
    }
    var m = /^ADJFOR(?:ECOM\/)?(UBEREATS|UBER|PICKME[A-Z]*)(\d{2})\/(\d{2})/.exec(key);
    if (m) {
      var iso = String(l.date).slice(0, 4) + '-' + m[2] + '-' + m[3], best = null;
      for (j = idx - 1; j >= 0; j--) {
        d = lines[j];
        var dk = sqz_(d.description);
        if (String(d.date).slice(0, 10) !== iso || toNum_(d.amount) >= 0 || !live(d, patches)) continue;
        var isEats = dk.indexOf('ECOM/UBEREATS') === 0, ok = m[1] === 'UBEREATS' ? isEats : (m[1] === 'UBER' ? (dk.indexOf('ECOM/UBER') === 0 && !isEats) : dk.indexOf('ECOM/PICKME') === 0);
        if (ok && netOf_(d, patches) > amt + 0.005 && (!best || netOf_(d, patches) < netOf_(best, patches))) best = d;
      }
      if (best) { applyTo(l, best, amt, false, 'Bank refunded part of ' + best.id + ' (' + m[1] + ' ' + iso + ')'); res.adjusted++; }
    }
  });
  patchRows_('BankLines', 'id', patches);
  patchRows_('Approvals', 'id', apatch);
  appendRows_('Approvals', adjust);
  return res;
}

/* ---------- sorting: rules first, then Claude, everything lands in the approval queue ---------- */

function methodOf_(key, methods) {
  var want = /^(ECOM|POS)/.test(key) ? ['Debit card', 'Card'] : ['Bank transfer'];
  for (var i = 0; i < want.length; i++) if (methods.indexOf(want[i]) >= 0) return want[i];
  return methods.indexOf('Bank transfer') >= 0 ? 'Bank transfer' : (methods[0] || '');
}
function openInvoices_() {
  return read_('Invoices').filter(function (i) { return i.number && (i.status === 'sent' || i.status === 'part paid'); })
    .map(function (i) { return { number: i.number, client: i.client, project: i.project || '', balance: r2_(dueOf_(i) - toNum_(i.paid_amount)) }; })
    .filter(function (i) { return i.balance > 0.005; });
}
function docDefault_(p, key) {
  if (p.kind !== 'cost') return '';
  return (p.cost_type === 'Transport' || p.cost_type === 'Food') && /^(ECOM|POS)/.test(key) ? 'bank line only' : 'none';
}

function proposalFromRule_(line, m, ctx) {
  var a = m.act, credit = toNum_(line.amount) > 0;
  var p = { source: 'rule', rule: String(m.rule.order), confidence: 'high', reason: 'Rule ' + m.rule.order + ': ' + String(m.rule.match).slice(0, 40), invoice: '' };
  p.kind = (a.kind === 'income' || a.kind === 'cost') ? a.kind : (credit ? 'income' : 'cost');
  if ((p.kind === 'cost' && credit) || (p.kind === 'income' && !credit)) return null;
  p.payee = a.payee || ''; p.description = a.desc || ''; p.cost_type = p.kind === 'cost' ? (a.type || 'Other') : (a.type || ''); p.account = a.account || ''; p.business_line = a.line || '';
  p.project = a.project ? resolveProject_(a.project, ctx.projects) : '';
  if (a.project && !p.project) { p.confidence = 'low'; p.reason += ' (project "' + a.project + '" not found: choose it)'; }
  if (a.day === 'shoot') {
    var di = dayInfo_(String(line.date).slice(0, 10), ctx.projects);
    if (di.projects.length === 1) { p.project = di.projects[0]; p.reason = 'Shoot day on the calendar: ' + String(di.events[0] || '').slice(0, 50); }
    else if (!di.events.length) {
      p.project = '';
      if (di.error) { p.confidence = 'low'; p.reason = 'Calendar could not be read, so shown as overhead'; } else p.reason = 'No shoot on the calendar that day, so overhead';
    } else return null;           // a shoot day, but which project is unclear: Claude decides with the event titles
  }
  p.doc = a.doc || docDefault_(p, sqz_(line.description));
  return p;
}

function invoiceMatch_(line, invoices) {
  if (toNum_(line.amount) <= 0) return null;
  var amt = r2_(toNum_(line.amount)), hits = invoices.filter(function (i) { return Math.abs(i.balance - amt) < 0.5; });
  if (hits.length !== 1) return null;
  var inv = hits[0];
  return { source: 'rule', rule: '', kind: 'payment', payee: inv.client, description: 'Payment on ' + inv.number, project: inv.project, cost_type: '', account: '', business_line: '', invoice: inv.number,
    confidence: 'high', reason: 'Amount matches the balance of ' + inv.number, doc: '' };
}

function aiSystem_(aliases) {
  return [
    'You sort bank statement lines for OFFSET MEDIA (PVT) LTD, a video and photo production company in Colombo, Sri Lanka. All amounts are LKR.',
    'The company has two business lines: "Production" (client projects) and "AI data" (a separate branch that collects AI training data; its payments have bank references starting with AI such as AISTAFF, AILOC, AIMODEL, AIRENT, AIDATA, and its income reads like "FINAL PAY ... SETS" or "upfront for sets").',
    'Everything you return is only a suggestion: a person approves it before anything is posted.',
    '',
    'For every input line return one object in a JSON array, and nothing else (no prose, no code fences):',
    '{"id":"<line id>","kind":"cost"|"income"|"payment","payee":"<who was paid, or who paid, using the canonical alias name>","description":"<what for, 8 words or fewer>","project":"<project id from the list or empty>","cost_type":"<one of the cost types, costs only>","account":"<optional books account code or empty>","business_line":"Production"|"AI data","invoice":"<open invoice number when kind is payment, else empty>","confidence":"high"|"medium"|"low","reason":"<12 words or fewer>"}',
    '',
    'Guidance:',
    '- A debit is always kind "cost". A credit is "income", or "payment" when it settles an open invoice (match the client and the balance; the invoice number must come from open_invoices).',
    '- Use only project ids from the list. If the project is unclear, leave it empty and lower the confidence. Never invent ids.',
    '- calendar_events and calendar_projects show the shoots on the line\'s date. Food and rides on a shoot day belong to that day\'s project; on other days they are company overhead (no project). On AI shoot days use business_line "AI data".',
    '- Restaurants and cafes paid by card (POS) are overhead Food by default, unless the calendar clearly shows one project shooting that day.',
    '- Payments to people or companies for crew work are cost_type "Crew / freelancer"; camera, lens or lighting hire "Equipment rental"; studios and venues "Location & venue"; props and materials "Other"; transport "Transport"; food "Food".',
    '- One-off jobs under LKR 35,000 that are not part of a bigger project have no project, and their income is other income (account 4090).',
    '- Ahron\'s monthly fee (Triple A Production) is company overhead, cost_type "Crew / freelancer", account "6020".',
    '- Payments to Joshua that are marked as a loan are the director\'s loan, account "1400".',
    '- Payee aliases (use the name on the left): ' + String(aliases || ''),
    '- If you are not sure, still give your best guess with confidence "low" and say why in reason. Do not skip any line.'
  ].join('\n');
}

function lineForAI_(l, ctx) {
  var iso = String(l.date).slice(0, 10), di = dayInfo_(iso, ctx.projects);
  return { id: l.id, date: iso, direction: toNum_(l.amount) > 0 ? 'credit' : 'debit', amount: r2_(netOf_(l, {})), text: String(l.description).slice(0, 160),
    calendar_events: di.events.slice(0, 5).map(function (t) { return t.slice(0, 60); }), calendar_projects: di.projects };
}

function askClaudeLines_(model, lines, ctx, hint, purpose) {
  var payload = { today: today_(), projects: ctx.projectsAI, open_invoices: ctx.invoices.slice(0, 60), cost_types: ctx.costTypes, lines: lines.map(function (l) { return lineForAI_(l, ctx); }) };
  var user = (hint ? hint + '\n\n' : '') + JSON.stringify(payload);
  var arr = jsonArray_(callClaude_(model, ctx.system, user, 6000, purpose)), map = {};
  arr.forEach(function (o) { if (o && o.id) map[String(o.id)] = o; });
  return map;
}

function cleanAI_(raw, line, ctx) {
  var credit = toNum_(line.amount) > 0, net = r2_(netOf_(line, {}));
  var p = { source: 'ai', rule: '', invoice: '', doc: '' };
  var kind = String(raw.kind || '').toLowerCase();
  p.kind = !credit ? 'cost' : (kind === 'payment' ? 'payment' : 'income');
  p.payee = String(raw.payee || '').trim().slice(0, 80);
  p.description = String(raw.description || '').trim().slice(0, 120);
  var pid = String(raw.project || '').trim();
  p.project = ctx.projects.some(function (x) { return String(x.id) === pid; }) ? pid : '';
  var ct = String(raw.cost_type || '').trim();
  p.cost_type = p.kind === 'cost' ? (ctx.costTypes.indexOf(ct) >= 0 ? ct : 'Other') : '';
  var ac = String(raw.account || '').trim();
  p.account = ctx.accountSet[ac] ? ac : '';
  p.business_line = raw.business_line === 'AI data' ? 'AI data' : (raw.business_line === 'Production' ? 'Production' : '');
  var conf = String(raw.confidence || '').toLowerCase();
  p.confidence = (conf === 'high' || conf === 'medium') ? conf : 'low';
  p.reason = String(raw.reason || '').trim().slice(0, 140);
  if (p.kind === 'payment') {
    var inv = ctx.invoices.filter(function (i) { return String(i.number) === String(raw.invoice); })[0];
    if (inv && net <= inv.balance + 0.005) { p.invoice = inv.number; if (!p.project) p.project = inv.project; }
    else { p.kind = 'income'; p.confidence = 'low'; p.reason = ('Not a clear invoice match. ' + p.reason).slice(0, 140); }
  }
  p.doc = docDefault_(p, sqz_(line.description));
  return p;
}
function fallbackProposal_(line) {
  var credit = toNum_(line.amount) > 0;
  return { source: 'ai', rule: '', kind: credit ? 'income' : 'cost', payee: '', description: '', project: '', cost_type: credit ? '' : 'Other', account: '', business_line: '', invoice: '',
    confidence: 'low', reason: 'No suggestion: please check this line.', doc: credit ? '' : 'none' };
}

function sortContext_() {
  var projects = read_('Projects').filter(function (p) { return p.id; }), st = settings_(), accountSet = {};
  read_('Accounts').forEach(function (a) { accountSet[String(a.code)] = 1; });
  var types = String(st.cost_types || '').split('|').map(function (x) { return x.trim(); }).filter(String);
  if (!types.length) types = Object.keys(COST_MAP_FALLBACK_);
  return {
    projects: projects, accountSet: accountSet, costTypes: types, invoices: openInvoices_(), rules: loadRules_(),
    projectsAI: projects.filter(function (p) { return ['Closed', 'Cancelled'].indexOf(p.status) < 0; }).slice(0, 120).map(function (p) { return { id: p.id, name: p.name, client: p.client, status: p.status }; }),
    system: aiSystem_(st.payee_aliases), methods: String(st.payment_methods || 'Bank transfer|Cash').split('|')
  };
}

function queueProposals_(items, ctx) {
  var ids = Object.keys(items);
  if (!ids.length) return 0;
  var seq = nextSeq_(read_('Approvals'), 'A', 4), rows = [], patches = {};
  ids.forEach(function (id) {
    var line = items[id].line, p = items[id].p, net = r2_(netOf_(line, {})), key = sqz_(line.description), aid = seq.make(), isPay = p.kind === 'payment';
    rows.push({ id: aid, status: 'pending', source: p.source, submitted_by: SORTER_, submitted_at: now_(), kind: p.kind, date: line.date, amount: net, payee: p.payee, description: p.description,
      project: p.project, shoot: '', cost_type: p.cost_type, account: p.account, business_line: p.business_line, payment_method: methodOf_(key, ctx.methods), paid_status: 'paid',
      paid_date: line.date, paid_amount: net, doc_url: '', doc_status: isPay ? '' : (p.doc || ''), doc_number: p.invoice || '', note: p.reason || '', bank_line: line.id,
      suggestion: String(line.description).slice(0, 200), confidence: p.confidence, rule: p.rule });
    patches[line.id] = { status: 'queued', approval_id: aid };
  });
  appendRows_('Approvals', rows);
  patchRows_('BankLines', 'id', patches);
  return rows.length;
}

/**
 * One step of sorting (up to 30 lines). The screen calls this again until nothing is left.
 * Lines that match a rule never reach Claude. Nothing is posted: every result goes to the approval queue.
 */
function sortStep(statementId) {
  var u = admin_(), out = { processed: 0, remaining: 0, paused: false, error: '', ai: 0 };
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    ensureSchema_();
    out.paired = pairPass_();
    var all = read_('BankLines').filter(function (l) { return (!statementId || l.statement === statementId) && (!l.status || l.status === 'new'); });
    var chunk = all.slice(0, SORT_CHUNK_), ctx = sortContext_(), items = {}, toAI = [];
    var off = claudeOff_();
    chunk.forEach(function (l) {
      var m = findRule_(ctx.rules, l), p = m ? proposalFromRule_(l, m, ctx) : null;
      // Offset Media payment reference (CR_SHALLUM_P014 ...): read it here, never ask Claude
      if (!p && toNum_(l.amount) < 0 && typeof obwRefParse_ === 'function') {
        var rp = obwRefParse_(l.description, ctx.projects, [], {});
        if (rp) p = { source: 'rule', rule: 'ref', kind: 'cost', payee: rp.payee, description: rp.description, project: rp.project, cost_type: rp.cost_type, account: rp.account, business_line: '', invoice: '',
          confidence: rp.ok ? 'high' : 'low', reason: rp.ok ? 'Payment reference' : 'Payment reference names a project number that does not exist', doc: rp.doc };
      }
      if (!p) p = invoiceMatch_(l, ctx.invoices);
      if (!p && off) p = fallbackProposal_(l);   // Claude switched off: the line waits for a person instead
      if (p) items[l.id] = { line: l, p: p }; else toAI.push(l);
    });
    out.processed += queueProposals_(items, ctx);
    items = {};
    if (toAI.length) {
      out.ai = toAI.length;
      try {
        var map = askClaudeLines_(modelFast_(), toAI, ctx, '', 'sorting ' + (statementId || 'lines'));
        var unsure = [];
        toAI.forEach(function (l) { var raw = map[l.id]; if (!raw) { items[l.id] = { line: l, p: fallbackProposal_(l) }; return; } var p = cleanAI_(raw, l, ctx); items[l.id] = { line: l, p: p }; if (p.confidence === 'low') unsure.push(l); });
        if (unsure.length) {
          try {
            var map2 = askClaudeLines_(modelStrong_(), unsure, ctx, 'A faster model was unsure about these lines. Think carefully and give your best answer for each.', 'second look ' + (statementId || 'lines'));
            unsure.forEach(function (l) { if (map2[l.id]) items[l.id] = { line: l, p: cleanAI_(map2[l.id], l, ctx) }; });
          } catch (e2) { if (!/^PAUSED/.test(String(e2.message))) Logger.log('Second look failed: ' + e2); }
        }
        out.processed += queueProposals_(items, ctx);
      } catch (e) {
        if (/^PAUSED/.test(String(e.message))) out.paused = true; else out.error = String(e.message || e);
      }
    }
    out.remaining = read_('BankLines').filter(function (l) { return (!statementId || l.statement === statementId) && (!l.status || l.status === 'new'); }).length;
  } finally { lock.releaseLock(); }
  out.spend = spendState_();
  return out;
}

/* =====================  Session 6: accountant workspace, month lock, exports, payments  ===================== */

var S6_SETTINGS_ = [['wht_rate', '0.05'], ['wht_threshold', '100000'], ['wht_alert', '80000']];
var RECLASS_FIELDS_ = ['account', 'project', 'cost_type', 'business_line', 'payee', 'description', 'shoot'];

/** Run once from the editor as contact@. Adds the Months and AccountantChanges tabs and the WHT settings, and creates the Exports folder. */
function setupSession6() {
  ensureSchema_();
  var have = settings_();
  S6_SETTINGS_.forEach(function (kv) { if (have[kv[0]] === undefined) setSetting_(kv[0], kv[1]); });
  var st = settings_();
  ensureFolder_(ensureFolder_(DriveApp.getFolderById(String(st.drive_root_id)), fyFolderName_(st)), 'Exports');
  Logger.log('Session 6 ready.');
}

function acct_() {
  var u = currentUser_();
  if (!u || (u.role !== 'admin' && u.role !== 'accountant')) throw new Error('Only the admin or the accountant can do this.');
  return u;
}
function monthOf_(date) { return String(date).slice(0, 7); }
function monthStatus_(ym) {
  var m = ref_('Months').filter(function (x) { return String(x.month).slice(0, 7) === ym; })[0];
  return m ? String(m.status) : '';
}
/** Throws when the month of a date is locked. Locked months can only be changed after the admin reopens them. */
function assertOpen_(date) {
  var ym = monthOf_(date);
  if (/^\d{4}-\d{2}$/.test(ym) && monthStatus_(ym) === 'locked') throw new Error('The books for ' + ym + ' are locked. The admin has to reopen the month before it can change.');
}

function setMonthRow_(ym, status, u, note) {
  var sh = ss_().getSheetByName('Months'), v = sh.getDataRange().getValues(), head = v[0], mc = head.indexOf('month'), idx = -1, i;
  for (i = 1; i < v.length; i++) if (String(cell_(v[i][mc])).slice(0, 7) === ym) { idx = i; break; }
  if (!status) { if (idx >= 0) sh.deleteRow(idx + 1); return; }
  var row = { month: ym, status: status, by: u.email, at: now_(), note: note || '' };
  var arr = head.map(function (h) { return row[h] === undefined ? '' : row[h]; });
  var r = idx < 0 ? sh.getLastRow() + 1 : idx + 1;
  sh.getRange(r, 1, 1, head.length).setNumberFormat('@').setValues([arr]);
}

/** action: 'review' | 'lock' | 'reopen'. Locking asks first when bank lines or approvals for that month are still open (pass force to lock anyway). */
function setMonthStatus(ym, action, note, force) {
  var out = {};
  if (!/^\d{4}-\d{2}$/.test(String(ym))) throw new Error('Choose a month.');
  var u = action === 'reopen' ? admin_() : acct_();
  withLock_(function () {
    ensureSchema_();
    var cur = String((read_('Months').filter(function (x) { return String(x.month).slice(0, 7) === ym; })[0] || {}).status || '');
    if (action === 'review') {
      if (cur === 'locked') throw new Error('That month is already locked.');
      setMonthRow_(ym, 'reviewed', u, note);
    } else if (action === 'lock') {
      if (cur === 'locked') throw new Error('That month is already locked.');
      if (!force) {
        var open = read_('BankLines').filter(function (b) { return monthOf_(b.date) === ym && (b.status === 'new' || b.status === 'queued'); }).length;
        var pend = read_('Approvals').filter(function (a) { return a.status === 'pending' && monthOf_(a.date) === ym; }).length;
        if (open || pend) throw new Error('OPEN: ' + ym + ' still has ' + open + ' bank lines not posted and ' + pend + ' items waiting for approval.');
      }
      setMonthRow_(ym, 'locked', u, note);
    } else if (action === 'reopen') {
      if (!cur) throw new Error('That month is not locked or reviewed.');
      setMonthRow_(ym, '', u, '');
    } else throw new Error('Unknown action.');
    logAudit_(u, [[new Date(), u.email, 'Months', ym, 'status', cur, action === 'reopen' ? '' : (action === 'lock' ? 'locked' : 'reviewed'), note || '']]);
    out.month = { month: ym, status: action === 'reopen' ? '' : (action === 'lock' ? 'locked' : 'reviewed'), by: u.email, at: now_(), note: note || '' };
  });
  return out;
}

/* ---------- accountant changes (apply at once, listed for the admin, one-click undo) ---------- */

function logChange_(u, entryId, action, oldV, newV, reason) {
  var seq = nextSeq_(read_('AccountantChanges'), 'C', 4), row = { id: seq.make(), time: now_(), by: u.email, entry_id: entryId, action: action, old: JSON.stringify(oldV), new: JSON.stringify(newV), reason: reason, undone: '' };
  appendRows_('AccountantChanges', [row]);
  return row;
}
function needReason_(reason) {
  var r = String(reason || '').trim();
  if (r.length < 3) throw new Error('Write a short reason for this change.');
  return r;
}
function checkAccountFor_(kind, code) {
  var a = ref_('Accounts').filter(function (x) { return String(x.code) === String(code); })[0];
  if (!a) throw new Error('That books account does not exist.');
  var t = String(a.type);
  if (kind === 'cost' && t === 'Revenue') throw new Error('A cost cannot go to a revenue account.');
  if (kind === 'income' && t !== 'Revenue' && t !== 'Liability') throw new Error('Income can only go to a revenue account (or customer advances).');
}

function reclassifyEntry(id, patch, reason) {
  var u = acct_(), out = {};
  reason = needReason_(reason);
  withLock_(function () {
    var e = findRow_('Entries', 'id', id);
    if (!e) throw new Error('Entry not found.');
    assertOpen_(e.date);
    var inv = isInvoiceEntry_(e), oldV = {}, newV = {};
    RECLASS_FIELDS_.forEach(function (f) {
      if (patch[f] === undefined) return;
      var v = String(patch[f] == null ? '' : patch[f]).trim();
      if (String(e[f] == null ? '' : e[f]) === v) return;
      if (inv && (f === 'payee' || f === 'description')) throw new Error('This entry comes from an invoice: its payee and description cannot change here.');
      oldV[f] = e[f] == null ? '' : e[f]; newV[f] = v;
    });
    if (!Object.keys(newV).length) throw new Error('Nothing was changed.');
    if (newV.account !== undefined) checkAccountFor_(e.kind, newV.account);
    if (newV.project) { if (!(ref_('Projects').filter(function (p) { return String(p.id) === newV.project; })[0])) throw new Error('That project was not found.'); }
    if (newV.business_line !== undefined && ['Production', 'AI data'].indexOf(newV.business_line) < 0) throw new Error('Business line must be Production or AI data.');
    if (newV.payee === '') throw new Error('The payee cannot be empty.');
    if (newV.project === '') newV.shoot = '';
    var patchRow = { id: id }; Object.keys(newV).forEach(function (k) { patchRow[k] = newV[k]; });
    out.entry = upsert_(u, 'Entries', 'id', patchRow, 'Accountant: ' + reason);
    out.change = logChange_(u, id, 'reclassify', oldV, newV, reason);
  });
  afterWriteSoon_();
  return out;
}

/** parts: [{ amount, account, project, cost_type, description }] adding up to the entry amount. The first part keeps the entry id. */
function splitEntry(id, parts, reason) {
  var u = acct_(), out = {};
  reason = needReason_(reason);
  withLock_(function () {
    var e = findRow_('Entries', 'id', id);
    if (!e) throw new Error('Entry not found.');
    assertOpen_(e.date);
    if (isInvoiceEntry_(e)) throw new Error('Entries from invoices cannot be split here.');
    if (e.paid_status === 'part') throw new Error('Record the rest of the payment before splitting a part-paid entry.');
    if (!parts || parts.length < 2 || parts.length > 8) throw new Error('A split needs between 2 and 8 parts.');
    var sum = 0;
    parts.forEach(function (p, i) {
      p.amount = r2_(toNum_(String(p.amount).replace(/,/g, '')));
      if (!(p.amount > 0)) throw new Error('Part ' + (i + 1) + ' needs an amount.');
      sum = r2_(sum + p.amount);
      checkAccountFor_(e.kind, p.account || e.account);
      if (p.project && !(ref_('Projects').filter(function (x) { return String(x.id) === String(p.project); })[0])) throw new Error('Part ' + (i + 1) + ': project not found.');
    });
    if (Math.abs(sum - toNum_(e.amount)) > 0.01) throw new Error('The parts add up to ' + money_(sum) + ' but the entry is ' + money_(e.amount) + '.');
    var seq = nextSeq_(read_('Entries'), 'E', 4), added = [], paid = e.paid_status === 'paid';
    var oldV = { amount: e.amount, account: e.account, project: e.project, cost_type: e.cost_type, description: e.description, paid_amount: e.paid_amount, notes: e.notes };
    parts.forEach(function (p, i) {
      var fields = { account: String(p.account || e.account), project: String(p.project || ''), cost_type: String(p.cost_type || e.cost_type), description: String(p.description || e.description || '').trim(), amount: p.amount, paid_amount: paid ? p.amount : 0 };
      fields.shoot = fields.project ? e.shoot : '';
      if (i === 0) {
        fields.notes = (String(e.notes || '') + ' Split by accountant: ' + reason).trim();
        out.entry = upsert_(u, 'Entries', 'id', (function () { var o = { id: id }; Object.keys(fields).forEach(function (k) { o[k] = fields[k]; }); return o; })(), 'Accountant split: ' + reason);
      } else {
        var row = {}; Object.keys(e).forEach(function (k) { row[k] = e[k]; });
        Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
        row.id = seq.make(); row.bank_line_id = ''; row.created_by = u.email; row.created_at = now_(); row.notes = 'Split from ' + id + ' by accountant: ' + reason;
        added.push(row);
      }
    });
    appendRows_('Entries', added);
    logAudit_(u, added.map(function (r) { return [new Date(), u.email, 'Entries', r.id, '(new row)', '', JSON.stringify(r), 'Accountant split of ' + id + ': ' + reason]; }));
    out.added = added.map(function (r) { return r.id; });
    out.change = logChange_(u, id, 'split', oldV, { ids: out.added, parts: parts }, reason);
  });
  afterWriteSoon_();
  return out;
}

/** The accountant adds a correcting entry (an accrual, a missed cost, a reclass of income). Kept separate and marked as an adjustment. */
function addAdjustment(o, reason) {
  var u = acct_(), out = {};
  reason = needReason_(reason);
  withLock_(function () {
    ensureSchema_();
    var e = normEntry_(o);
    assertOpen_(e.date);
    e.description = ('Adjustment: ' + (e.description || reason)).slice(0, 140);
    e.notes = ('Adjustment by accountant: ' + reason).slice(0, 300);
    e.doc_status = e.kind === 'cost' ? 'none' : ''; e.doc_url = '';
    e.id = nextEntryId_(read_('Entries')); e.created_by = u.email; e.created_at = now_(); e.bank_line_id = '';
    out.entry = upsert_(u, 'Entries', 'id', e, 'Accountant adjustment: ' + reason);
    out.change = logChange_(u, e.id, 'adjust', {}, { entry_id: e.id }, reason);
  });
  afterWriteSoon_();
  return out;
}

/** Admin only: puts an accountant change back as it was. A locked month has to be reopened first. */
function undoChange(changeId) {
  var u = admin_(), out = {};
  withLock_(function () {
    var c = findRow_('AccountantChanges', 'id', changeId);
    if (!c) throw new Error('Change not found.');
    if (String(c.undone || '').toLowerCase() === 'yes') throw new Error('This change was already undone.');
    var oldV = parseJson_(c.old, {}), newV = parseJson_(c.new, {}), e = findRow_('Entries', 'id', c.entry_id);
    if (c.action === 'adjust') {
      if (e) { assertOpen_(e.date); deleteRow_(u, 'Entries', 'id', e.id, 'Undo accountant adjustment ' + changeId); out.removedEntry = e.id; }
    } else {
      if (!e) throw new Error('The entry no longer exists, so this change cannot be undone.');
      assertOpen_(e.date);
      if (c.action === 'split') (newV.ids || []).forEach(function (nid) { deleteRow_(u, 'Entries', 'id', nid, 'Undo split ' + changeId); });
      var back = { id: e.id }; Object.keys(oldV).forEach(function (k) { back[k] = oldV[k]; });
      out.entry = upsert_(u, 'Entries', 'id', back, 'Undo accountant change ' + changeId);
      if (c.action === 'split') out.removedEntries = newV.ids || [];
    }
    patchRows_('AccountantChanges', 'id', (function () { var p = {}; p[changeId] = { undone: 'yes', undone_by: u.email, undone_at: now_() }; return p; })());
  });
  afterWriteSoon_();
  return out;
}

/* ---------- statement library and cash check ---------- */

/** Statements by month with line counts, gaps between statements, and bank movement against what the books say was paid. */
function statementLibrary() {
  acct_();
  var st = settings_(), sts = read_('Statements').filter(function (s) { return s.id; }).sort(function (a, b) { return String(a.from).localeCompare(String(b.from)); });
  var lines = read_('BankLines'), per = {}, by = {};
  lines.forEach(function (b) {
    var m = monthOf_(b.date), s = String(b.status || 'new'), a = toNum_(b.amount);
    var o = by[m] = by[m] || { lines: 0, bank_in: 0, bank_out: 0, open: 0, posted: 0, reversed: 0, adjusted: 0, ignored: 0 };
    o.lines++; if (a > 0) o.bank_in += a; else o.bank_out -= a;
    if (s === 'new' || s === 'queued') o.open++; else o[s] = (o[s] || 0) + 1;
    var p = per[b.statement] = per[b.statement] || {}; p[s] = (p[s] || 0) + 1;
  });
  var books = {};
  read_('Entries').forEach(function (e) {
    if (e.kind !== 'income' && e.kind !== 'cost') return;
    var paid = paidOf_(e); if (paid <= 0) return;
    var m = monthOf_(e.paid_date || e.date), o = books[m] = books[m] || { in: 0, out: 0 };
    if (e.kind === 'income') o.in += paid; else o.out += paid;
  });
  var months = fyMonths_(st).map(function (m) {
    var b = by[m] || { lines: 0, bank_in: 0, bank_out: 0, open: 0, posted: 0, reversed: 0, adjusted: 0, ignored: 0 }, k = books[m] || { in: 0, out: 0 };
    var covered = sts.filter(function (s) { return monthOf_(s.from) <= m && monthOf_(s.to) >= m; }).map(function (s) { return s.id; });
    return { month: m, status: monthStatus_(m), statements: covered, lines: b.lines, open: b.open, posted: b.posted, reversed: b.reversed, adjusted: b.adjusted, ignored: b.ignored,
      bank_net: r2_(b.bank_in - b.bank_out), books_net: r2_(k.in - k.out), bank_in: r2_(b.bank_in), bank_out: r2_(b.bank_out), books_in: r2_(k.in), books_out: r2_(k.out) };
  });
  sts.forEach(function (s, i) {
    s.counts = per[s.id] || {};
    s.gap = '';
    if (i > 0) { var p = sts[i - 1]; if (String(p.to).slice(0, 10) < String(s.from).slice(0, 10) && Math.abs(toNum_(p.closing) - toNum_(s.opening)) > 0.01) s.gap = 'Balance does not carry over from ' + String(p.to).slice(0, 10) + ': closing ' + money_(p.closing) + ', opening ' + money_(s.opening); }
  });
  return { statements: sts.reverse(), months: months };
}

/* ---------- withholding tax schedule ---------- */

/** Payments to individuals per month. WHT is 5% of the full amount once one person is paid more than the threshold in a month. */
function whtCalc_(entries, st, from, to) {
  var thr = toNum_(st.wht_threshold) || 100000, alertAt = toNum_(st.wht_alert) || 80000, rate = toNum_(st.wht_rate) || 0.05, map = {};
  entries.forEach(function (e) {
    if (e.kind !== 'cost') return;
    var acc = String(e.account), ct = String(e.cost_type);
    if (acc === '1400' || acc === '6010') return;
    if (acc !== '5020' && acc !== '6020' && ct !== 'Crew / freelancer') return;
    var paid = paidOf_(e); if (paid <= 0) return;
    var m = monthOf_(e.paid_date || e.date); if (m < from || m > to) return;
    var name = String(e.payee || '').trim(), key = name.toLowerCase() + '|' + m;
    var o = map[key] = map[key] || { payee: name, month: m, paid: 0, count: 0, company: /\b(pvt|ltd|limited|private)\b/i.test(name) };
    o.paid = r2_(o.paid + paid); o.count++;
  });
  var rows = Object.keys(map).map(function (k) {
    var o = map[k];
    o.status = o.company ? 'Company: no WHT' : (o.paid > thr ? 'WHT due' : (o.paid >= alertAt ? 'Near the limit' : 'Below the limit'));
    o.wht = o.status === 'WHT due' ? r2_(o.paid * rate) : 0;
    return o;
  }).sort(function (a, b) { return a.month.localeCompare(b.month) || b.paid - a.paid; });
  return { rows: rows, threshold: thr, alert: alertAt, rate: rate };
}

/* ---------- reports ---------- */

function monthRange_(from, to) {
  var out = [], p = String(from).split('-'), y = +p[0], m = +p[1] - 1, guard = 0;
  while (guard++ < 36) {
    var ym = y + '-' + ('0' + (m + 1)).slice(-2);
    if (ym > to) break;
    out.push(ym); m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}
var MON_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monLabel_(ym) { return MON_[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }

function pnlRows_(entries, accounts, from, to) {
  var months = monthRange_(from, to), sums = {};
  entries.forEach(function (e) {
    if (e.kind !== 'income' && e.kind !== 'cost') return;
    var m = monthOf_(e.date); if (m < from || m > to) return;
    var k = e.account + '|' + m; sums[k] = (sums[k] || 0) + toNum_(e.amount);
  });
  var rows = [['Account'].concat(months.map(monLabel_)).concat(['Total'])];
  function block(type, title) {
    rows.push([title]);
    var tot = months.map(function () { return 0; });
    accounts.filter(function (a) { return a.type === type; }).sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); }).forEach(function (a) {
      var vals = months.map(function (m, i) { var v = r2_(sums[a.code + '|' + m] || 0); tot[i] += v; return v; }), t = r2_(vals.reduce(function (x, y) { return x + y; }, 0));
      if (t) rows.push([a.code + ' ' + a.name].concat(vals).concat([t]));
    });
    rows.push(['Total ' + title].concat(tot.map(r2_)).concat([r2_(tot.reduce(function (x, y) { return x + y; }, 0))]));
    return tot;
  }
  var inc = block('Revenue', 'Income'), exp = block('Expense', 'Expenses');
  var net = inc.map(function (v, i) { return r2_(v - exp[i]); });
  rows.push(['Net profit'].concat(net).concat([r2_(net.reduce(function (x, y) { return x + y; }, 0))]));
  return rows;
}

/** Balances as at the end of month `to`, built from the app's records. Anything the records cannot explain is shown as a balancing figure. */
function balances_(entries, accounts, statements, to) {
  var bal = {}, byCode = {};
  accounts.forEach(function (a) { byCode[String(a.code)] = a; });
  function add(code, dr, cr) { code = String(code); var o = bal[code] = bal[code] || { dr: 0, cr: 0 }; o.dr = r2_(o.dr + dr); o.cr = r2_(o.cr + cr); }
  var recv = 0, pay = 0;
  entries.forEach(function (e) {
    if ((e.kind !== 'income' && e.kind !== 'cost') || monthOf_(e.date) > to) return;
    var a = toNum_(e.amount), open = Math.max(0, r2_(a - paidOf_(e)));
    if (e.kind === 'income') { add(e.account, 0, a); recv += open; } else { add(e.account, a, 0); if (String(e.account) !== '1400') pay += open; }
  });
  var sts = statements.filter(function (s) { return monthOf_(s.to) <= to; }).sort(function (a, b) { return String(a.to).localeCompare(String(b.to)); });
  var bank = sts.length ? toNum_(sts[sts.length - 1].closing) : 0;
  add('1010', bank, 0); add('1100', r2_(recv), 0); add('2010', 0, r2_(pay));
  var dr = 0, cr = 0, rows = [];
  Object.keys(bal).sort().forEach(function (c) {
    var o = bal[c], net = r2_(o.dr - o.cr), a = byCode[c] || { name: '(not in chart)', type: '' };
    if (Math.abs(net) < 0.005) return;
    var row = { code: c, name: a.name, type: a.type, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0 };
    dr += row.dr; cr += row.cr; rows.push(row);
  });
  var diff = r2_(dr - cr);
  return { rows: rows, dr: r2_(dr), cr: r2_(cr), diff: diff, bank: bank, hasBank: !!sts.length };
}

function tbRows_(b) {
  var rows = [['Code', 'Account', 'Debit', 'Credit']];
  b.rows.forEach(function (r) { rows.push([r.code, r.name, r.dr || '', r.cr || '']); });
  var dr = b.dr, cr = b.cr;
  if (b.diff > 0) { rows.push(['', 'Stated capital, opening balances and unexplained difference', '', b.diff]); cr += b.diff; }
  else if (b.diff < 0) { rows.push(['', 'Unexplained difference', -b.diff, '']); dr += -b.diff; }
  rows.push(['', 'Total', r2_(dr), r2_(cr)]);
  rows.push([]);
  rows.push(['Note', 'Built from the app\'s records. The bank balance is the latest imported statement' + (b.hasBank ? '' : ' (none imported yet, so shown as zero)') + '. The balancing line is whatever those records cannot explain yet (capital paid in, opening balances, missing entries). The accountant should clear it.']);
  return rows;
}

function bsRows_(b) {
  var rows = [['Balance sheet (draft)', 'LKR']], A = 0, L = 0, profit = 0;
  rows.push(['Assets']);
  b.rows.filter(function (r) { return r.type === 'Asset'; }).forEach(function (r) { var v = r2_(r.dr - r.cr); A += v; rows.push([r.code + ' ' + r.name, v]); });
  rows.push(['Total assets', r2_(A)]);
  rows.push([]); rows.push(['Liabilities']);
  b.rows.filter(function (r) { return r.type === 'Liability'; }).forEach(function (r) { var v = r2_(r.cr - r.dr); L += v; rows.push([r.code + ' ' + r.name, v]); });
  rows.push(['Total liabilities', r2_(L)]);
  b.rows.forEach(function (r) { if (r.type === 'Revenue') profit += r.cr - r.dr; else if (r.type === 'Expense') profit -= r.dr - r.cr; });
  var other = 0; b.rows.filter(function (r) { return r.type === 'Equity'; }).forEach(function (r) { other += r.cr - r.dr; });
  var plug = r2_(A - L - profit - other);
  rows.push([]); rows.push(['Equity']);
  rows.push(['Profit for the period to date', r2_(profit)]);
  b.rows.filter(function (r) { return r.type === 'Equity'; }).forEach(function (r) { rows.push([r.code + ' ' + r.name, r2_(r.cr - r.dr)]); });
  rows.push(['Stated capital, opening balances and unexplained difference', plug]);
  rows.push(['Total equity', r2_(profit + other + plug)]);
  rows.push([]); rows.push(['Total liabilities and equity', r2_(L + profit + other + plug)]);
  rows.push([]); rows.push(['Note', 'Draft built from the app\'s records. Equipment, depreciation, tax and payroll balances are not tracked here yet, so the balancing line includes them.']);
  return rows;
}

function ledgerRows_(entries, accounts, from, to, account) {
  var rows = [['Date', 'Entry', 'Paid to / from', 'Description', 'Project', 'Debit', 'Credit', 'Balance']], byAcc = {}, nm = {};
  accounts.forEach(function (a) { nm[String(a.code)] = a.name; });
  entries.forEach(function (e) {
    if (e.kind !== 'income' && e.kind !== 'cost') return;
    var m = monthOf_(e.date); if (m < from || m > to) return;
    if (account && String(e.account) !== String(account)) return;
    (byAcc[e.account] = byAcc[e.account] || []).push(e);
  });
  Object.keys(byAcc).sort().forEach(function (code) {
    rows.push([code + ' ' + (nm[code] || '')]);
    var run = 0, dr = 0, cr = 0;
    byAcc[code].sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)); }).forEach(function (e) {
      var a = toNum_(e.amount), d = e.kind === 'cost' ? a : 0, c = e.kind === 'income' ? a : 0; run = r2_(run + d - c); dr += d; cr += c;
      rows.push([String(e.date).slice(0, 10), e.id, e.payee || '', e.description || '', e.project || '', d || '', c || '', run]);
    });
    rows.push(['', '', '', 'Total ' + code, '', r2_(dr), r2_(cr), r2_(dr - cr)]);
  });
  return rows;
}

function whtRows_(w) {
  var rows = [['Month', 'Paid to', 'Payments', 'Paid in the month', 'Status', 'WHT due']], tot = 0;
  w.rows.forEach(function (o) { rows.push([monLabel_(o.month), o.payee, o.count, o.paid, o.status, o.wht || '']); tot += o.wht; });
  rows.push(['', '', '', '', 'Total WHT due', r2_(tot)]);
  rows.push([]);
  rows.push(['Rule', 'WHT is ' + Math.round(w.rate * 100) + '% of the full amount once one person is paid more than LKR ' + money_(w.threshold) + ' in a month. Warning from LKR ' + money_(w.alert) + '. Companies are excluded by name (Pvt, Ltd). Based on payment dates.']);
  return rows;
}

var REPORT_NAMES_ = { pnl: 'Profit and loss', tb: 'Trial balance', bs: 'Balance sheet', ledger: 'Ledger', wht: 'WHT schedule' };

/** Builds the report as a new Google Sheet in Offset Books / FY / Exports and returns links to the sheet, an Excel download and a PDF. */
function exportReport(type, opts) {
  var u = acct_();
  opts = opts || {};
  if (!REPORT_NAMES_[type]) throw new Error('Unknown report.');
  var st = settings_(), months = fyMonths_(st), from = /^\d{4}-\d{2}$/.test(opts.from || '') ? opts.from : months[0], to = /^\d{4}-\d{2}$/.test(opts.to || '') ? opts.to : monthOf_(today_());
  if (from > to) throw new Error('The first month is after the last month.');
  var entries = read_('Entries'), accounts = read_('Accounts'), rows;
  if (type === 'pnl') rows = pnlRows_(entries, accounts, from, to);
  else if (type === 'ledger') rows = ledgerRows_(entries, accounts, from, to, opts.account);
  else if (type === 'wht') rows = whtRows_(whtCalc_(entries, st, from, to));
  else { var b = balances_(entries, accounts, read_('Statements').filter(function (s) { return s.id; }), to); rows = type === 'tb' ? tbRows_(b) : bsRows_(b); }
  var title = REPORT_NAMES_[type] + (type === 'tb' || type === 'bs' ? ' as at end of ' + monLabel_(to) : ' ' + monLabel_(from) + ' to ' + monLabel_(to));
  var all = [[String(st.company_name || 'Offset Media (Pvt) Ltd')], [title], ['LKR. Accrual basis. Prepared ' + now_() + ' by ' + u.email + '. Reviewed months are marked in the app.'], []].concat(rows);
  var cols = 1; all.forEach(function (r) { if (r.length > cols) cols = r.length; });
  all = all.map(function (r) { var c = r.slice(); while (c.length < cols) c.push(''); return c; });
  var sp = SpreadsheetApp.create(title + ' (' + today_() + ')'), sh = sp.getActiveSheet();
  sh.setName(REPORT_NAMES_[type]);
  sh.getRange(1, 1, all.length, cols).setValues(all);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1).setFontWeight('bold');
  sh.getRange(5, 1, 1, cols).setFontWeight('bold').setBackground('#15122A').setFontColor('#EEEAF4');
  if (cols > 1) sh.getRange(6, 2, Math.max(1, all.length - 5), cols - 1).setNumberFormat('#,##0.00;-#,##0.00');
  if (type === 'wht') sh.getRange(6, 3, Math.max(1, all.length - 5), 1).setNumberFormat('0');
  if (type === 'ledger' || type === 'tb') sh.getRange(6, 1, Math.max(1, all.length - 5), 2).setNumberFormat('@');
  sh.setFrozenRows(5);
  if (cols <= 24) sh.autoResizeColumns(1, cols);
  SpreadsheetApp.flush();
  try { DriveApp.getFileById(sp.getId()).moveTo(ensureFolder_(ensureFolder_(DriveApp.getFolderById(String(st.drive_root_id)), fyFolderName_(st)), 'Exports')); }
  catch (e) { Logger.log('Could not move the export into the Exports folder: ' + e); }
  var base = 'https://docs.google.com/spreadsheets/d/' + sp.getId();
  logAudit_(u, [[new Date(), u.email, 'Exports', sp.getId(), type, '', title, '']]);
  return { title: title, sheet: base + '/edit', xlsx: base + '/export?format=xlsx', pdf: base + '/export?format=pdf&size=A4&portrait=false&fitw=true', rows: rows.length };
}

/* ---------- recurring bills (payments calendar) ---------- */

function saveRecurring(o, oldName) {
  var u = admin_(), out = {};
  var name = String(o.name || '').trim(), day = Math.round(toNum_(o.day)), amt = r2_(toNum_(String(o.amount == null ? '' : o.amount).replace(/,/g, '')));
  if (!name) throw new Error('Enter a name.');
  if (!(day >= 1 && day <= 31)) throw new Error('The day of the month must be between 1 and 31.');
  var colour = /^#[0-9A-Fa-f]{6}$/.test(String(o.colour || '')) ? String(o.colour) : '#2B4BFF';
  withLock_(function () {
    if (oldName && oldName !== name) deleteRow_(u, 'Recurring', 'name', oldName, 'Renamed to ' + name);
    out.recurring = upsert_(u, 'Recurring', 'name', { name: name, amount: amt > 0 ? amt : '', day: day, colour: colour }, oldName ? 'Recurring bill edited' : 'Recurring bill added');
    if (oldName && oldName !== name) out.removedRecurring = oldName;
  });
  return out;
}
function deleteRecurring(name) {
  var u = admin_(), out = {};
  withLock_(function () { if (!deleteRow_(u, 'Recurring', 'name', name, 'Recurring bill removed')) throw new Error('Not found.'); out.removedRecurring = name; });
  return out;
}


/* ---------- session 7: project budget sheets, spending room ---------- */

function setupSession7() {
  ensureSchema_();
  var have = settings_();
  [['spend_buffer_months', 2], ['spend_horizon_days', 60]].forEach(function (kv) { if (have[kv[0]] === undefined) setSetting_(kv[0], kv[1]); });
  var st = settings_();
  ensureFolder_(ensureFolder_(DriveApp.getFolderById(String(st.drive_root_id)), fyFolderName_(st)), 'Budgets');
  Logger.log('Session 7 ready.');
}

function budgetActuals_(projectId) {
  var rows = [['Date', 'Paid to', 'Cost type', 'Amount', 'Description', 'Entry']];
  read_('Entries').filter(function (e) { return e.kind === 'cost' && String(e.project) === String(projectId) && String(e.account) !== '1400'; })
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })
    .forEach(function (e) { rows.push([String(e.date).slice(0, 10), e.payee || '', e.cost_type || '', toNum_(e.amount), e.description || '', e.id]); });
  return rows;
}

function writeActuals_(sp, projectId) {
  var sh = sp.getSheetByName('Actuals') || sp.insertSheet('Actuals'), rows = budgetActuals_(projectId);
  sh.clear();
  sh.getRange(1, 1, rows.length, 6).setValues(rows);
  sh.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#15122A').setFontColor('#EEEAF4');
  sh.getRange(2, 4, Math.max(1, rows.length - 1), 1).setNumberFormat('#,##0.00');
  sh.setFrozenRows(1); sh.autoResizeColumns(1, 6);
  return rows.length - 1;
}

/** Internal budget for one project: a Google Sheet in Offset Books / FY / Budgets. Planned is typed by hand; Actual fills from the project's costs. */
function createBudgetSheet(projectId) {
  var u = admin_(), out = {};
  var p = findRow_('Projects', 'id', projectId);
  if (!p) throw new Error('Project not found.');
  if (p.budget_url) throw new Error('This project already has a budget sheet.');
  var st = settings_(), types = String(st.cost_types || 'Equipment rental|Crew / freelancer|Transport|Food|Location & venue|Other').split('|').filter(String);
  var sp = SpreadsheetApp.create('Budget - ' + p.name + ' (' + p.id + ')'), sh = sp.getActiveSheet();
  sh.setName('Budget');
  var rows = [['Internal budget: ' + p.name, '', '', '', '', ''], ['Client: ' + (p.client || '') + '. Type planned amounts in the white rows. Actual is filled from the app (Refresh in the app updates the Actuals tab).', '', '', '', '', ''], [], ['Category / item', 'Planned', 'Actual', 'Difference', 'Left %', 'Notes']];
  var cat = [], r = 5;
  types.forEach(function (t) {
    cat.push(r);
    rows.push([t, '=SUM(B' + (r + 1) + ':B' + (r + 4) + ')', '=SUMIFS(Actuals!D:D,Actuals!C:C,A' + r + ')', '=B' + r + '-C' + r, '=IF(B' + r + '=0,"",D' + r + '/B' + r + ')', '']);
    for (var i = 0; i < 4; i++) rows.push(['   ', '', '', '', '', '']);
    r += 5;
  });
  var tp = cat.map(function (x) { return 'B' + x; }).join('+'), ta = cat.map(function (x) { return 'C' + x; }).join('+');
  rows.push(['TOTAL', '=' + tp, '=' + ta, '=B' + r + '-C' + r, '=IF(B' + r + '=0,"",D' + r + '/B' + r + ')', '']);
  sh.getRange(1, 1, rows.length, 6).setValues(rows);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  sh.getRange(4, 1, 1, 6).setFontWeight('bold').setBackground('#15122A').setFontColor('#EEEAF4');
  cat.forEach(function (x) { sh.getRange(x, 1, 1, 6).setFontWeight('bold').setBackground('#EEF0FF'); });
  sh.getRange(r, 1, 1, 6).setFontWeight('bold').setBackground('#15122A').setFontColor('#EEEAF4');
  sh.getRange(5, 2, rows.length - 4, 3).setNumberFormat('#,##0;-#,##0');
  sh.getRange(5, 5, rows.length - 4, 1).setNumberFormat('0%');
  sh.setColumnWidth(1, 260); sh.setColumnWidth(6, 260); sh.setFrozenRows(4);
  writeActuals_(sp, projectId);
  sp.setActiveSheet(sh);
  SpreadsheetApp.flush();
  try { DriveApp.getFileById(sp.getId()).moveTo(ensureFolder_(ensureFolder_(DriveApp.getFolderById(String(st.drive_root_id)), fyFolderName_(st)), 'Budgets')); } catch (e) { Logger.log('Budget sheet not moved: ' + e); }
  var url = 'https://docs.google.com/spreadsheets/d/' + sp.getId() + '/edit';
  withLock_(function () { out.project = upsert_(u, 'Projects', 'id', { id: projectId, budget_url: url }, 'Internal budget sheet created'); });
  return out;
}

/** Rewrites the Actuals tab from the project's current costs and returns planned and spent. */
function refreshBudgetActuals(projectId) {
  var u = admin_(), out = {};
  var p = findRow_('Projects', 'id', projectId);
  if (!p || !p.budget_url) throw new Error('This project has no budget sheet yet.');
  var sp = SpreadsheetApp.openById(fileIdFromUrl_(p.budget_url)), n = writeActuals_(sp, projectId);
  SpreadsheetApp.flush();
  var sh = sp.getSheetByName('Budget'), last = sh.getLastRow(), planned = toNum_(sh.getRange(last, 2).getValue()), actual = toNum_(sh.getRange(last, 3).getValue());
  withLock_(function () { out.project = upsert_(u, 'Projects', 'id', { id: projectId, budget_planned: planned }, 'Budget refreshed'); });
  out.planned = planned; out.actual = actual; out.lines = n;
  return out;
}

/* ---------- new and edited projects ---------- */

var PROJECT_STATUSES_ = ['Quoted', 'Confirmed', 'In production', 'Delivered', 'Closed', 'Cancelled'];

/** Creates a project (no id) or updates name, client, status and business line (with id). A client name that does not exist yet is added to Clients. */
function saveProject(o) {
  var u = admin_(), out = {};
  var name = String(o.name || '').trim(), client = String(o.client || '').trim();
  if (!name) throw new Error('Enter a project name.');
  if (!client) throw new Error('Choose a client, or type a new client name.');
  var status = PROJECT_STATUSES_.indexOf(o.status) >= 0 ? o.status : 'Confirmed', line = o.business_line === 'AI data' ? 'AI data' : 'Production';
  withLock_(function () {
    var projects = read_('Projects').filter(function (p) { return p.id; });
    if (projects.some(function (p) { return String(p.name).toLowerCase() === name.toLowerCase() && String(p.id) !== String(o.id || ''); })) throw new Error('A project called "' + name + '" already exists.');
    if (!findRow_('Clients', 'name', client)) { ensureClient_(u, client); out.client = findRow_('Clients', 'name', client); }
    var id = String(o.id || '');
    if (id) {
      if (!projects.some(function (p) { return String(p.id) === id; })) throw new Error('Project not found.');
      out.project = upsert_(u, 'Projects', 'id', { id: id, name: name, client: client, status: status, business_line: line }, 'Project edited');
    } else {
      var seq = nextSeq_(projects, 'P', 3);
      id = seq.make();
      while (projects.some(function (p) { return String(p.id) === id; })) id = seq.make();
      out.project = upsert_(u, 'Projects', 'id', { id: id, name: name, client: client, status: status, business_line: line }, 'Project created');
    }
  });
  afterWriteSoon_();
  return out;
}