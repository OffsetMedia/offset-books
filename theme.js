// Build number and saved theme, applied before anything draws (kept out of index.html so the security policy needs no inline scripts).
window.OB_BUILD = "2026-11-05.6";
(function () {
  var t = 'dark'; try { t = localStorage.getItem('ob_theme') || 'dark'; } catch (e) { /* private mode */ }
  if (t === 'auto') t = (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t === 'light' ? '#F5F3FA' : '#07060D');
})();
