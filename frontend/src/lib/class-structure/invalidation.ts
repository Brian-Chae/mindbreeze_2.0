/** 클래스 읽기는 기존 요청 공유를 유지하고 종료 후 새 GET으로 갱신한다. */
let revision = 0;
const listeners = new Set<() => void>();
export function invalidateClassReads(): void {
  revision += 1;
  listeners.forEach(listener => listener());
}
export const classReadRevision = (): number => revision;
const onVisible = (): void => { if (document.visibilityState === 'visible') invalidateClassReads(); };
export function subscribeClassReads(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('focus', invalidateClassReads);
    document.addEventListener('visibilitychange', onVisible);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('focus', invalidateClassReads);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}
