// SDD-261: 데이터 저장·업로드 현황 조회 API (계약: specs/sdd-261-upload-status-screens/contract.md)
// apiClient 는 응답 헤더·304 를 노출하지 않아 전용 fetch 를 쓴다. ETag 는 메모리에서만 다룬다(영구 저장 금지).
import { ApiError, apiClient, BASE_URL, refreshAccessToken, tokenStorage } from './client';
import { normalizePersonProgress, normalizeSessionMetrics, normalizeSessionProgress, type PersonProgress, type SessionMetrics, type SessionProgress } from './upload-progress';

export type UploadStatusKind = 'needs_attention' | 'excluded' | 'uploading' | 'received_unreconciled' | 'no_data';
export type CollectionState = 'eligible' | 'excluded' | 'unknown';
export type UploadSignalType = 'eeg' | 'ppg' | 'acc';

export interface UploadFeatureDto {
  received: number;
  legacy_count: number;
  internal_missing: number;
  expected: number | null;
  expected_basis: string;
  completeness: string;
  last_received_at: string | null;
}
export interface UploadRawSignalDto {
  signal_type: UploadSignalType;
  registered: number;
  uploaded: number;
  pending: number;
  failed: number;
  internal_missing: number;
  oldest_pending_at: string | null;
}
export interface UploadRawDto {
  signals: UploadRawSignalDto[];
  last_received_at: string | null;
  completeness: string;
}
export interface UploadParticipantDto {
  participant_id: string;
  display_name: string | null;
  is_guest: boolean;
  participation_status: 'active' | 'waitlisted';
  collection_state: CollectionState;
  band_connected: boolean;
  report_included: boolean | null;
  feature: UploadFeatureDto;
  raw: UploadRawDto;
  phone_report: null;
  status: UploadStatusKind;
  reasons: string[];
  /** SDD-264/265: 참여자 전송 현황. 구 서버면 null. */
  progress?: PersonProgress | null;
  /** SDD-265: 참여자 데이터 크기·측정 길이(참여자 기준). */
  metrics?: SessionMetrics;
  /** SDD-326: 연결한 밴드 시리얼(코치·기관관리자 화면 전용). 구 서버·미수집이면 없음/null. 회원 화면에는 쓰지 않는다. */
  band_serial?: string | null;
  band_firmware?: string | null;
  /** SDD-326: 참가자 회차 전체 측정 끊김 횟수. 미집계/구 서버면 null·없음. */
  band_gap_count?: number | null;
}
/** SDD-326 — GET /band-devices/{serial}/usage 계약(backend/app/schemas/band_device.py). 코치·기관관리자 전용. */
export interface BandDeviceUsageItem {
  session_id: string;
  session_title: string | null;
  session_started_at: string | null;
  participant_id: string;
  display_name: string | null;
  firmware: string | null;
  platform: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_current: boolean;
  stream_count: number;
  superseded_count: number;
  /** 이 시리얼 사용 구간의 측정 끊김 횟수와 사유별 횟수. 구 서버면 없음. */
  gap_count?: number;
  gap_reasons?: Record<string, number>;
}
export interface BandDeviceUsageResponse { serial: string; items: BandDeviceUsageItem[]; truncated: boolean }

export interface UploadStatusSummaryDto {
  participants: number;
  needs_attention: number;
  uploading: number;
  received_unreconciled: number;
  no_data: number;
  excluded: number;
}
export interface UploadStatusResponse {
  class_id: string;
  session_id: string;
  session_status: string;
  as_of: string;
  basis: 'server_received';
  poll_interval_sec: number;
  etag: string;
  summary: UploadStatusSummaryDto;
  participants: UploadParticipantDto[];
  progress?: SessionProgress | null;
  metrics?: SessionMetrics;
  /** 회차 시작·종료(측정 길이 계산 근거). */
  started_at?: string | null;
}

export type UploadStatusFetchResult =
  | { kind: 'ok'; data: UploadStatusResponse; etag: string | null; pollIntervalSec: number | null }
  | { kind: 'not_modified'; etag: string | null; pollIntervalSec: number | null };

export interface FetchUploadStatusOptions {
  signal?: AbortSignal;
  /** 직전 응답의 ETag. 있으면 If-None-Match 로 보낸다. */
  etag?: string | null;
}

const parseInterval = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const abortError = () => new DOMException('요청 취소', 'AbortError');

export const uploadStatusPath = (classId: string, sessionId: string): string =>
  `/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(sessionId)}/upload-status`;

/** 가산 필드만 정규화한다. 기존 필드는 서버 값을 그대로 둔다. */
export function normalizeStatus(raw: unknown): UploadStatusResponse {
  const r = raw as UploadStatusResponse & Record<string, unknown>;
  const list = Array.isArray(r.participants) ? r.participants : [];
  return {
    ...r,
    participants: list.map((p) => ({ ...p, progress: normalizePersonProgress((p as unknown as Record<string, unknown>).progress), metrics: normalizeSessionMetrics(p) })),
    progress: normalizeSessionProgress(r.progress),
    metrics: normalizeSessionMetrics(r),
    started_at: typeof r.started_at === 'string' ? r.started_at : null,
  };
}

async function errorFrom(res: Response): Promise<ApiError> {
  let data: unknown = null;
  try { data = await res.json(); } catch { /* 본문 없음 */ }
  const detail = data && typeof data === 'object' ? (data as { detail?: unknown }).detail : null;
  const code = detail && typeof detail === 'object' ? (detail as { code?: unknown }).code : null;
  return new ApiError(res.status, typeof code === 'string' ? code : `API 요청 실패 (${res.status})`, data);
}

export async function fetchUploadStatus(
  classId: string,
  sessionId: string,
  { signal, etag }: FetchUploadStatusOptions = {},
): Promise<UploadStatusFetchResult> {
  if (signal?.aborted) throw abortError();
  const call = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (etag) headers['If-None-Match'] = etag;
    return fetch(`${BASE_URL}${uploadStatusPath(classId, sessionId)}`, { method: 'GET', headers, credentials: 'include', signal, cache: 'no-store' });
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
  const data = normalizeStatus(await res.json());
  return {
    kind: 'ok',
    data,
    // CORS 로 헤더가 안 보이면 본문 etag/poll_interval_sec 를 쓴다(계약 §5).
    etag: nextEtag ?? data.etag ?? null,
    pollIntervalSec: pollIntervalSec ?? (typeof data.poll_interval_sec === 'number' ? data.poll_interval_sec : null),
  };
}

/** SDD-326 — 시리얼별 사용 회차 역조회(코치·기관관리자, 호출자 권한 범위만). */
export function fetchBandDeviceUsage(serial: string): Promise<BandDeviceUsageResponse> {
  return apiClient.get<BandDeviceUsageResponse>(`/band-devices/${encodeURIComponent(serial)}/usage`);
}
