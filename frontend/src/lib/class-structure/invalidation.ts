/** 클래스 읽기는 기존 요청 공유를 유지하고 종료 후 새 GET으로 갱신한다. */
let revision = 0;
const listeners = new Set<() => void>();
export function invalidateClassReads(): void {
  revision += 1;
  listeners.forEach(listener => listener());
}
export const classReadRevision = (): number => revision;
/** 창 focus·탭 복귀 재조회의 최소 간격 — 탭을 오갈 때마다 목록 전체를 다시 받지 않게 한다. */
export const FOCUS_REFETCH_MIN_INTERVAL_MS = 30_000;
let lastFocusRefetchAt = 0;
/** 쓰기 후 즉시 갱신(invalidateClassReads)은 가드 대상이 아니다. focus 계열만 간격을 둔다. */
export function invalidateClassReadsOnFocus(now: number = Date.now()): void {
  if (now - lastFocusRefetchAt < FOCUS_REFETCH_MIN_INTERVAL_MS) return;
  lastFocusRefetchAt = now;
  invalidateClassReads();
}
export function resetFocusRefetchGuard(): void { lastFocusRefetchAt = 0; }
const onFocus = (): void => invalidateClassReadsOnFocus();
const onVisible = (): void => { if (document.visibilityState === 'visible') invalidateClassReadsOnFocus(); };
export function subscribeClassReads(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    lastFocusRefetchAt = Date.now();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}
