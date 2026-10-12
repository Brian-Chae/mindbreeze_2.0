/**
 * LiveKit 시그널링 URL — SDD-197.
 * 우선순위: VITE_LIVEKIT_URL → API 주소(VITE_API_BASE_URL)에서 유도(`https://api.x/api/v1` → `wss://api.x/livekit`)
 * → 로컬 개발 기본값. 환경별 주소를 소스에 하드코딩하지 않는다.
 */
export function resolveLiveKitUrl(
  env: { VITE_LIVEKIT_URL?: string; VITE_API_BASE_URL?: string } = import.meta.env as {
    VITE_LIVEKIT_URL?: string;
    VITE_API_BASE_URL?: string;
  },
): string {
  const explicit = env.VITE_LIVEKIT_URL?.trim();
  if (explicit) return explicit;
  const api = env.VITE_API_BASE_URL?.trim();
  if (api) {
    try {
      const url = new URL(api);
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        const scheme = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${scheme}//${url.host}/livekit`;
      }
    } catch {
      /* 잘못된 주소는 로컬 기본값으로 */
    }
  }
  return 'ws://localhost:7880';
}
