// Look only: slides the selected-tab pill between tabs and plays a short page-in on view change. Touches no data or controls.
(function () {
  'use strict';
  var nav = document.querySelector('nav'), main = document.querySelector('main');
  if (!nav || !main) return;
  var ind = document.createElement('i'); ind.className = 'gl-ind'; ind.setAttribute('aria-hidden', 'true'); nav.insertBefore(ind, nav.firstChild);
  var last = null, placed = false;
  function place() {
    if (ind.parentNode !== nav) nav.insertBefore(ind, nav.firstChild);
    var on = nav.querySelector('a.on'); if (!on || !on.offsetParent) { ind.style.opacity = '0'; return; }
    var t = on.offsetLeft, l = on.offsetTop; // relative to nav (nav is positioned)
    ind.style.opacity = '1'; ind.style.width = on.offsetWidth + 'px'; ind.style.height = on.offsetHeight + 'px';
    ind.style.transform = 'translate(' + t + 'px,' + l + 'px)';
    if (!placed) { ind.style.transition = 'none'; ind.offsetWidth; ind.style.transition = ''; placed = true; }
    if (last !== on) { if (last !== null) enter(); last = on; }
  }
  var timer;
  function enter() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    main.classList.remove('gl-enter'); void main.offsetWidth; main.classList.add('gl-enter');
    clearTimeout(timer); timer = setTimeout(function () { main.classList.remove('gl-enter'); }, 700);
  }
  new MutationObserver(function () { requestAnimationFrame(place); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
  window.addEventListener('resize', place); window.addEventListener('orientationchange', place);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  place(); setTimeout(place, 300);
})();
