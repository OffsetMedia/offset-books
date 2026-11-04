/**
 * Offset Books — editing actions for the app (projects, costs, income, split bills).
 *
 * Self-contained: it verifies the Google sign-in token itself and only answers the
 * actions listed in OBW_ACTIONS. Every other call falls through to the existing Api.gs.
 *
 * Install: add this file to the Apps Script project, then make this the FIRST line
 * inside the existing doPost(e) in Api.gs:
 *
 *     var w = obwHandle(e); if (w) return w;
 *
 * Then Deploy > Manage deployments > edit the existing deployment > Version: New version > Deploy
 * (editing the existing deployment keeps the same /exec URL).
 */

var OBW_DB_ID = '1tT-DdhMjYy6ooIvtvXtJN2iHtJnLfNEibEBcefPUEt8';
var OBW_CLIENT_ID = '658345018959-tob931lkbajrtvmf8t9j2600bggqbk3j.apps.googleusercontent.com';
var OBW_DOMAIN = 'offset-media.com';

var OBW_ACTIONS = {
  obwMeta: obwMeta_,
  obwSaveEntry: obwSaveEntry_,
  obwDeleteEntry: obwDeleteEntry_,
  obwSaveBill: obwSaveBill_,
  obwSaveProject: obwSaveProject_,
  obwSaveClient: obwSaveClient_,
  obwUploadBill: obwUploadBill_,
  obwDecideBill: obwDecideBill_,
  obwBillFile: obwBillFile_,
  obwInbox: obwInbox_,
  obwRunAudit: obwRunAudit_,
  obwInboxAction: obwInboxAction_,
  obwShoots: obwShoots_,
  obwSaveShoot: obwSaveShoot_,
  obwDeleteShoot: obwDeleteShoot_,
  obwPlanShoots: obwPlanShoots_,
  obwShootsToBudget: obwShootsToBudget_
};

// Fields the app may write. Anything else in a request is ignored.
var OBW_ENTRY_FIELDS = ['date', 'kind', 'account', 'amount', 'business_line', 'project', 'shoot', 'cost_type', 'payee',
  'description', 'payment_method', 'paid_status', 'paid_date', 'doc_url', 'doc_status', 'bank_line_id', 'notes',
  'paid_amount', 'doc_number', 'bill_id', 'allocation'];
var OBW_PROJECT_FIELDS = ['name', 'client', 'business_line', 'property', 'start', 'end', 'status', 'agreed_fee',
  'budget_equipment_rental', 'budget_crew', 'budget_transport', 'budget_food', 'budget_location', 'budget_other',
  'notes', 'budget_url', 'budget_planned'];
var OBW_NUMERIC = { amount: 1, paid_amount: 1, agreed_fee: 1, budget_equipment_rental: 1, budget_crew: 1, budget_transport: 1,
  budget_food: 1, budget_location: 1, budget_other: 1, budget_planned: 1 };
// Columns this file adds to Entries the first time it writes (appended at the far right).
var OBW_EXTRA_ENTRY_COLS = ['bill_id', 'allocation'];

/* ---------------- entry point ---------------- */

function obwHandle(e) {
  var body;
  try { body = JSON.parse(e && e.postData && e.postData.contents); } catch (x) { return null; }
  if (!body || !Object.prototype.hasOwnProperty.call(OBW_ACTIONS, body.fn)) return null;
  try {
    var user = obwAuth_(body.token);
    var data = OBW_ACTIONS[body.fn](user, body.args || []);
    return obwOut_({ ok: true, data: data });
  } catch (err) {
    return obwOut_({ ok: false, error: String(err && err.message || err), code: (err && err.code) || 'error' });
  }
}

function obwOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function obwErr_(msg, code) { var e = new Error(msg); e.code = code || 'error'; return e; }

/* ---------------- sign-in check ---------------- */

function obwAuth_(token) {
  if (!token) throw obwErr_('Please sign in again.', 'auth');
  var cache = CacheService.getScriptCache();
  var key = 'obw_tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  var email = cache.get(key);
  if (!email) {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw obwErr_('Your sign-in has expired. Please sign in again.', 'auth');
    var info = JSON.parse(res.getContentText());
    if (info.aud !== OBW_CLIENT_ID || info.hd !== OBW_DOMAIN || String(info.email_verified) !== 'true') throw obwErr_('This account cannot use Offset Books.', 'noaccess');
    if (Number(info.exp) * 1000 < Date.now()) throw obwErr_('Your sign-in has expired. Please sign in again.', 'auth');
    email = String(info.email).toLowerCase();
    cache.put(key, email, 300);
  }
  var users = obwTable_('Users').rows;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email).toLowerCase() === email) return { email: email, name: users[i].name, role: String(users[i].role).toLowerCase() };
  }
  throw obwErr_('This account is not set up in Offset Books.', 'noaccess');
}

function obwRequireAdmin_(user) {
  if (user.role !== 'admin') throw obwErr_('Only the admin can make this change.', 'forbidden');
}

/* ---------------- sheet helpers ---------------- */

function obwSs_() { return SpreadsheetApp.openById(OBW_DB_ID); }

function obwTable_(name) {
  var sh = obwSs_().getSheetByName(name);
  if (!sh) throw obwErr_('The ' + name + ' tab is missing.');
  var values = sh.getDataRange().getDisplayValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) if (headers[c]) o[headers[c]] = values[r][c];
    rows.push(o);
  }
  return { sh: sh, headers: headers, rows: rows };
}

function obwEnsureCols_(t, cols) {
  cols.forEach(function (col) {
    if (t.headers.indexOf(col) === -1) {
      t.headers.push(col);
      t.sh.getRange(1, t.headers.length).setValue(col);
    }
  });
}

function obwClean_(field, v) {
  if (v == null) return '';
  if (OBW_NUMERIC[field]) {
    if (v === '') return '';
    var n = Number(String(v).replace(/,/g, ''));
    if (!isFinite(n)) throw obwErr_('"' + field + '" must be a number.');
    return Math.round(n * 100) / 100;
  }
  return String(v).trim();
}

function obwRowArray_(t, obj) {
  return t.headers.map(function (h) { return obj[h] == null ? '' : obj[h]; });
}

/** Writes only the changed cells of an existing row, so formulas and other columns are left alone. */
function obwWriteCells_(t, rowNum, obj, fields) {
  fields.forEach(function (f) {
    var c = t.headers.indexOf(f);
    if (c !== -1) t.sh.getRange(rowNum, c + 1).setValue(obj[f] == null ? '' : obj[f]);
  });
}

function obwNextId_(rows, prefix, width) {
  var max = 0, re = new RegExp('^' + prefix + '(\\d+)$');
  rows.forEach(function (r) { var m = re.exec(String(r.id)); if (m) max = Math.max(max, Number(m[1])); });
  var s = String(max + 1); while (s.length < width) s = '0' + s;
  return prefix + s;
}

function obwAudit_(user, tab, record, field, oldV, newV, reason) {
  var sh = obwSs_().getSheetByName('AuditLog');
  if (!sh) return;
  sh.appendRow([obwNow_(), user.email, tab, record, field, oldV == null ? '' : String(oldV), newV == null ? '' : String(newV), reason || '']);
}

function obwNow_() { return Utilities.formatDate(new Date(), 'Asia/Colombo', 'yyyy-MM-dd HH:mm'); }

function obwPublic_(o) { var c = {}; for (var k in o) if (k !== '_row') c[k] = o[k]; return c; }

function obwStrip_(o, headers) { var c = {}; headers.forEach(function (h) { if (h) c[h] = o[h] == null ? '' : o[h]; }); return c; }

function obwLock_() { var l = LockService.getScriptLock(); l.waitLock(20000); return l; }

/* ---------------- accounts ---------------- */

function obwCostMap_() {
  var map = {};
  obwTable_('CostTypeMap').rows.forEach(function (r) { if (r.cost_type) map[r.cost_type] = { project: String(r.project_account || ''), overhead: String(r.overhead_account || '') }; });
  return map;
}

/** Account code for an entry, following the chart of accounts and CostTypeMap. */
function obwAutoAccount_(e, map) {
  if (e.kind === 'income') {
    if (e.business_line === 'AI data') return '4020';
    return e.project ? '4010' : '4090';
  }
  var m = map[e.cost_type];
  if (!m) return '';
  return (e.project ? (m.project || m.overhead) : (m.overhead || m.project)) || '';
}

/* ---------------- actions ---------------- */

/** Lists the app needs for its forms, plus the extra columns this file manages. */
function obwMeta_(user) {
  var map = obwCostMap_();
  var e = obwTable_('Entries');
  var extras = {};
  if (e.headers.indexOf('bill_id') !== -1 || e.headers.indexOf('allocation') !== -1) {
    e.rows.forEach(function (r) { if (r.bill_id || r.allocation) extras[r.id] = { bill_id: r.bill_id || '', allocation: r.allocation || '' }; });
  }
  var clients = [];
  try { clients = obwTable_('Clients').rows.map(function (r) { return r.name; }).filter(String); } catch (x) { /* optional */ }
  var accounts = [];
  try { accounts = obwTable_('Accounts').rows.map(obwPublic_); } catch (x) { /* optional */ }
  var clientRows = [];
  try { clientRows = obwTable_('Clients').rows.map(obwPublic_).filter(function (c) { return c.name; }); } catch (x) { /* optional */ }
  var quotes = [];
  try { quotes = obwTable_('Quotes').rows.map(obwPublic_).filter(function (q) { return q.number; }); } catch (x) { /* optional */ }
  var reviews = [];
  if (user.role === 'admin') {
    try {
      reviews = obwTable_('Approvals').rows.filter(function (a) { return a.source === 'bill_upload' && a.status === 'pending'; })
        .map(function (a) { var o = obwPublic_(a); try { o.suggestion = JSON.parse(a.suggestion); } catch (x) { o.suggestion = {}; } return o; });
    } catch (x) { /* optional */ }
  }
  return { costTypes: map, clients: clients, clientRows: clientRows, quotes: quotes, reviews: reviews, accounts: accounts, extras: extras, canEdit: user.role === 'admin' };
}

/** Adds (no id) or updates (with id) one cost or income line. */
function obwSaveEntry_(user, args) {
  obwRequireAdmin_(user);
  var input = args[0] || {}, reason = args[1] || '';
  var lock = obwLock_();
  try {
    var t = obwTable_('Entries');
    obwEnsureCols_(t, OBW_EXTRA_ENTRY_COLS);
    var map = obwCostMap_();
    var existing = null;
    if (input.id) {
      for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].id) === String(input.id)) { existing = t.rows[i]; break; }
      if (!existing) throw obwErr_('Entry ' + input.id + ' was not found. Refresh and try again.');
    }
    var next = existing ? obwStrip_(existing, t.headers) : {};
    OBW_ENTRY_FIELDS.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(input, f)) next[f] = obwClean_(f, input[f]); });
    if (input.auto_account || !next.account) next.account = obwAutoAccount_(next, map) || next.account;
    obwValidateEntry_(next);
    if (existing) obwAssertOpen_(existing.date);
    obwAssertOpen_(next.date);

    if (existing) {
      var changes = [];
      t.headers.forEach(function (h) { if (String(existing[h] == null ? '' : existing[h]) !== String(next[h] == null ? '' : next[h])) changes.push(h); });
      if (!changes.length) return obwStrip_(next, t.headers);
      obwWriteCells_(t, existing._row, next, changes);
      changes.forEach(function (h) { obwAudit_(user, 'Entries', next.id, h, existing[h], next[h], reason || 'Edited in app'); });
    } else {
      next.id = obwNextId_(t.rows, 'E', 4);
      next.created_by = user.email;
      next.created_at = obwNow_();
      t.sh.appendRow(obwRowArray_(t, next));
      obwAudit_(user, 'Entries', next.id, '(new row)', '', JSON.stringify(next), reason || 'Added in app');
    }
    return obwStrip_(next, t.headers);
  } finally { lock.releaseLock(); }
}

/** Same rule as Code.gs: entries in a month the accountant locked cannot change until the admin reopens it. */
function obwAssertOpen_(date) {
  var ym = String(date || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return;
  var rows = [];
  try { rows = obwTable_('Months').rows; } catch (x) { return; }
  var m = rows.filter(function (r) { return String(r.month).slice(0, 7) === ym; })[0];
  if (m && String(m.status) === 'locked') throw obwErr_('The books for ' + ym + ' are locked. Reopen the month before changing it.');
}

function obwValidateEntry_(e) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date))) throw obwErr_('Date must be YYYY-MM-DD.');
  if (['cost', 'income', 'asset', 'loan', 'transfer'].indexOf(String(e.kind)) === -1) throw obwErr_('Type must be cost or income.');
  if (e.amount === '' || !isFinite(Number(e.amount))) throw obwErr_('Amount is required.');
  if (e.paid_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.paid_date))) throw obwErr_('Paid date must be YYYY-MM-DD.');
}

/** Deletes one line. The full old row goes to AuditLog so it can be restored by hand. */
function obwDeleteEntry_(user, args) {
  obwRequireAdmin_(user);
  var id = String(args[0] || ''), reason = args[1] || 'Deleted in app';
  var lock = obwLock_();
  try {
    var t = obwTable_('Entries');
    for (var i = 0; i < t.rows.length; i++) {
      if (String(t.rows[i].id) === id) {
        obwAssertOpen_(t.rows[i].date);
        obwAudit_(user, 'Entries', id, '(deleted)', JSON.stringify(obwStrip_(t.rows[i], t.headers)), '', reason);
        t.sh.deleteRow(t.rows[i]._row);
        return { id: id };
      }
    }
    throw obwErr_('Entry ' + id + ' was not found. Refresh and try again.');
  } finally { lock.releaseLock(); }
}

/**
 * Saves a supplier bill split across projects (e.g. one TG invoice covering two shoots).
 * args[0] = { replace_ids: [...existing entry ids this bill replaces, optional],
 *             header: { date, payee, doc_number, doc_url, doc_status, payment_method, paid_status, paid_date, bank_line_id, notes, business_line },
 *             total: number,
 *             lines: [{ project, shoot, cost_type, description, amount }] }
 * The lines must add up to the total. Each line becomes one cost entry, all sharing a bill_id.
 */
function obwSaveBill_(user, args) {
  obwRequireAdmin_(user);
  var bill = args[0] || {}, reason = args[1] || '';
  var h = bill.header || {}, lines = bill.lines || [], replace = (bill.replace_ids || []).map(String);
  if (!lines.length) throw obwErr_('Add at least one line.');
  var total = obwClean_('amount', bill.total), sum = 0;
  lines.forEach(function (l) { sum += Number(obwClean_('amount', l.amount)) || 0; });
  if (total === '' || Math.abs(sum - Number(total)) > 0.01) throw obwErr_('The lines add up to ' + sum.toFixed(2) + ' but the bill total is ' + total + '.');

  var lock = obwLock_();
  try {
    var t = obwTable_('Entries');
    obwEnsureCols_(t, OBW_EXTRA_ENTRY_COLS);
    var map = obwCostMap_();
    var old = t.rows.filter(function (r) { return replace.indexOf(String(r.id)) !== -1; });
    if (old.length !== replace.length) throw obwErr_('Some of the lines being split were not found. Refresh and try again.');
    old.forEach(function (r) { obwAssertOpen_(r.date); });
    obwAssertOpen_(h.date || (old[0] && old[0].date));

    var billId = (old[0] && old[0].bill_id) || ('B' + Utilities.formatDate(new Date(), 'Asia/Colombo', 'yyMMddHHmmss'));
    var base = old[0] ? obwStrip_(old[0], t.headers) : {};
    var added = [], nextNum = Number(obwNextId_(t.rows, 'E', 4).slice(1));

    lines.forEach(function (l) {
      var e = {};
      ['date', 'payee', 'doc_number', 'doc_url', 'doc_status', 'payment_method', 'paid_status', 'paid_date', 'bank_line_id', 'notes', 'business_line']
        .forEach(function (f) { e[f] = obwClean_(f, h[f] != null ? h[f] : base[f]); });
      e.kind = 'cost';
      e.business_line = e.business_line || 'Production';
      e.project = obwClean_('project', l.project);
      e.shoot = obwClean_('shoot', l.shoot);
      e.cost_type = obwClean_('cost_type', l.cost_type);
      e.description = obwClean_('description', l.description || h.description || base.description);
      e.amount = obwClean_('amount', l.amount);
      e.account = obwAutoAccount_(e, map);
      e.bill_id = billId;
      e.allocation = e.project ? '' : 'overhead';
      var s = String(nextNum++); while (s.length < 4) s = '0' + s;
      e.id = 'E' + s;
      e.created_by = user.email;
      e.created_at = obwNow_();
      obwValidateEntry_(e);
      added.push(e);
    });

    // Delete replaced rows from the bottom up so row numbers stay valid.
    old.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) {
      obwAudit_(user, 'Entries', r.id, '(replaced by split bill ' + billId + ')', JSON.stringify(obwStrip_(r, t.headers)), '', reason || 'Bill split in app');
      t.sh.deleteRow(r._row);
    });
    var rowsOut = added.map(function (e) { return obwRowArray_(t, e); });
    var start = t.sh.getLastRow() + 1;
    t.sh.getRange(start, 1, rowsOut.length, t.headers.length).setValues(rowsOut);
    added.forEach(function (e) { obwAudit_(user, 'Entries', e.id, '(new row)', '', JSON.stringify(e), reason || ('Bill ' + billId + ' saved in app')); });

    return { bill_id: billId, removed: replace, added: added.map(function (e) { return obwStrip_(e, t.headers); }) };
  } finally { lock.releaseLock(); }
}

/** Adds (no id) or updates (with id) a project, including fee and budgets. */
function obwSaveProject_(user, args) {
  obwRequireAdmin_(user);
  var input = args[0] || {}, reason = args[1] || '';
  var lock = obwLock_();
  try {
    var t = obwTable_('Projects');
    var existing = null;
    if (input.id) {
      for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].id) === String(input.id)) { existing = t.rows[i]; break; }
      if (!existing) throw obwErr_('Project ' + input.id + ' was not found. Refresh and try again.');
    }
    var next = existing ? obwStrip_(existing, t.headers) : { business_line: 'Production', status: 'In production' };
    OBW_PROJECT_FIELDS.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(input, f) && t.headers.indexOf(f) !== -1) next[f] = obwClean_(f, input[f]); });
    if (!next.name) throw obwErr_('Project name is required.');
    ['start', 'end'].forEach(function (f) { if (next[f] && !/^\d{4}-\d{2}-\d{2}$/.test(String(next[f]))) throw obwErr_(f + ' date must be YYYY-MM-DD.'); });

    if (existing) {
      var changes = t.headers.filter(function (h) { return String(existing[h] == null ? '' : existing[h]) !== String(next[h] == null ? '' : next[h]); });
      if (changes.length) {
        obwWriteCells_(t, existing._row, next, changes);
        changes.forEach(function (h) { obwAudit_(user, 'Projects', next.id, h, existing[h], next[h], reason || 'Edited in app'); });
      }
    } else {
      next.id = obwNextId_(t.rows, 'P', 3);
      t.sh.appendRow(obwRowArray_(t, next));
      obwAudit_(user, 'Projects', next.id, '(new row)', '', JSON.stringify(next), reason || 'Added in app');
    }
    return obwStrip_(next, t.headers);
  } finally { lock.releaseLock(); }
}


/* ================= clients ================= */

var OBW_CLIENT_FIELDS = ['type', 'contact', 'phone', 'email', 'notes'];

/** Adds a client (no original_name) or updates a client's details (original_name = its current name). */
function obwSaveClient_(user, args) {
  obwRequireAdmin_(user);
  var input = args[0] || {};
  var lock = obwLock_();
  try {
    var t = obwTable_('Clients'), existing = null, key = String(input.original_name || '').trim();
    if (key) {
      for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].name).trim() === key) { existing = t.rows[i]; break; }
      if (!existing) throw obwErr_('Client "' + key + '" was not found. Refresh and try again.');
      if (input.name && String(input.name).trim() !== key) throw obwErr_('Renaming a client is not supported yet, because projects and invoices refer to the name.');
    }
    var next = existing ? obwStrip_(existing, t.headers) : {};
    if (!existing) {
      next.name = String(input.name || '').trim();
      if (!next.name) throw obwErr_('Client name is required.');
      if (t.rows.some(function (r) { return String(r.name).trim().toLowerCase() === next.name.toLowerCase(); })) throw obwErr_('A client called "' + next.name + '" already exists.');
    }
    OBW_CLIENT_FIELDS.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(input, f) && t.headers.indexOf(f) !== -1) next[f] = obwClean_(f, input[f]); });
    if (existing) {
      var changes = t.headers.filter(function (h) { return String(existing[h] == null ? '' : existing[h]) !== String(next[h] == null ? '' : next[h]); });
      if (changes.length) {
        obwWriteCells_(t, existing._row, next, changes);
        changes.forEach(function (h) { obwAudit_(user, 'Clients', next.name, h, existing[h], next[h], 'Edited in app'); });
      }
    } else {
      t.sh.appendRow(obwRowArray_(t, next));
      obwAudit_(user, 'Clients', next.name, '(new row)', '', JSON.stringify(next), 'Added in app');
    }
    return obwStrip_(next, t.headers);
  } finally { lock.releaseLock(); }
}

/* ================= bills read by Claude ================= */

var OBW_PRICES = { // USD per million tokens [input, output]
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-sonnet-5-5': [2, 10]
};

function obwSettings_() {
  var o = {};
  obwTable_('Settings').rows.forEach(function (r) { if (r.key) o[r.key] = r.value; });
  return o;
}

function obwClaudeKey_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var names = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'anthropic_api_key', 'claude_api_key', 'ANTHROPIC_KEY', 'CLAUDE_KEY'];
  for (var i = 0; i < names.length; i++) if (props[names[i]]) return props[names[i]];
  for (var k in props) if (/^sk-ant-/.test(String(props[k]))) return props[k];
  throw obwErr_('No Claude API key found in Script Properties.');
}

function obwMonthSpend_() {
  var month = Utilities.formatDate(new Date(), 'Asia/Colombo', 'yyyy-MM'), used = 0;
  try { obwTable_('AIUsage').rows.forEach(function (r) { if (String(r.time).slice(0, 7) === month) used += Number(r.cost_usd) || 0; }); } catch (x) { /* none yet */ }
  return used;
}

function obwCallClaude_(model, system, content, purpose) {
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': obwClaudeKey_(), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: model, max_tokens: 2500, system: system, messages: [{ role: 'user', content: content }] })
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200) throw obwErr_('Claude could not read the document: ' + ((body.error && body.error.message) || res.getResponseCode()));
  var u = body.usage || {}, price = OBW_PRICES[model] || [2, 10];
  var cost = ((u.input_tokens || 0) * price[0] + (u.output_tokens || 0) * price[1]) / 1e6;
  var sh = obwSs_().getSheetByName('AIUsage');
  if (sh) sh.appendRow([obwNow_(), model, u.input_tokens || 0, u.output_tokens || 0, cost.toFixed(6), purpose]);
  return (body.content || []).map(function (c) { return c.text || ''; }).join('');
}

function obwParseJson_(text) {
  var a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (x) { return null; }
}

function obwCalendarLines_(settings) {
  var out = [], ids = String(settings.calendar_ids || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  var start = new Date(Date.now() - 150 * 86400000), end = new Date(Date.now() + 30 * 86400000);
  ids.forEach(function (id) {
    try {
      var cal = CalendarApp.getCalendarById(id); if (!cal) return;
      cal.getEvents(start, end).forEach(function (ev) {
        out.push(Utilities.formatDate(ev.getStartTime(), 'Asia/Colombo', 'yyyy-MM-dd') + ' | ' + ev.getTitle());
      });
    } catch (x) { /* calendar not shared or no permission: skip */ }
  });
  out.sort();
  return out.slice(-250);
}

function obwBillContext_() {
  var settings = obwSettings_(), entries = obwTable_('Entries').rows, projects = obwTable_('Projects').rows;
  var payees = {}, history = [];
  entries.forEach(function (e) { if (e.payee) payees[e.payee] = 1; });
  entries.filter(function (e) { return e.kind === 'cost' && e.project; }).slice(-90).forEach(function (e) {
    history.push([e.date, e.payee, e.project, e.shoot, e.cost_type, e.amount, e.description].join(' | '));
  });
  return {
    settings: settings,
    projects: projects.map(function (p) { return [p.id, p.name, p.client, p.start, p.end || '-', p.status].join(' | '); }),
    payees: Object.keys(payees),
    history: history,
    calendar: obwCalendarLines_(settings),
    costTypes: Object.keys(obwCostMap_())
  };
}

function obwBillSystem_(ctx) {
  return [
    'You read supplier bills (invoices and receipts) for Offset Media (Pvt) Ltd, a photo and video production company in Sri Lanka. Amounts are LKR.',
    'Return ONLY one JSON object, no other text, with this shape:',
    '{"supplier": string (the name as printed), "payee": string (the matching name from KNOWN PAYEES if one fits, else the printed name),',
    ' "doc_number": string, "date": "YYYY-MM-DD", "total": number, "currency": "LKR",',
    ' "lines": [{"date": "YYYY-MM-DD" or "", "description": string, "amount": number, "cost_type": one of COST TYPES, "project": a project id like "P002" or "" for company overhead, "shoot": string, "reason": string}],',
    ' "confidence": "high" | "medium" | "low", "notes": string}',
    'Rules:',
    '- The lines must add up exactly to the total. Group the bill\'s items into one line per project (and per shoot day when the bill lists days).',
    '- Pick each line\'s project from the shoot calendar (what was shot on that date), the project dates, and how this supplier was split before (HISTORY). Rental houses like TG Camera bill per day.',
    '- If you cannot tell which project a line belongs to, leave project "" and say why in reason. Never invent a project id.',
    '- confidence is "low" if any amount, date or total is hard to read or the lines do not clearly map to projects.',
    '- Payee aliases: ' + (ctx.settings.payee_aliases || ''),
    '',
    'COST TYPES: ' + ctx.costTypes.join(', '),
    'PROJECTS (id | name | client | start | end | status):', ctx.projects.join('\n'),
    'KNOWN PAYEES: ' + ctx.payees.join('; '),
    'HISTORY of project costs (date | payee | project | shoot | cost type | amount | description):', ctx.history.join('\n'),
    'SHOOT CALENDAR (date | event):', ctx.calendar.join('\n') || '(none available)'
  ].join('\n');
}

function obwFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function obwFyLabel_(dateStr) {
  var d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
  var start = m >= 4 ? y : y - 1;
  return 'FY ' + start + '-' + String(start + 1).slice(2);
}

function obwBillsRoot_(settings, dateStr) {
  var root = DriveApp.getFolderById(settings.drive_root_id);
  return obwFolder_(obwFolder_(root, obwFyLabel_(dateStr)), 'Bills in');
}

/** Saves one uploaded bill to Drive, has Claude read it, and queues it for review. args[0] = {name, mime, data (base64)} */
function obwUploadBill_(user, args) {
  obwRequireAdmin_(user);
  var f = args[0] || {};
  if (!f.data) throw obwErr_('No file received.');
  var mime = String(f.mime || '');
  if (!/^application\/pdf$|^image\/(jpeg|png|webp|gif)$/.test(mime)) throw obwErr_('Upload a PDF or a photo (JPG or PNG).');
  var settings = obwSettings_();
  var budget = Number(settings.claude_monthly_budget_usd) || 4;
  if (obwMonthSpend_() >= budget) throw obwErr_('This month\'s Claude budget (USD ' + budget + ') is used up. Raise claude_monthly_budget_usd in Settings to keep reading bills.');

  var blob = Utilities.newBlob(Utilities.base64Decode(f.data), mime, f.name || ('bill.' + (mime === 'application/pdf' ? 'pdf' : 'jpg')));
  var file = obwFolder_(obwBillsRoot_(settings, ''), '_To review').createFile(blob);

  var ctx = obwBillContext_(), system = obwBillSystem_(ctx);
  var doc = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: f.data } };
  var content = [doc, { type: 'text', text: 'Read this bill and return the JSON.' }];
  var fast = settings.claude_model_fast || 'claude-haiku-5-5', strong = settings.claude_model_strong || 'claude-sonnet-5-5';

  var model = fast, s = obwParseJson_(obwCallClaude_(fast, system, content, 'read bill ' + file.getName()));
  if (!obwBillOk_(s) && obwMonthSpend_() < budget) {
    model = strong;
    var s2 = obwParseJson_(obwCallClaude_(strong, system, content, 'read bill (second opinion) ' + file.getName()));
    if (s2) s = s2;
  }
  s = s || { lines: [], confidence: 'low', notes: 'Claude could not read this document. Fill it in by hand.' };
  s.model = model;
  s.file_id = file.getId();
  s.file_url = file.getUrl();
  s.file_name = file.getName();
  s.mime = mime;
  s.matches = obwBillMatches_(s);

  var lock = obwLock_();
  try {
    var t = obwTable_('Approvals');
    var id = obwNextId_(t.rows, 'AP', 4), first = (s.lines && s.lines[0]) || {};
    var row = { id: id, bank_line: '', suggestion: JSON.stringify(s), status: 'pending', created_at: obwNow_(), source: 'bill_upload',
      submitted_by: user.email, submitted_at: obwNow_(), kind: 'cost', date: s.date || '', amount: s.total || '', payee: s.payee || s.supplier || '',
      description: (s.doc_number ? s.doc_number + ' ' : '') + (first.description || ''), project: first.project || '' };
    t.sh.appendRow(obwRowArray_(t, row));
    row.suggestion = s;
    return row;
  } finally { lock.releaseLock(); }
}

function obwBillOk_(s) {
  if (!s || !s.lines || !s.lines.length || !isFinite(Number(s.total))) return false;
  var sum = 0; s.lines.forEach(function (l) { sum += Number(l.amount) || 0; });
  return Math.abs(sum - Number(s.total)) < 0.01 && s.confidence !== 'low';
}

/** Possible duplicates (same invoice number already booked) and bank payments this bill may belong to. */
function obwBillMatches_(s) {
  var entries = obwTable_('Entries').rows, out = { duplicates: [], payments: [] };
  var doc = String(s.doc_number || '').trim().toLowerCase(), total = Number(s.total) || 0;
  var word = String(s.payee || s.supplier || '').toLowerCase().split(/[\s(]/)[0];
  var bd = s.date ? new Date(s.date + 'T00:00:00').getTime() : 0;
  entries.forEach(function (e) {
    if (e.kind !== 'cost') return;
    var hay = (String(e.doc_number) + ' ' + String(e.doc_status) + ' ' + String(e.description) + ' ' + String(e.notes)).toLowerCase();
    if (doc && doc.length >= 3 && hay.indexOf(doc) !== -1) out.duplicates.push(e.id);
    var amt = Number(String(e.amount).replace(/,/g, '')) || 0;
    var ed = e.date ? new Date(e.date + 'T00:00:00').getTime() : 0;
    var near = !bd || !ed || (ed - bd > -5 * 86400000 && ed - bd < 45 * 86400000);
    var samePayee = word && String(e.payee).toLowerCase().indexOf(word) !== -1;
    if (!e.doc_url && near && total && Math.abs(amt - total) < 1 && (samePayee || !e.project)) out.payments.push(e.id);
  });
  out.payments = out.payments.slice(0, 5);
  return out;
}

/**
 * Approve or reject a bill Claude read.
 * args = [approvalId, 'approve' | 'reject', billPayload (same shape as obwSaveBill, for approve)]
 */
function obwDecideBill_(user, args) {
  obwRequireAdmin_(user);
  var id = String(args[0] || ''), decision = args[1], bill = args[2] || {};
  var t = obwTable_('Approvals'), a = null;
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].id) === id) { a = t.rows[i]; break; }
  if (!a) throw obwErr_('Review item ' + id + ' was not found. Refresh and try again.');
  if (a.status !== 'pending') throw obwErr_('This bill was already ' + a.status + '.');
  var s = {}; try { s = JSON.parse(a.suggestion); } catch (x) { /* keep empty */ }
  var settings = obwSettings_(), result = null, file = null;
  try { file = DriveApp.getFileById(s.file_id); } catch (x) { /* file gone */ }

  if (decision === 'approve') {
    bill.header = bill.header || {};
    if (file) { bill.header.doc_url = file.getUrl(); bill.header.doc_status = 'invoice'; }
    result = obwSaveBill_(user, [bill, 'Bill ' + (bill.header.doc_number || '') + ' approved from upload ' + id]);
    if (file) {
      try {
        var h = bill.header, first = (bill.lines && bill.lines[0]) || {};
        var typeFolder = { 'Equipment rental': 'Rentals', 'Crew / freelancer': 'Crew', 'Location & venue': 'Studios', 'Other': 'Props' }[first.cost_type] || 'Other';
        var supplier = String(h.payee || 'Supplier').replace(/[\\\/:*?"<>|]/g, '').trim();
        var dest = obwFolder_(obwFolder_(obwBillsRoot_(settings, h.date), typeFolder), supplier);
        var ext = (String(s.file_name || '').match(/\.[a-z0-9]+$/i) || ['.pdf'])[0];
        file.setName([h.date, supplier.replace(/\s+/g, ''), String(h.doc_number || 'nodoc').replace(/[\\\/:*?"<>|\s]/g, ''), Math.round(Number(bill.total) || 0)].join('_') + ext);
        file.moveTo(dest);
      } catch (x) { /* filing is best-effort; the entry still links the file */ }
    }
  } else if (decision === 'reject') {
    if (file) { try { file.moveTo(obwFolder_(obwBillsRoot_(settings, ''), '_Rejected')); } catch (x) { /* ignore */ } }
  } else throw obwErr_('Unknown decision.');

  var lock = obwLock_();
  try {
    t = obwTable_('Approvals');
    for (var j = 0; j < t.rows.length; j++) if (String(t.rows[j].id) === id) {
      var r = t.rows[j], next = obwStrip_(r, t.headers);
      next.status = decision === 'approve' ? 'approved' : 'rejected';
      next.decided_by = user.email; next.decided_at = obwNow_();
      if (result) { s.result = { bill_id: result.bill_id, entries: result.added.map(function (e) { return e.id; }) }; next.suggestion = JSON.stringify(s); }
      obwWriteCells_(t, r._row, next, ['status', 'decided_by', 'decided_at', 'suggestion']);
      obwAudit_(user, 'Approvals', id, 'status', 'pending', next.status, 'Bill review');
      break;
    }
  } finally { lock.releaseLock(); }
  return { id: id, status: decision === 'approve' ? 'approved' : 'rejected', bill: result };
}

/** Returns an uploaded bill's file (base64) for the review preview. Only files queued for review can be fetched. */
function obwBillFile_(user, args) {
  obwRequireAdmin_(user);
  var id = String(args[0] || ''), a = obwTable_('Approvals').rows.filter(function (r) { return String(r.id) === id && r.source === 'bill_upload'; })[0];
  if (!a) throw obwErr_('Review item not found.');
  var s = JSON.parse(a.suggestion || '{}'), file = DriveApp.getFileById(s.file_id), blob = file.getBlob();
  if (blob.getBytes().length > 15 * 1024 * 1024) return { url: file.getUrl(), mime: blob.getContentType(), data: '' };
  return { url: file.getUrl(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}


/* ================= Claude's weekly check and the in-app inbox ================= */

var OBW_INBOX_COLS = ['id', 'time', 'kind', 'title', 'body', 'issues', 'status', 'trigger'];
var OBW_ASSIGNABLE = ['Equipment rental', 'Crew / freelancer', 'Location & venue'];

function obwInboxTable_() {
  var ss = obwSs_(), sh = ss.getSheetByName('Inbox');
  if (!sh) { sh = ss.insertSheet('Inbox'); sh.getRange(1, 1, 1, OBW_INBOX_COLS.length).setValues([OBW_INBOX_COLS]); sh.setFrozenRows(1); }
  return obwTable_('Inbox');
}

function obwDismissed_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('OBW_DISMISSED') || '{}'); } catch (x) { return {}; }
}

function obwNum_(v) { var n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
function obwDays_(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

/** The checks. Each issue: { key, severity: high|medium|low, title, detail, action: { type, id } } */
function obwAuditIssues_() {
  var today = Utilities.formatDate(new Date(), 'Asia/Colombo', 'yyyy-MM-dd');
  var st = obwSettings_(), E = obwTable_('Entries').rows, P = obwTable_('Projects').rows, I = obwTable_('Invoices').rows.filter(function (i) { return i.number; });
  var issues = [], money = function (n) { return Math.round(n).toLocaleString('en-US'); };
  function add(key, sev, title, detail, action) { issues.push({ key: key, severity: sev, title: title, detail: detail, action: action || null }); }
  var invByNo = {}; I.forEach(function (i) { invByNo[i.number] = i; });

  // 1. income lines that point at a missing invoice, or at an invoice for a different client
  var perInv = {};
  E.forEach(function (e) {
    if (e.kind !== 'income') return;
    var m = /INV-\d+/.exec(String(e.description || '')); if (!m) return;
    var no = m[0], inv = invByNo[no];
    (perInv[no] = perInv[no] || []).push(e);
    if (!inv) add('inc-noinv-' + e.id, 'high', e.id + ' points at ' + no + ', which is not in Invoices', 'LKR ' + money(obwNum_(e.amount)) + ' from ' + e.payee + ' on ' + e.date + ' is counted as income, but there is no such invoice. If it was a test or a deleted invoice, delete this line.', { type: 'entry', id: e.id });
    else if (inv.client && e.payee && String(inv.client).trim() !== String(e.payee).trim() && inv.client.indexOf(e.payee) === -1 && e.payee.indexOf(inv.client) === -1)
      add('inc-client-' + e.id, 'high', e.id + ' says ' + no + ' is from ' + e.payee + ', but that invoice is billed to ' + inv.client, 'Two different documents may share one number. Check which is right and fix or delete the line.', { type: 'entry', id: e.id });
  });
  Object.keys(perInv).forEach(function (no) {
    var inv = invByNo[no]; if (!inv) return;
    var sum = perInv[no].reduce(function (t, e) { return t + obwNum_(e.amount); }, 0), due = obwNum_(inv.total) - obwNum_(inv.advance_applied);
    if (sum > due + 1) add('inc-double-' + no, 'high', 'Income for ' + no + ' is counted more than once', perInv[no].map(function (e) { return e.id; }).join(', ') + ' add up to LKR ' + money(sum) + ' but the invoice is LKR ' + money(due) + '.', { type: 'search', id: no });
  });

  // 1b. sent invoices with no income line (income would be understated)
  I.forEach(function (inv) {
    if (!/^INV-/.test(inv.number) || inv.status === 'draft' || inv.status === 'void' || inv.status === 'cancelled') return;
    if (!perInv[inv.number]) add('inv-noinc-' + inv.number, 'high', inv.number + ' (' + inv.client + ', LKR ' + money(obwNum_(inv.total)) + ') has no income line', 'The invoice exists but nothing in Entries counts it as income, so profit is understated. Add the income line (open the invoice and mark it sent, or add it in Entries).', { type: 'invoice', id: inv.number });
  });

  // 2. zero-amount lines
  E.forEach(function (e) { if ((e.kind === 'cost' || e.kind === 'income') && obwNum_(e.amount) === 0) add('zero-' + e.id, 'medium', e.id + ' has no amount', e.payee + ': ' + (e.description || '') + (e.notes ? ' (' + e.notes + ')' : ''), { type: 'entry', id: e.id }); });

  // 3. supplier costs with no project
  E.forEach(function (e) {
    if (e.kind === 'cost' && !e.project && e.allocation !== 'overhead' && e.business_line !== 'AI data' && (OBW_ASSIGNABLE.indexOf(e.cost_type) !== -1 || /^5/.test(String(e.account))))
      add('assign-' + e.id, 'medium', e.payee + ' LKR ' + money(obwNum_(e.amount)) + ' has no project', e.date + ' · ' + e.cost_type + '. Assign it, split it across projects, or mark it as overhead.', { type: 'split', id: e.id });
  });

  // 4. possible duplicate costs (same payee and amount within 3 days, not the same bill)
  var costs = E.filter(function (e) { return e.kind === 'cost' && obwNum_(e.amount) > 500; }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  for (var i = 0; i < costs.length; i++) for (var j = i + 1; j < costs.length; j++) {
    var a = costs[i], b = costs[j]; if (obwDays_(a.date, b.date) > 3) break;
    if (a.payee === b.payee && obwNum_(a.amount) === obwNum_(b.amount) && !(a.bill_id && a.bill_id === b.bill_id) && !/uber|pickme/i.test(a.payee))
      add('dup-' + a.id + '-' + b.id, 'medium', 'Possible duplicate: ' + a.id + ' and ' + b.id, a.payee + ', LKR ' + money(obwNum_(a.amount)) + ' on ' + a.date + ' and ' + b.date + '.', { type: 'entry', id: b.id });
  }

  // 5. missing documents, grouped by payee (costs of 5,000+ older than 2 weeks)
  var miss = {};
  E.forEach(function (e) {
    if (e.kind !== 'cost' || e.doc_url || obwNum_(e.amount) < 5000 || obwDays_(e.date, today) < 14) return;
    var ds = String(e.doc_status || '').toLowerCase();
    if (ds && ds !== 'none' && ds !== 'bank line only') return;
    if (/^60[13]0$/.test(String(e.account))) return; // director pay, software: bank line is enough
    var m = miss[e.payee] = miss[e.payee] || { n: 0, amt: 0 }; m.n++; m.amt += obwNum_(e.amount);
  });
  Object.keys(miss).forEach(function (p) { add('doc-' + p, 'low', 'No invoice yet from ' + p, miss[p].n + ' line' + (miss[p].n === 1 ? '' : 's') + ', LKR ' + money(miss[p].amt) + '. Ask for the invoice, then upload it in Entries.', { type: 'search', id: p }); });

  // 6. overdue invoices
  I.forEach(function (inv) {
    if (['sent', 'part paid', 'overdue'].indexOf(inv.status) === -1) return;
    var bal = obwNum_(inv.total) - obwNum_(inv.advance_applied) - obwNum_(inv.paid_amount);
    if (bal > 1 && inv.due && inv.due < today) add('late-' + inv.number, obwDays_(inv.due, today) > 14 ? 'high' : 'medium', inv.number + ' is ' + obwDays_(inv.due, today) + (obwDays_(inv.due, today) === 1 ? ' day' : ' days') + ' overdue', inv.client + ' owes LKR ' + money(bal) + ' (due ' + inv.due + '). Send a reminder or record the payment.', { type: 'invoice', id: inv.number });
  });

  // 7. projects over budget
  var BT = { 'Equipment rental': 'budget_equipment_rental', 'Crew / freelancer': 'budget_crew', 'Transport': 'budget_transport', 'Food': 'budget_food', 'Location & venue': 'budget_location', 'Other': 'budget_other' };
  P.forEach(function (p) {
    Object.keys(BT).forEach(function (ct) {
      var b = obwNum_(p[BT[ct]]); if (!b) return;
      var a = E.filter(function (e) { return e.kind === 'cost' && e.project === p.id && e.cost_type === ct; }).reduce(function (t, e) { return t + obwNum_(e.amount); }, 0);
      if (a > b * 1.0001) add('over-' + p.id + '-' + ct, 'medium', p.name + ': ' + ct + ' is over budget', 'Spent LKR ' + money(a) + ' against a budget of LKR ' + money(b) + '. Update the budget or check the costs.', { type: 'project', id: p.id });
    });
  });

  // 8. withholding tax: payments to one person in one month
  var wht = {}, alertAt = obwNum_(st.wht_alert) || 80000, limit = obwNum_(st.wht_threshold) || 100000;
  E.forEach(function (e) { if (e.kind === 'cost' && /^(5020|6020|6010)$/.test(String(e.account)) && !/joshua/i.test(e.payee)) { var k = e.payee + '|' + String(e.date).slice(0, 7); wht[k] = (wht[k] || 0) + obwNum_(e.amount); } });
  Object.keys(wht).forEach(function (k) {
    var v = wht[k], pp = k.split('|');
    if (v >= alertAt) add('wht-' + k, v > limit ? 'high' : 'low', pp[0] + ': LKR ' + money(v) + ' in ' + pp[1], v > limit ? 'Over LKR ' + money(limit) + ' in one month, so 5% WHT applies on the full amount. Check with the accountant.' : 'Close to the LKR ' + money(limit) + ' WHT limit for this month.', { type: 'search', id: pp[0] });
  });

  // 9. settings sanity
  var vat = String(st.vat_registered || '').toLowerCase();
  if (vat && ['yes', 'no', 'true', 'false'].indexOf(vat) === -1) add('set-vat', 'low', 'Settings: vat_registered says "' + st.vat_registered + '"', 'It should be yes or no. Fix it in the Settings tab.', { type: 'settings' });
  var maxInv = 0; I.forEach(function (x) { var m = /(\d+)$/.exec(x.number); if (m) maxInv = Math.max(maxInv, Number(m[1])); });
  var last = /(\d+)$/.exec(String(st.last_invoice_number || ''));
  if (last && Number(last[1]) < maxInv) add('set-invno', 'high', 'Invoice numbering is behind', 'Settings says the last invoice was ' + st.last_invoice_number + ', but Invoices already has a higher number. The next invoice could reuse a number.', { type: 'settings' });

  // 10. unpaid costs older than 30 days
  E.forEach(function (e) { if (e.kind === 'cost' && e.paid_status === 'unpaid' && obwNum_(e.amount) > 0 && obwDays_(e.date, today) > 30) add('unpaid-' + e.id, 'low', 'Unpaid for ' + obwDays_(e.date, today) + ' days: ' + e.payee + ' LKR ' + money(obwNum_(e.amount)), (e.description || '') + '. Pay it, or mark it paid if it already went out.', { type: 'entry', id: e.id }); });

  // 11. bank: unsorted lines and statement freshness
  try {
    var newLines = obwTable_('BankLines').rows.filter(function (b) { return b.id && String(b.status || 'new') === 'new'; }).length;
    if (newLines) add('bank-new', 'medium', newLines + ' bank line' + (newLines === 1 ? '' : 's') + ' not sorted yet', 'Open Bank and run the sorting so they turn into entries.', { type: 'bank' });
    var stm = obwTable_('Statements').rows.filter(function (x) { return x.id; }).map(function (x) { return String(x.to).slice(0, 10); }).sort();
    var lastTo = stm[stm.length - 1];
    if (lastTo && obwDays_(lastTo, today) > 9) add('bank-old', 'low', 'Latest bank statement ends ' + lastTo, 'Upload this week\'s HNB statement on the Bank page.', { type: 'bank' });
  } catch (x) { /* bank tabs optional */ }

  // 12. approvals waiting
  try {
    var A = obwTable_('Approvals').rows.filter(function (a) { return a.status === 'pending'; });
    var bills = A.filter(function (a) { return a.source === 'bill_upload'; }).length, other = A.length - bills;
    if (bills) add('rev-bills', 'medium', bills + ' bill' + (bills === 1 ? '' : 's') + ' read by Claude waiting for you', 'Review and approve them in Entries.', { type: 'review' });
    if (other) add('rev-queue', 'low', other + ' item' + (other === 1 ? '' : 's') + ' waiting in Approvals', 'From bank sorting or submissions.', { type: 'queue' });
  } catch (x) { /* optional */ }

  var dis = obwDismissed_();
  issues = issues.filter(function (x) { return !dis[x.key]; });
  var rank = { high: 0, medium: 1, low: 2 };
  issues.sort(function (a, b) { return rank[a.severity] - rank[b.severity]; });
  return issues;
}

function obwAuditSummary_(issues) {
  var counts = { high: 0, medium: 0, low: 0 }; issues.forEach(function (x) { counts[x.severity]++; });
  var fallback = issues.length ? 'I found ' + issues.length + ' thing' + (issues.length === 1 ? '' : 's') + ' to look at (' + counts.high + ' urgent, ' + counts.medium + ' to fix, ' + counts.low + ' minor). Start with: ' + issues.slice(0, 3).map(function (x) { return x.title; }).join('; ') + '.' : 'Everything checks out. No issues found this week.';
  if (!issues.length) return fallback;
  try {
    var st = obwSettings_(), budget = Number(st.claude_monthly_budget_usd) || 4;
    if (obwMonthSpend_() >= budget) return fallback;
    var text = obwCallClaude_(st.claude_model_fast || 'claude-haiku-5-5',
      'You are the bookkeeping assistant inside Offset Books for Joshua, director of Offset Media (a Sri Lankan photo and video production company). Write him a short inbox message (at most 110 words, plain text, no headings, no bullet symbols) summarising this week\'s check of his books: what matters most and what to fix first. Be specific with numbers and names from the list. Do not invent anything not in the list.',
      [{ type: 'text', text: issues.slice(0, 60).map(function (x) { return '[' + x.severity + '] ' + x.title + ' - ' + x.detail; }).join('\n') }], 'weekly check summary');
    text = String(text || '').trim();
    return (text.length < 20 || /^[\[{]/.test(text)) ? fallback : text;
  } catch (x) { return fallback; }
}

function obwRunAuditCore_(trigger) {
  var issues = obwAuditIssues_(), body = obwAuditSummary_(issues);
  var counts = { high: 0, medium: 0, low: 0 }; issues.forEach(function (x) { counts[x.severity]++; });
  var title = issues.length ? 'Weekly check: ' + issues.length + ' to look at' + (counts.high ? ' (' + counts.high + ' urgent)' : '') : 'Weekly check: all clear';
  var lock = obwLock_();
  try {
    var t = obwInboxTable_();
    var msg = { id: obwNextId_(t.rows, 'M', 4), time: obwNow_(), kind: 'audit', title: title, body: body, issues: JSON.stringify(issues), status: 'unread', trigger: trigger || 'manual' };
    t.sh.appendRow(obwRowArray_(t, msg));
    msg.issues = issues;
    return msg;
  } finally { lock.releaseLock(); }
}

function obwEnsureWeeklyTrigger_() {
  try {
    var has = ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'obwWeeklyAudit'; });
    if (!has) ScriptApp.newTrigger('obwWeeklyAudit').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
    return true;
  } catch (x) { return false; }
}

/** Runs every Monday at about 9am (Colombo) once set up. */
function obwWeeklyAudit() { obwRunAuditCore_('weekly'); }

function obwInbox_(user) {
  obwRequireAdmin_(user);
  var t = obwInboxTable_();
  var msgs = t.rows.filter(function (r) { return r.id; }).slice(-30).reverse().map(function (r) {
    var o = obwPublic_(r); try { o.issues = JSON.parse(r.issues || '[]'); } catch (x) { o.issues = []; } return o;
  });
  var dis = obwDismissed_();
  msgs.forEach(function (m) { m.issues = m.issues.filter(function (x) { return !dis[x.key]; }); });
  var trig = false; try { trig = ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'obwWeeklyAudit'; }); } catch (x) { /* ignore */ }
  return { messages: msgs, weekly: trig };
}

function obwRunAudit_(user, args) {
  obwRequireAdmin_(user);
  var weekly = obwEnsureWeeklyTrigger_();
  var msg = obwRunAuditCore_(args[0] || 'manual');
  return { message: msg, weekly: weekly };
}

/** args = [messageId, 'read' | 'dismiss', issueKey] */
function obwInboxAction_(user, args) {
  obwRequireAdmin_(user);
  var id = String(args[0] || ''), action = args[1], key = args[2];
  if (action === 'dismiss' && key) {
    var dis = obwDismissed_(); dis[key] = obwNow_();
    PropertiesService.getScriptProperties().setProperty('OBW_DISMISSED', JSON.stringify(dis));
    return { dismissed: key };
  }
  if (action === 'read') {
    var t = obwInboxTable_();
    for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i].id) === id) { obwWriteCells_(t, t.rows[i]._row, { status: 'read' }, ['status']); return { id: id, status: 'read' }; }
    throw obwErr_('Message not found.');
  }
  throw obwErr_('Unknown action.');
}


/* ================= shoots (work days inside a project, each with its own budget) ================= */

var OBW_SHOOT_BUDGETS = ['budget_equipment_rental', 'budget_crew', 'budget_transport', 'budget_food', 'budget_location', 'budget_other'];
var OBW_SHOOT_COLS = ['id', 'project', 'name', 'date', 'status', 'fee', 'invoice_no'].concat(OBW_SHOOT_BUDGETS).concat(['notes', 'created_at']);
var OBW_SHOOT_NUM = { fee: 1, budget_equipment_rental: 1, budget_crew: 1, budget_transport: 1, budget_food: 1, budget_location: 1, budget_other: 1 };

function obwShootTable_() {
  var ss = obwSs_(), sh = ss.getSheetByName('Shoots');
  if (!sh) { sh = ss.insertSheet('Shoots'); sh.getRange(1, 1, 1, OBW_SHOOT_COLS.length).setValues([OBW_SHOOT_COLS]); sh.setFrozenRows(1); }
  var t = obwTable_('Shoots'); obwEnsureCols_(t, OBW_SHOOT_COLS); return t;
}
function obwShootClean_(f, v) {
  if (OBW_SHOOT_NUM[f]) { if (v === '' || v == null) return ''; var n = Number(String(v).replace(/,/g, '')); if (!isFinite(n)) throw obwErr_(f + ' must be a number.'); return Math.round(n * 100) / 100; }
  return v == null ? '' : String(v).trim();
}
function obwShootKey_(name) { return String(name || '').trim().toLowerCase(); }

/** All shoots (everyone can read; only the admin edits). */
function obwShoots_(user) {
  var t = obwShootTable_();
  return t.rows.filter(function (r) { return r.id; }).map(obwPublic_);
}

/** Adds (no id) or updates a shoot. Renaming a shoot also renames it on that project's cost lines. */
function obwSaveShoot_(user, args) {
  obwRequireAdmin_(user);
  var input = args[0] || {};
  var lock = obwLock_();
  try {
    var t = obwShootTable_(), ex = null;
    if (input.id) { ex = t.rows.filter(function (r) { return String(r.id) === String(input.id); })[0]; if (!ex) throw obwErr_('Shoot not found. Refresh and try again.'); }
    var next = ex ? obwStrip_(ex, t.headers) : { status: 'planned' };
    ['project', 'name', 'date', 'status', 'fee', 'invoice_no', 'notes'].concat(OBW_SHOOT_BUDGETS).forEach(function (f) { if (Object.prototype.hasOwnProperty.call(input, f)) next[f] = obwShootClean_(f, input[f]); });
    if (!next.project) throw obwErr_('A shoot needs a project.');
    if (!next.name) throw obwErr_('Give the shoot a name, e.g. Match day 1.');
    if (next.date && !/^\d{4}-\d{2}-\d{2}$/.test(next.date)) throw obwErr_('Date must be YYYY-MM-DD.');
    var clash = t.rows.some(function (r) { return r.id && String(r.id) !== String(next.id || '') && r.project === next.project && obwShootKey_(r.name) === obwShootKey_(next.name); });
    if (clash) throw obwErr_('This project already has a shoot called "' + next.name + '".');
    var renamed = [];
    if (ex) {
      var changes = t.headers.filter(function (h) { return String(ex[h] == null ? '' : ex[h]) !== String(next[h] == null ? '' : next[h]); });
      if (changes.length) { obwWriteCells_(t, ex._row, next, changes); changes.forEach(function (h) { obwAudit_(user, 'Shoots', next.id, h, ex[h], next[h], 'Edited in app'); }); }
      if (obwShootKey_(ex.name) !== obwShootKey_(next.name)) {
        var E = obwTable_('Entries');
        E.rows.forEach(function (e) {
          if (e.project === next.project && obwShootKey_(e.shoot) === obwShootKey_(ex.name)) {
            obwAssertOpen_(e.date);
            obwWriteCells_(E, e._row, { shoot: next.name }, ['shoot']);
            obwAudit_(user, 'Entries', e.id, 'shoot', e.shoot, next.name, 'Shoot renamed');
            renamed.push(e.id);
          }
        });
      }
    } else {
      next.id = obwNextId_(t.rows, 'S', 4); next.created_at = obwNow_();
      t.sh.appendRow(obwRowArray_(t, next));
      obwAudit_(user, 'Shoots', next.id, '(new row)', '', JSON.stringify(next), 'Added in app');
    }
    return { shoot: obwStrip_(next, t.headers), renamed: renamed, renamed_to: next.name };
  } finally { lock.releaseLock(); }
}

/** Deletes a shoot. Its cost lines keep their shoot name, so nothing in the books changes. */
function obwDeleteShoot_(user, args) {
  obwRequireAdmin_(user);
  var id = String(args[0] || ''), lock = obwLock_();
  try {
    var t = obwShootTable_(), r = t.rows.filter(function (x) { return String(x.id) === id; })[0];
    if (!r) throw obwErr_('Shoot not found.');
    obwAudit_(user, 'Shoots', id, '(deleted)', JSON.stringify(obwStrip_(r, t.headers)), '', 'Deleted in app');
    t.sh.deleteRow(r._row);
    return { id: id };
  } finally { lock.releaseLock(); }
}

/**
 * Creates several shoots at once. args[0] = { project, shoots: [{ name, date, fee, budget_* }] }
 * Names already on the project are skipped.
 */
function obwPlanShoots_(user, args) {
  obwRequireAdmin_(user);
  var o = args[0] || {}, list = o.shoots || [];
  if (!o.project) throw obwErr_('Choose the project.');
  if (!list.length) throw obwErr_('Add at least one shoot.');
  if (list.length > 60) throw obwErr_('That is a lot of shoots. Add up to 60 at a time.');
  var lock = obwLock_();
  try {
    var t = obwShootTable_(), have = {}, out = [], num = Number(obwNextId_(t.rows, 'S', 4).slice(1)), rows = [];
    t.rows.forEach(function (r) { if (r.project === o.project) have[obwShootKey_(r.name)] = 1; });
    list.forEach(function (x) {
      var name = String(x.name || '').trim(); if (!name || have[obwShootKey_(name)]) return;
      have[obwShootKey_(name)] = 1;
      var s = { project: o.project, name: name, status: x.status || 'planned', created_at: obwNow_() };
      ['date', 'fee', 'invoice_no', 'notes'].concat(OBW_SHOOT_BUDGETS).forEach(function (f) { if (x[f] != null) s[f] = obwShootClean_(f, x[f]); });
      if (s.date && !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) throw obwErr_('Date must be YYYY-MM-DD.');
      var id = String(num++); while (id.length < 4) id = '0' + id; s.id = 'S' + id;
      rows.push(obwRowArray_(t, s)); out.push(s);
    });
    if (rows.length) {
      t.sh.getRange(t.sh.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows);
      out.forEach(function (s) { obwAudit_(user, 'Shoots', s.id, '(new row)', '', JSON.stringify(s), 'Planned in app'); });
    }
    return { shoots: out.map(function (s) { return obwStrip_(s, t.headers); }) };
  } finally { lock.releaseLock(); }
}

/** Sets the project's budget (per cost type) to the total of its shoots' budgets. */
function obwShootsToBudget_(user, args) {
  obwRequireAdmin_(user);
  var pid = String(args[0] || ''), shoots = obwShootTable_().rows.filter(function (r) { return r.project === pid; });
  if (!shoots.length) throw obwErr_('This project has no shoots yet.');
  var patch = { id: pid };
  OBW_SHOOT_BUDGETS.forEach(function (f) { var sum = shoots.reduce(function (t, r) { return t + obwNum_(r[f]); }, 0); patch[f] = sum ? Math.round(sum * 100) / 100 : ''; });
  var p = obwSaveProject_(user, [patch, 'Budget set from shoots']);
  return { project: p };
}
