import { useEffect } from 'react';
import type { Settings } from '../../shared/settings.ts';

/**
 * Applies the theme setting. "system" removes the override so CSS follows the OS
 * (no matchMedia needed); light/dark pin it and are cached for theme-init.js to apply before paint.
 */
export function useTheme(theme: Settings['theme'] | undefined): void {
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch {
      // Storage blocked: the theme still applies for this page load.
    }
  }, [theme]);
}
