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
  obwSaveProject: obwSaveProject_
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
  return { costTypes: map, clients: clients, accounts: accounts, extras: extras, canEdit: user.role === 'admin' };
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
