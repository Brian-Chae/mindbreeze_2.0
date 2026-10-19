import { apiClient } from './client';

export type AssignmentMode = 'all_one' | 'rotate' | 'by_weekday' | 'per_session';
export interface RecurrenceRule { version: 1; start_date: string; weekdays: number[]; time: string; interval_weeks: number; skip_dates: string[] }
export interface AssignmentRule { version: 1; mode: AssignmentMode; host_ids: (string | null)[]; weekday_hosts: Record<number, string | null> }
export interface ScheduleRow {
  client_key: string; session_id?: string | null; seq: number; scheduled_at: string; duration_min: number;
  location_type: 'online' | 'offline'; location_address: string | null; host_id: string | null;
  session_kind: 'regular' | 'makeup'; assignment_override: boolean; expected_state_version?: number | null;
}
export interface ScheduleInput {
  title: string; location_type: 'online' | 'offline'; location_address: string | null; capacity: number;
  linkband_mode: 'none' | 'optional'; record_audio: boolean; record_video: boolean; chat_enabled: boolean;
  schedule_mode: 'fixed' | 'rolling'; planned_session_count: number; duration_min: number;
  recurrence_rule: RecurrenceRule; assignment_rule: AssignmentRule;
  instructors: { user_id: string; role: 'lead' | 'assistant' }[]; rows: ScheduleRow[];
  reminder_offsets: number[]; ends_on: string | null; member_ids: string[];
}
export interface WriteCommand { operation_key: string; expected_revision?: number; force?: boolean; confirmed_conflict_fingerprint?: string; reason?: string }
export interface ConflictItem { candidate_key: string; kind: 'host' | 'place' | 'member'; starts_at: string; ends_at: string; parent_title: string | null; seq: number | null; visible: boolean }
export interface SchedulePreview { rows: ScheduleRow[]; conflicts: ConflictItem[]; warnings?: string[]; input_hash?: string; conflict_fingerprint: string; class_revision: number | null }
export interface WriteResult { class_id: string; revision: number; session_ids?: string[]; effects_pending?: number }
export interface CreateCommand extends WriteCommand { schedule: ScheduleInput; status: 'draft' | 'active' }
export interface BulkCommand extends WriteCommand { action: 'shift_week' | 'replace' | 'cancel'; session_ids: string[]; expected_state_versions: Record<string, number>; rows: ScheduleRow[] }
export interface InstructorCandidate { id: string; name: string | null }
export interface EmailInvite { id: string; email: string; status: 'pending' | 'sent' | 'failed'; created_at: string; sent_at: string | null }
export interface HostRequest { id: string; session_id: string; requested_by: string; candidate_host_id: string; request_kind: 'change' | 'transfer'; status: string; expected_state_version: number; expires_at: string | null; created_at: string; resolved_at: string | null }
const path = (id: string) => `/classes/${encodeURIComponent(id)}`;
export const schedulingApi = {
  candidates: (classId?: string) => apiClient.get<{ instructors: InstructorCandidate[] }>(`/classes/instructor-candidates${classId ? `?class_id=${encodeURIComponent(classId)}` : ''}`),
  preview: (schedule: ScheduleInput) => apiClient.post<SchedulePreview>('/classes/preview-schedule', schedule),
  create: (command: CreateCommand) => apiClient.post<WriteResult>('/classes', command),
  update: (id: string, command: WriteCommand & { schedule: ScheduleInput }) => apiClient.patch<WriteResult>(path(id), command),
  publish: (id: string, command: WriteCommand) => apiClient.post<WriteResult>(`${path(id)}/publish`, command),
  duplicate: (id: string, command: WriteCommand & { start_date: string; invite_members: boolean }) => apiClient.post<WriteResult>(`${path(id)}/duplicate`, command),
  previewBulk: (id: string, command: BulkCommand) => apiClient.post<SchedulePreview>(`${path(id)}/schedule/preview`, command),
  bulk: (id: string, command: BulkCommand) => apiClient.patch<WriteResult>(`${path(id)}/sessions/bulk`, command),
  addSession: (id: string, command: WriteCommand & { row: ScheduleRow; makeup_for_session_id?: string; member_ids: string[] }) => apiClient.post<WriteResult>(`${path(id)}/sessions`, command),
  emailInvites: (id: string) => apiClient.get<{ invitations: EmailInvite[] }>(`${path(id)}/email-invites`),
  inviteEmails: (id: string, command: WriteCommand & { emails: string[] }) => apiClient.post<{ invitations: EmailInvite[] }>(`${path(id)}/email-invites`, command),
  retryEmail: (id: string, inviteId: string, command: WriteCommand) => apiClient.post<unknown>(`${path(id)}/email-invites/${encodeURIComponent(inviteId)}/retry`, command),
  hostRequests: (id: string, sessionId: string) => apiClient.get<{ requests: HostRequest[] }>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/host-requests`),
  requestHost: (id: string, sessionId: string, command: WriteCommand & { candidate_host_id: string; request_kind: 'change' | 'transfer'; expected_state_version: number }) => apiClient.post<{ request_id: string; status: string }>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/host-requests`, command),
  resolveHost: (id: string, sessionId: string, requestId: string, command: WriteCommand & { action: 'approve' | 'accept' | 'reject' | 'cancel' }) => apiClient.post<unknown>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/host-requests/${encodeURIComponent(requestId)}/resolve`, command),
};
