/*
 * Offset Books: sign-in, API, and the bridge that lets the original Apps Script screen run as an installable app.
 * - Signs in with Google once; the ID token (valid about an hour) is reused so reopening the app needs no tap.
 * - One boot request at a time, with a loading screen straight away (no repeated taps).
 * - google.script.run.* calls from the original screen are sent to the Apps Script API (Api.gs / AppWrite.gs).
 */
(function () {
  'use strict';
  var CFG = window.OB_CONFIG || {}, KEY = 'ob_id_token';
  var st = { token: '', booting: false, booted: false, waiters: [], gsi: false, renewing: null };
  function $(id) { return document.getElementById(id); }

  function screen(name, msg) {
    $('ob-signin').hidden = name !== 'signin';
    $('ob-loading').hidden = name !== 'loading';
    if (name === 'app') { $('ob-signin').hidden = true; $('ob-loading').hidden = true; }
    if (msg != null) $('ob-msg').textContent = msg;
  }
  function claims(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } }
  function fresh(t, marginSec) { var c = claims(t); return !!(t && c.exp && c.exp * 1000 > Date.now() + (marginSec || 120) * 1000); }
  function keep(t) { try { localStorage.setItem(KEY, t); } catch (e) { /* private mode */ } }
  function stored() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function forget() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  /* ---------- Google sign-in ---------- */
  function initGsi() {
    if (st.gsi || !(window.google && google.accounts && google.accounts.id)) return;
    st.gsi = true;
    google.accounts.id.initialize({ client_id: CFG.clientId, callback: onCredential, auto_select: true, hd: 'offset-media.com', cancel_on_tap_outside: false, use_fedcm_for_prompt: true, itp_support: true });
    google.accounts.id.renderButton($('ob-gbtn'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
    attachShim();
  }
  function onCredential(resp) {
    if (!resp || !resp.credential) return;
    st.token = resp.credential; keep(st.token);
    var w = st.waiters; st.waiters = []; w.forEach(function (f) { f(true); });
    if (st.booted) { screen('app'); return; }
    boot();
  }
  /** Gets a new token without bothering the user when possible; otherwise shows the sign-in card over the app. */
  function renew() {
    if (st.renewing) return st.renewing;
    st.renewing = new Promise(function (resolve) {
      st.waiters.push(function (ok) { st.renewing = null; resolve(ok); });
      try { initGsi(); google.accounts.id.prompt(); } catch (e) { /* fall through to the button */ }
      setTimeout(function () { if (st.renewing) { screen('signin', 'Your sign-in expired. Tap the button to continue. Nothing you did was lost.'); } }, 2500);
    });
    return st.renewing;
  }
  window.OBSignOut = function () {
    forget(); st.token = '';
    try { google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    location.reload();
  };

  /* ---------- API ---------- */
  window.OBAPI = function api(fn, args, retried) {
    var tokenP = fresh(st.token, 60) ? Promise.resolve(true) : renew();
    return tokenP.then(function () {
      return fetch(CFG.apiUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: st.token, fn: fn, args: args || [] }) });
    }).then(function (r) {
      if (!r.ok) throw new Error('The server did not answer (' + r.status + '). Check your connection and try again.');
      return r.json();
    }).then(function (j) {
      if (j.ok) return j.data;
      if (j.code === 'auth' && !retried) { st.token = ''; forget(); return renew().then(function () { return api(fn, args, true); }); }
      var e = new Error(j.error || 'Something went wrong.'); e.code = j.code; throw e;
    }, function (e) { if (e && e.code) throw e; throw new Error((e && e.message) || 'Could not reach the server.'); });
  };

  /* ---------- google.script.run bridge for the original screen ---------- */
  function runner(o) {
    return new Proxy({}, {
      get: function (_, k) {
        if (k === 'withSuccessHandler') return function (f) { return runner(Object.assign({}, o, { ok: f })); };
        if (k === 'withFailureHandler') return function (f) { return runner(Object.assign({}, o, { fail: f })); };
        if (k === 'withUserObject') return function (u) { return runner(Object.assign({}, o, { user: u })); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          window.OBAPI(String(k), args).then(function (r) { if (o.ok) o.ok(r, o.user); },
            function (e) { if (o.fail) o.fail(e, o.user); else if (window.toast) window.toast(e.message); });
        };
      }
    });
  }
  function attachShim() {
    window.google = window.google || {};
    if (!window.google.script) window.google.script = { run: runner({}), host: { close: function () {} } };
  }
  attachShim();

  /* ---------- boot ---------- */
  function loadScript(src) {
    return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error('Could not load ' + src)); }; document.body.appendChild(s); });
  }
  function boot() {
    if (st.booting || st.booted) return;
    st.booting = true;
    screen('loading');
    $('ob-loadmsg').textContent = 'Opening your books…';
    var slow = setTimeout(function () { $('ob-loadmsg').textContent = 'Still opening… the server can take a few seconds to wake up.'; }, 6000);
    window.OBAPI('getBootData', []).then(function (d) {
      clearTimeout(slow);
      window.__OB_BOOT__ = d;
      attachShim();
      return loadScript('extras.js').then(function () { return loadScript('legacy.js'); });
    }).then(function () {
      st.booted = true; st.booting = false; screen('app');
      $('shell').hidden = false;
    }).catch(function (e) {
      clearTimeout(slow); st.booting = false;
      if (e.code === 'noaccess') { forget(); screen('signin', e.message); return; }
      screen('signin', e.message || 'Could not open Offset Books.');
      $('ob-retry').hidden = !fresh(st.token);
    });
  }
  $('ob-retry').addEventListener('click', function () { $('ob-retry').hidden = true; boot(); });

  function start() {
    if (!CFG.clientId || !CFG.apiUrl) { screen('signin', 'Setup needed: fill in clientId and apiUrl in config.js.'); return; }
    var t = stored();
    if (fresh(t)) { st.token = t; boot(); }          // reopened within the hour: straight in, no taps
    else { forget(); screen('signin', ''); }
  }
  window.OB_GSI_READY = function () {
    initGsi();
    if (!st.token && !st.booting) { try { google.accounts.id.prompt(); } catch (e) { /* the button still works */ } }
  };
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* fine without it */ }); });
  start();
  if (window.google && google.accounts && google.accounts.id) window.OB_GSI_READY();
})();
