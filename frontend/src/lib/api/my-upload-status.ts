// SDD-265: 회원 본인 데이터 저장 현황 — 최근 회차 목록 한 번 조회(GET /upload-status/me/sessions).
// 계약 정본: specs/sdd-265-upload-status-redesign/contract.md §3. 본인 행만 오며 타인 정보는 응답에 없다.
// 응답 해석은 normalizeMySessions 한 곳에만 둔다. ETag·X-Poll-Interval 은 목록 API 와 같은 규칙.
import { ApiError, BASE_URL, refreshAccessToken, tokenStorage } from './client';

export type MyRowStatus = 'needs_attention' | 'uploading' | 'received_unreconciled' | 'no_data';
export type MyCollectionState = 'eligible' | 'excluded' | 'unknown';
export type MyProgressState = 'all_received' | 'in_progress' | 'needs_attention' | 'expected_unknown' | 'not_collected';

export interface MySessionRow {
  session_id: string;
  class_id: string;
  class_title: string | null;
  seq: number | null;
  org_name: string | null;
  session_status: string;
  started_at: string | null;
  ended_at: string | null;
  status: MyRowStatus;
  collection_state: MyCollectionState;
  progress_state: MyProgressState | null;
  /** 본인 전송 현황 %. 근거 없으면 null. */
  percent: number | null;
  /** SDD-267 가산: 모두 도착 + 최종 확인 대기(보조 표기). 없으면 false. */
  final_pending: boolean;
  /** SDD-278 가산(호환 점검용, 화면 문구 없음). 구 서버는 false. */
  abnormal_exit_suspected: boolean;
  bytes_arrived: number | null;
  bytes_expected: number | null;
  duration_min: number | null;
  measured_min: number | null;
  last_received_at: string | null;
}
export interface MySessionsResponse {
  as_of: string | null;
  poll_interval_sec: number | null;
  etag: string | null;
  next_cursor: string | null;
  has_more: boolean;
  items: MySessionRow[];
}
export type MySessionsFetchResult =
  | { kind: 'ok'; data: MySessionsResponse; etag: string | null; pollIntervalSec: number | null }
  | { kind: 'not_modified'; etag: string | null; pollIntervalSec: number | null };
export interface MySessionsQuery { limit?: number; cursor?: string | null }

const STATUSES: readonly MyRowStatus[] = ['needs_attention', 'uploading', 'received_unreconciled', 'no_data'];
const COLLECTIONS: readonly MyCollectionState[] = ['eligible', 'excluded', 'unknown'];
const PROGRESS: readonly MyProgressState[] = ['all_received', 'in_progress', 'needs_attention', 'expected_unknown', 'not_collected'];
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function normalizeMySessions(raw: unknown): MySessionsResponse {
  const r = rec(raw);
  const list = Array.isArray(r.items) ? r.items : [];
  const items = list.map((entry): MySessionRow => {
    const e = rec(entry);
    return {
      session_id: String(e.session_id ?? ''), class_id: String(e.class_id ?? ''), class_title: str(e.class_title),
      seq: typeof e.seq === 'number' ? e.seq : null, org_name: str(e.organization_name),
      session_status: str(e.session_status) ?? 'completed', started_at: str(e.started_at), ended_at: str(e.ended_at),
      status: STATUSES.find((s) => s === e.status) ?? 'no_data',
      collection_state: COLLECTIONS.find((s) => s === e.collection_state) ?? 'unknown',
      progress_state: PROGRESS.find((s) => s === e.progress_state) ?? null,
      percent: numOrNull(e.percent), final_pending: e.final_pending === true, abnormal_exit_suspected: e.abnormal_exit_suspected === true, bytes_arrived: numOrNull(e.bytes_arrived), bytes_expected: numOrNull(e.bytes_expected),
      duration_min: numOrNull(e.duration_min), measured_min: numOrNull(e.measured_min), last_received_at: str(e.last_received_at),
    };
  }).filter((i) => i.session_id);
  const next = str(r.next_cursor);
  return {
    as_of: str(r.as_of), poll_interval_sec: numOrNull(r.poll_interval_sec), etag: str(r.etag),
    next_cursor: next, has_more: r.has_more === true || next !== null, items,
  };
}

export const mySessionsPath = (q: MySessionsQuery = {}): string => {
  const p = new URLSearchParams();
  p.set('limit', String(q.limit ?? 10));
  if (q.cursor) p.set('cursor', q.cursor);
  return `/upload-status/me/sessions?${p.toString()}`;
};

const parseInterval = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const abortError = () => new DOMException('요청 취소', 'AbortError');

async function errorFrom(res: Response): Promise<ApiError> {
  let data: unknown = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  const code = rec(rec(data).detail).code;
  return new ApiError(res.status, typeof code === 'string' ? code : `API 요청 실패 (${res.status})`, data);
}

export async function fetchMySessions(query: MySessionsQuery = {}, { signal, etag }: { signal?: AbortSignal; etag?: string | null } = {}): Promise<MySessionsFetchResult> {
  if (signal?.aborted) throw abortError();
  const call = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (etag) headers['If-None-Match'] = etag;
    return fetch(`${BASE_URL}${mySessionsPath(query)}`, { method: 'GET', headers, credentials: 'include', signal, cache: 'no-store' });
  };
  let res = await call(tokenStorage.getAccess());
  if (res.status === 401) {
    const token = await refreshAccessToken();
    if (!token) throw new ApiError(401, '인증이 만료되었습니다.', null);
    res = await call(token);
  }
  if (signal?.aborted) throw abortError();
  const nextEtag = res.headers.get('ETag');
  const pollIntervalSec = parseInterval(res.headers.get('X-Poll-Interval'));
  if (res.status === 304) return { kind: 'not_modified', etag: nextEtag ?? etag ?? null, pollIntervalSec };
  if (!res.ok) throw await errorFrom(res);
  const data = normalizeMySessions(await res.json());
  return { kind: 'ok', data, etag: nextEtag ?? data.etag ?? null, pollIntervalSec: pollIntervalSec ?? data.poll_interval_sec };
}
