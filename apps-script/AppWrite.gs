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
  obwBillFile: obwBillFile_
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
