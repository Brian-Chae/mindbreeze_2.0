// SDD-246 T06 — 장애 폴백 REST 어댑터(plan §3.5). DEGRADED 에서만 LiveClient 가 호출한다.
// 서버가 같은 서비스(T05)로 처리하므로 응답도 epoch/cursors/generation 검사를 거친다(reducer 쪽).
import type { RestFallback } from './live-client';
import type { CommandAck, LiveCommand, LiveSnapshot } from './live-types';

interface HttpLike {
  get: <T>(path: string, options?: { headers?: Record<string, string> }) => Promise<T>;
  post: <T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }) => Promise<T>;
}

/** 구 서버/프록시가 v2 지원 여부를 알 수 있도록 REST 에도 지원 버전을 알린다(T05 `X-Live-Protocol`). */
const HEADERS = { 'X-Live-Protocol': '1,2' };

export function createRestFallback(http: HttpLike): RestFallback {
  return {
    getSnapshot: ({ sessionId, requestId, generation }) =>
      http.get<LiveSnapshot>(
        `/sessions/${sessionId}/live-v2/snapshot?generation=${encodeURIComponent(generation)}&request_id=${encodeURIComponent(requestId)}`,
        { headers: HEADERS },
      ),
    postCommand: (cmd: LiveCommand) =>
      http.post<CommandAck>(`/sessions/${cmd.session_id}/live-v2/commands`, cmd, { headers: HEADERS }),
  };
}
