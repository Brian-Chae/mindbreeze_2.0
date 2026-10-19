import { apiClient, ApiError } from './client';
import type { ClassId, RelationshipId } from '../class-structure/read-model';

export interface UserBriefDto { id: string; name: string | null }
export interface SessionBriefDto { id: string; seq: number | null; scheduled_at: string | null; status: string }
export interface NextSessionDto extends SessionBriefDto { host: UserBriefDto | null }
export interface ProgressDto { completed: number; total: number }
export interface ClassSummaryDto {
  id: string; title: string | null; status: string; schedule_mode: string;
  planned_session_count: number | null; area: 'meditation' | 'counseling';
  progress: ProgressDto; session_count: number; next_session: NextSessionDto | null; has_open_session: boolean;
}
export interface ClassInstructorDto { user_id: string; name: string | null; role: string; status: string }
export interface ClassHostViewDto { access_code: string | null; instructors: ClassInstructorDto[] }
export interface ClassDetailDto extends ClassSummaryDto {
  location_type: string; location_address: string | null; linkband_mode: string; record_audio: boolean;
  capacity: number; participant_mode: string; default_duration_min: number; host_view: ClassHostViewDto | null;
  revision?: number; capabilities?: { manage: boolean; invite: boolean; schedule: boolean };
  record_video?: boolean; chat_enabled?: boolean; reminder_offsets?: number[];
  draft_schedule?: import('./class-scheduling').ScheduleInput | null;
  recurrence_rule?: import('./class-scheduling').RecurrenceRule | null;
  assignment_rule?: import('./class-scheduling').AssignmentRule | null; ends_on?: string | null;
}
export interface ClassSessionDto extends SessionBriefDto { session_kind: string; host: UserBriefDto | null; host_state: string | null; state_version?: number; duration_min?: number; location_type?: 'online' | 'offline'; location_address?: string | null; assignment_override?: boolean }
export interface ClassListResponse { classes: ClassSummaryDto[]; total: number }
export interface ClassSessionsResponse { sessions: ClassSessionDto[]; total: number }
export interface CounselingSummaryDto {
  id: string; status: string; area: 'meditation' | 'counseling'; counselor: UserBriefDto;
  client_display: string | null; modality_default: string | null; session_count: number;
  next_session: SessionBriefDto | null; latest_session: SessionBriefDto | null;
}
export interface CounselingSessionDto extends SessionBriefDto { type: string; record_status: string | null; report_status: string | null }
export interface CounselingDetailDto extends CounselingSummaryDto { sessions: CounselingSessionDto[] }
export interface CounselingListResponse { relationships: CounselingSummaryDto[]; total: number }
export interface ListParams { status?: string; page?: number; limit?: number }

function query(params?: ListParams): string {
  const search = new URLSearchParams();
  if (params?.status !== undefined) search.set('status', params.status);
  if (params?.page !== undefined) search.set('page', String(params.page));
  if (params?.limit !== undefined) search.set('limit', String(params.limit));
  return search.size ? `?${search.toString()}` : '';
}
type ResponseKind = 'classes' | 'class' | 'sessions' | 'counseling' | 'relationship';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const identified = (value: unknown): value is Record<string, unknown> => object(value) && typeof value.id === 'string' && value.id.trim().length > 0;
function validateResponse(value: unknown, kind: ResponseKind): void {
  const invalid = () => { throw new ApiError(502, '응답을 확인할 수 없습니다.', null); };
  if (!object(value)) return invalid();
  let rows: unknown[];
  if (kind === 'class' || kind === 'relationship') {
    if (!identified(value)) return invalid();
    rows = [value];
    if (kind === 'relationship') {
      if (!Array.isArray(value.sessions)) return invalid();
      rows = rows.concat(value.sessions);
    }
  } else {
    const key = kind === 'counseling' ? 'relationships' : kind;
    if (!Array.isArray(value[key]) || typeof value.total !== 'number' || !Number.isInteger(value.total) || value.total < 0) return invalid();
    rows = value[key] as unknown[];
  }
  for (const row of rows) {
    if (!identified(row)) return invalid();
    for (const key of ['next_session', 'latest_session']) {
      if (row[key] != null && !identified(row[key])) return invalid();
    }
  }
}

/** 공통 클라이언트의 인증 처리를 유지하고 취소 이후 결과를 폐기한다. */
function read<T>(path: string, kind: ResponseKind, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('요청 취소', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('요청 취소', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    apiClient.get<unknown>(path).then((data) => { validateResponse(data, kind); return data as T; }).then(
      (data) => { if (!signal?.aborted) resolve(data); },
      (error: unknown) => { if (!signal?.aborted) reject(error); },
    ).finally(() => signal?.removeEventListener('abort', abort));
  });
}
export const getClasses = (params?: ListParams, signal?: AbortSignal): Promise<ClassListResponse> => read(`/classes${query(params)}`, 'classes', signal);
export const getClass = (id: ClassId, signal?: AbortSignal): Promise<ClassDetailDto> => read(`/classes/${encodeURIComponent(id)}`, 'class', signal);
export const getClassSessions = (id: ClassId, signal?: AbortSignal): Promise<ClassSessionsResponse> => read(`/classes/${encodeURIComponent(id)}/sessions`, 'sessions', signal);
export const getCounseling = (params?: ListParams, signal?: AbortSignal): Promise<CounselingListResponse> => read(`/counseling${query(params)}`, 'counseling', signal);
export const getCounselingDetail = (id: RelationshipId, signal?: AbortSignal): Promise<CounselingDetailDto> => read(`/counseling/${encodeURIComponent(id)}`, 'relationship', signal);
