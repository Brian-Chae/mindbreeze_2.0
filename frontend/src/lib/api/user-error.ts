// 사용자 화면에 보여 줄 오류 문구. 브라우저 원문('Failed to fetch' 등)은 노출하지 않고,
// 페이지 이탈·취소로 끊긴 요청은 오류로 취급하지 않는다(null).

/** 페이지를 떠나는 중인지 — 이탈 시 브라우저가 진행 중 fetch 를 끊어 TypeError 가 난다 */
let leaving = false;
if (typeof window !== 'undefined') {
  const mark = (): void => { leaving = true; };
  window.addEventListener('pagehide', mark);
  window.addEventListener('beforeunload', mark);
  window.addEventListener('pageshow', () => { leaving = false; });
}

/** 테스트용: 이탈 상태 강제 설정 */
export function setPageLeavingForTest(value: boolean): void {
  leaving = value;
}

const NETWORK_MESSAGE = '네트워크 연결이 불안정해요. 잠시 후 다시 시도해 주세요.';
const BROWSER_FETCH_PATTERN = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

export function isAbortLike(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

export function isBrowserNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof Error && BROWSER_FETCH_PATTERN.test(error.message);
}

/**
 * 오류 → 사용자 문구. 취소·페이지 이탈로 끊긴 요청이면 null(표시하지 않음),
 * 브라우저 네트워크 오류면 한국어 안내, 그 외 Error 는 message, 아니면 fallback.
 */
export function userErrorMessage(error: unknown, fallback: string): string | null {
  if (isAbortLike(error)) return null;
  if (isBrowserNetworkError(error)) return leaving ? null : NETWORK_MESSAGE;
  return error instanceof Error && error.message ? error.message : fallback;
}
