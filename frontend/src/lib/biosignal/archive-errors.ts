/**
 * SDD-246 T09 — archive 업로드 오류의 단계(presign|put|verify)별 분류.
 * 같은 HTTP 403이라도 PUT(저장소 서명 만료)과 API(동의·권한)는 의미가 다르다. 횟수만으로 영구 실패를 만들지 않는다.
 */
import { ApiError } from '../api/client';

export type ArchiveStage = 'presign' | 'put' | 'verify';
/** represign=새 presign으로 재시도 / backoff=자동 재시도 / halt=권한·동의 거절, 보존 중단 / quarantine=충돌·스키마·크기, 격리 / time_review=시간 미확정, 완료로 세지 않음 */
export type ArchiveAction = 'represign' | 'backoff' | 'halt' | 'quarantine' | 'time_review';
export interface ArchiveDecision {
  stage: ArchiveStage; action: ArchiveAction; code: string; retryAfterMs: number | null; splitCandidate: boolean;
}

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

/** attempts 가 아무리 커도 유한 대기. retryAfter 가 더 크면 그 값을 쓴다. */
export function backoffMs(attempts: number, retryAfterMs: number | null = null): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(Math.max(0, attempts), 20));
  return Math.max(exp, retryAfterMs ?? 0);
}

interface Detail { code?: string; reason?: string }
function detailOf(error: ApiError): Detail {
  const data = error.data as { detail?: unknown } | null;
  const detail = data && typeof data === 'object' ? data.detail : null;
  if (detail && typeof detail === 'object') return detail as Detail;
  return {};
}
function retryAfterOf(error: ApiError): number | null {
  const data = error.data as { retry_after?: unknown; detail?: { retry_after?: unknown } } | null;
  const value = data?.retry_after ?? data?.detail?.retry_after;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : null;
}

export function classifyArchiveError(stage: ArchiveStage, error: unknown): ArchiveDecision {
  const base = { stage, retryAfterMs: null as number | null, splitCandidate: false };
  if (!(error instanceof ApiError)) {
    // 네트워크·타임아웃·일시 장애는 어느 단계든 자동 재시도 대상이다.
    return { ...base, action: 'backoff', code: error instanceof Error ? error.name || 'network' : 'network' };
  }
  const status = error.status;
  const detail = detailOf(error);
  if (status >= 500 || status === 408 || status === 429) return { ...base, action: 'backoff', code: `http_${status}`, retryAfterMs: retryAfterOf(error) };
  if (status === 401) return { ...base, action: 'backoff', code: 'auth_refresh' }; // 토큰 갱신 후 재시도(클라이언트가 이미 refresh 시도)
  if (status === 403) {
    // 저장소 PUT 403 = 서명 만료/권한 → 새 presign 으로 복구. API 403 = 동의·권한·종료 거절 → 보존 중단.
    if (stage === 'put') return { ...base, action: 'represign', code: 'put_signature_expired' };
    return { ...base, action: 'halt', code: detail.reason ?? detail.code ?? 'forbidden' };
  }
  if (status === 404) return stage === 'verify' ? { ...base, action: 'represign', code: 'chunk_unknown' } : { ...base, action: 'quarantine', code: detail.code ?? 'not_found' };
  if (status === 409) {
    if (detail.code === 'pending_time_review') return { ...base, action: 'time_review', code: detail.reason ?? 'pending_time_review' };
    return { ...base, action: 'quarantine', code: detail.code ?? 'conflict' };
  }
  if (status === 413) return { ...base, action: 'quarantine', code: 'payload_too_large', splitCandidate: true };
  if (status === 400 || status === 422) return { ...base, action: 'quarantine', code: detail.code ?? `http_${status}` };
  return { ...base, action: 'backoff', code: `http_${status}` };
}
