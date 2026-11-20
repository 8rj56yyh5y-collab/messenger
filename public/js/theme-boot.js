// Тема применяется до отрисовки, чтобы страница не «мигала» белым в тёмной теме.
(function () {
  var t = 'system';
  try { t = localStorage.getItem('gc-theme') || 'system'; } catch (e) { /* приватный режим */ }
  var dark = t === 'dark' || (t === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
