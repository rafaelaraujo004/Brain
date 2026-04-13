import { useState, useEffect, useCallback } from 'react';
import { db, getOrCreateSettings } from '../db/database';

export function useTheme() {
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getOrCreateSettings().then((s) => {
      setThemeState(s.theme);
      document.documentElement.classList.toggle('dark', s.theme === 'dark');
      setLoaded(true);
    });
  }, []);

  const setTheme = useCallback(async (newTheme: 'dark' | 'light') => {
    setThemeState(newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    const settings = await getOrCreateSettings();
    await db.settings.update(settings.id!, { theme: newTheme });
  }, []);

  return { theme, setTheme, loaded };
}
