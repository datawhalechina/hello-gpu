import { useEffect, useState } from 'react';

const STORAGE_KEY = 'vitepress-theme-appearance';

function readPreference() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return ['light', 'dark', 'auto'].includes(value) ? value : 'dark';
  } catch {
    return 'dark';
  }
}

function applyPreference(preference) {
  const theme = preference === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#101213' : '#ffffff';
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101213' : '#ffffff';
  return theme;
}

export function useAtlasTheme() {
  const [preference, setPreference] = useState(readPreference);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTheme(applyPreference(preference));
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference]);

  useEffect(() => {
    const synchronize = event => {
      if (event.key === STORAGE_KEY || event.key === null) setPreference(readPreference());
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    setPreference(next);
    setTheme(applyPreference(next));
  };

  return { theme, toggleTheme };
}
