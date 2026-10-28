// Applies a stored light/dark override before first paint. Extension pages cannot run
// inline scripts, so this is a tiny classic script loaded from <head>.
try {
  const theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Storage blocked: the page follows the system theme.
}
