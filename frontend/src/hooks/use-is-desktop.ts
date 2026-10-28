// SDD-253 — 데스크톱(≥768px) 여부. 모바일은 기존 카드·전체화면 상세를 유지한다.
import { useEffect, useState } from 'react';

const QUERY = '(min-width: 768px)';

export function useIsDesktop(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return matches;
}
