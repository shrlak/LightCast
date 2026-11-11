// Ends the KCCP start screen (splash.css, ~1.6 s) after its animation, or right away on a click.
// Signals with a `fc-splash-done` event on window and by setting the document title to
// "fc-done" for a moment — the desktop app watches the title of its splash window.
(function () {
  var root = document.querySelector('.fc-splash');
  if (!root) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finished = false;
  function done() {
    if (finished) return;
    finished = true;
    root.dataset.done = '1';
    var title = document.title;
    document.title = 'fc-done';
    setTimeout(function () { document.title = title; }, 60);
    window.dispatchEvent(new Event('fc-splash-done'));
  }
  root.addEventListener('click', done);
  setTimeout(done, reduce ? 500 : 1700);
})();
