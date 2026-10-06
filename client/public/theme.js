// Loaded as a blocking script in <head> so the right theme is applied before
// first paint. Kept in its own file (not inline) so the Content-Security-Policy
// can forbid inline scripts altogether.
(function () {
  try {
    var stored = localStorage.getItem('vegachat-theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    // Storage blocked: fall back to the light theme.
  }
})();
