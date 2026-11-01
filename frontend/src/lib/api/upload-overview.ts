// SDD-263: 전체 회차 업로드 현황 목록 API. 계약 정본: specs/sdd-263-upload-status-overview/contract.md
// 응답 해석(계약 필드 → 화면용 형태)은 이 파일의 normalizeOverview 에만 둔다.
// 단일 회차 API 와 같이 전용 fetch 로 ETag·X-Poll-Interval 을 다룬다. ETag 는 메모리에서만 보관한다.
import { ApiError, BASE_URL, refreshAccessToken, tokenStorage } from './client';
import type { UploadStatusKind, UploadStatusSummaryDto } from './upload-status';

export interface UploadOverviewItem {
  class_id: string;
  class_title: string | null;
  session_id: string;
  seq: number | null;
  session_status: string;
  org_id: string | null;
  org_name: string | null;
  host_name: string | null;
  /** 회차 기준 시각(계약 started_at). 최근순 정렬·기간 필터에 쓴다. */
  session_at: string | null;
  /** 밴드 연결 안 된 수집 대상 인원. 미착용 확정이 아니다. */
  band_not_connected: number;
  last_received_at: string | null;
  summary: UploadStatusSummaryDto;
  /** 서버가 준 회차 대표 상태. 없으면 summary 로 계산한다. */
  status: UploadStatusKind | null;
}
export interface UploadOverviewResponse {
  as_of: string | null;
  poll_interval_sec: number | null;
  etag: string | null;
  truncated: boolean;
  total_candidates: number | null;
  items: UploadOverviewItem[];
}
export type UploadOverviewFetchResult =
  | { kind: 'ok'; data: UploadOverviewResponse; etag: string | null; pollIntervalSec: number | null }
  | { kind: 'not_modified'; etag: string | null; pollIntervalSec: number | null };

export interface UploadOverviewQuery { limit?: number; since?: string | null; orgId?: string | null; classId?: string | null; status?: UploadStatusKind | null }
export interface FetchUploadOverviewOptions { signal?: AbortSignal; etag?: string | null }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function normalizeOverview(raw: unknown): UploadOverviewResponse {
  const r = rec(raw);
  const list = Array.isArray(r.items) ? r.items : [];
  const items = list.map((entry): UploadOverviewItem => {
    const e = rec(entry);
    return {
      class_id: String(e.class_id ?? ''), class_title: str(e.class_title),
      session_id: String(e.session_id ?? ''), seq: typeof e.seq === 'number' ? e.seq : null,
      session_status: str(e.session_status) ?? 'scheduled',
      org_id: str(e.organization_id), org_name: str(e.organization_name), host_name: str(e.host_name),
      session_at: str(e.started_at),
      band_not_connected: num(e.band_not_connected),
      last_received_at: str(e.last_received_at),
      summary: {
        participants: num(e.participants), needs_attention: num(e.needs_attention), uploading: num(e.uploading),
        received_unreconciled: num(e.received_unreconciled), no_data: num(e.no_data), excluded: num(e.excluded),
      },
      status: (str(e.status) as UploadStatusKind | null),
    };
  }).filter((i) => i.class_id && i.session_id);
  return { as_of: str(r.as_of), poll_interval_sec: typeof r.poll_interval_sec === 'number' ? r.poll_interval_sec : null, etag: str(r.etag), truncated: r.truncated === true, total_candidates: typeof r.total_candidates === 'number' ? r.total_candidates : null, items };
}

const parseInterval = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const abortError = () => new DOMException('요청 취소', 'AbortError');

export const uploadOverviewPath = (q: UploadOverviewQuery = {}): string => {
  const p = new URLSearchParams();
  if (q.limit) p.set('limit', String(q.limit));
  if (q.since) p.set('since', q.since);
  if (q.orgId) p.set('org_id', q.orgId);
  if (q.classId) p.set('class_id', q.classId);
  if (q.status) p.set('status', q.status);
  const qs = p.toString();
  return `/upload-status/overview${qs ? `?${qs}` : ''}`;
};

async function errorFrom(res: Response): Promise<ApiError> {
  let data: unknown = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  const detail = rec(data).detail;
  const code = rec(detail).code;
  return new ApiError(res.status, typeof code === 'string' ? code : `API 요청 실패 (${res.status})`, data);
}

export async function fetchUploadOverview(query: UploadOverviewQuery = {}, { signal, etag }: FetchUploadOverviewOptions = {}): Promise<UploadOverviewFetchResult> {
  if (signal?.aborted) throw abortError();
  const call = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (etag) headers['If-None-Match'] = etag;
    return fetch(`${BASE_URL}${uploadOverviewPath(query)}`, { method: 'GET', headers, credentials: 'include', signal, cache: 'no-store' });
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
  const data = normalizeOverview(await res.json());
  return { kind: 'ok', data, etag: nextEtag ?? data.etag ?? null, pollIntervalSec: pollIntervalSec ?? data.poll_interval_sec };
}
