// API7-04: 액세스 토큰 만료 임박 판별.
//
// 참여자 액션(checkin·by-code join·LiveKit 토큰·손들기)이 토큰 유효성과 무관하게
// refreshAccessToken() 을 강제 호출하던 문제를 막기 위해, "지금 갱신해야 하는가"만
// 판단한다. 백엔드 access token 은 exp 클레임을 가진 JWT(core/security.py)이므로
// 만료 임박/만료일 때만 갱신하고, 유효한 토큰은 그대로 사용한다.

/** 만료로 간주하는 여유(ms) — 시계 오차·전송 지연 대비 */
const DEFAULT_EXPIRY_SKEW_MS = 30_000;

/** JWT payload(base64url)를 안전하게 디코드한다. 형식이 아니면 null. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  try {
    const json = typeof atob === 'function' ? atob(padded) : '';
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    // 서명·페이로드가 손상된 토큰은 만료로 간주한다(안전한 기본값).
    return null;
  }
}

/**
 * 토큰을 지금 갱신해야 하는지 판단한다.
 * - `exp` 가 만료됐거나 skew 이내로 임박하면 true
 * - `exp` 를 알 수 없는 불투명 토큰(dev 토큰 등)은 계약이 불확실하므로 보수적으로 true
 *   → 기존 동작(선제 갱신)과 동일하게 유지하고, exp 를 아는 JWT 만 불필요한 갱신을 건너뛴다.
 */
export function isAccessTokenExpiring(
  token: string | null,
  skewMs = DEFAULT_EXPIRY_SKEW_MS,
): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== 'number') return true;
  return exp * 1000 - Date.now() <= skewMs;
}
