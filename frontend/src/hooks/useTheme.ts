import { useState, useEffect, useCallback } from 'react';

// 사용자가 고른 테마 선호. 'system' 은 OS/브라우저 설정을 따른다.
type ThemePreference = 'light' | 'dark' | 'system';
// 실제 화면에 적용되는 해석된 테마.
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'mindbreeze-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(DARK_QUERY).matches;
}

function getInitialPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  // 저장값이 없으면 시스템 설정을 따르는 'system' 을 기본으로 한다.
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // 선호가 system 이면 실제 OS 테마를, 아니면 지정한 테마를 적용한다.
  const theme: ResolvedTheme = preference === 'system'
    ? (systemDark ? 'dark' : 'light')
    : preference;

  // 해석된 테마를 DOM 에 반영한다.
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme]);

  // 사용자가 고른 선호를 저장한다.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  // OS/브라우저 테마 변경을 구독한다 — system 선호일 때 즉시 재적용된다.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DARK_QUERY);
    const handleSystemChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', handleSystemChange);
    return () => media.removeEventListener('change', handleSystemChange);
  }, []);

  // 다른 탭/창에서 저장값이 바뀌면 선호와 시스템 테마를 동기화해 재적용한다.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      setPreference(getInitialPreference());
      setSystemDark(systemPrefersDark());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggle = useCallback(() => {
    // system 이면 현재 표시값의 반대로, 아니면 light/dark 를 뒤집는다.
    setPreference(theme === 'light' ? 'dark' : 'light');
  }, [theme]);

  return { theme, preference, toggle };
}
