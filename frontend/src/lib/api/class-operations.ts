import { apiClient } from './client';
import type { WriteCommand } from './class-scheduling';
export interface ClassMember { id: string; user_id: string | null; name: string | null; status: string }
export interface ClassInstructor { user_id: string; role: 'lead' | 'assistant' | 'guest'; status: string; scope_session_id: string | null }
export interface Observation { token: string; room_name: string; snapshot: { session_id: string; status: string; state_version: number; started_at: string | null; role: 'observer' } }
const path = (id: string) => `/classes/${encodeURIComponent(id)}`;
export const classOperationsApi = {
  members: (id: string) => apiClient.get<{ members: ClassMember[] }>(`${path(id)}/members`),
  inviteMembers: (id: string, command: WriteCommand & { user_ids: string[]; reactivate: boolean }) => apiClient.post<unknown>(`${path(id)}/members`, command),
  instructors: (id: string) => apiClient.get<{ instructors: ClassInstructor[] }>(`${path(id)}/instructors`),
  addInstructor: (id: string, command: WriteCommand & { user_id: string; role: 'lead' | 'assistant' | 'guest'; scope_session_id?: string }) => apiClient.post<unknown>(`${path(id)}/instructors`, command),
  changeInstructor: (id: string, userId: string, command: WriteCommand & { role: 'lead' | 'assistant' | 'guest'; scope_session_id?: string }) => apiClient.patch<unknown>(`${path(id)}/instructors/${encodeURIComponent(userId)}`, command),
  removeInstructor: (id: string, userId: string, command: WriteCommand) => apiClient.delete<unknown>(`${path(id)}/instructors/${encodeURIComponent(userId)}`, { body: command }),
  transition: (id: string, command: WriteCommand & { action: 'complete' | 'cancel' | 'archive' | 'restore' | 'hide' }) => apiClient.post<unknown>(`${path(id)}/transition`, command),
  reports: (id: string, sessionId: string) => apiClient.get<{ reports: { id: string; type: 'counselor' | 'client'; status: string; participant_name?: string | null }[]; attendance?: { attended: number; absent: number } }>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/reports`),
  correctHost: (id: string, sessionId: string, command: WriteCommand & { expected_state_version: number; mode: 'correct' | 'note'; candidate_host_id?: string; displayed_host_name?: string }) => apiClient.post<unknown>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/host-correction`, command),
  observe: (id: string, sessionId: string) => apiClient.post<Observation>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/observe`),
};

// SDD-217의 멤버 UUID는 기존 초대 API의 user UUID와 구분한다.
export type MemberCapabilities = Record<string, boolean>;
export interface MembershipMember extends ClassMember { kind?: 'user' | 'guest'; canonical_member_id?: string; waitlist_position?: number | null; capabilities?: MemberCapabilities }
export interface MemberCommand { operation_key: string; expected_revision: number; reason?: string }
export interface CredentialBundle { activity_credential: string | null; read_credential: string; expires_at: string }
export interface MemberConsents { report_included_default: boolean; research_consented: boolean; research_notice_version: string | null; reminder_opt_in: boolean; notice_version: string | null }
export interface MyMembership { class_id: string; revision: number; member: MembershipMember; capabilities: MemberCapabilities; consents: MemberConsents; attendance_summary: { attended: number; absent: number; excused: number; makeup_reserved: number; makeup_completed: number } }
export interface MemberAttendance { id: string; member_id: string; attendance_status: string; attendance_kind: string; entered_at: string | null }
export interface MemberMakeup { id: string; member_id: string; source_session_id: string; target_session_id: string; status: string }
export interface MyAttendanceSession { id: string; seq: number | null; status: string; scheduled_at: string | null; session_kind: string; participation_scope: string; attendance: MemberAttendance | null; makeup: MemberMakeup | null; approved_report_ids: string[]; capabilities: MemberCapabilities }
export interface MemberResult { class_id: string; revision: number; member?: MembershipMember; credential_bundle?: CredentialBundle | null; recovery_required?: boolean }
export interface GuestResult { class_id: string; member: MembershipMember; credential_bundle: CredentialBundle | null; recovery_required?: boolean }
export interface GuestJoinInput { operation_key: string; code: string; guest_name: string; gender: string; birth_year_month: string; report_email: string; report_included: boolean; notice_version?: string; research_consented: boolean; research_notice_version?: string; reminder_opt_in: boolean; join_mode: 'active' | 'waitlist' }
export interface MergePreview { source_member_id: string; target_member_id: string; conflicts: {session_id: string; code: string}[]; withdraw_participant_ids: string[]; preview_fingerprint: string }
const credentialOptions = (credential?: string, signal?: AbortSignal): {signal?:AbortSignal;skipAuth?:boolean;headers?:Record<string,string>} => ({ signal, ...(credential === undefined ? {} : {skipAuth:true,headers: credential ? {'X-Class-Member-Credential':credential} : {}}) });
export const membershipApi = {
  membership: (id:string, credential?:string, signal?:AbortSignal) => apiClient.get<MyMembership>(`${path(id)}/me/membership`,credentialOptions(credential,signal)),
  attendance: (id:string, credential?:string, signal?:AbortSignal) => apiClient.get<{sessions:MyAttendanceSession[];total:number}>(`${path(id)}/me/attendance`,credentialOptions(credential,signal)),
  transition: (id:string,memberId:string,body:MemberCommand&{action:string},credential?:string) => apiClient.post<MemberResult>(`${path(id)}/members/${encodeURIComponent(memberId)}/transition`,body,credentialOptions(credential)),
  waitlist: (id:string,body:MemberCommand&{code:string},credential?:string) => apiClient.post<MemberResult>(`${path(id)}/waitlist`,body,credentialOptions(credential)),
  participation: (id:string,sessionId:string,credential?:string) => apiClient.get<{participation_version:number}>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/participation`,credentialOptions(credential)),
  changeAttendance: (id:string,sessionId:string,memberId:string,body:MemberCommand&{action:string;expected_participation_version:number},credential?:string) => apiClient.post<MemberResult>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/members/${encodeURIComponent(memberId)}/attendance`,body,credentialOptions(credential)),
  makeup: (id:string,body:MemberCommand&{member_id:string;source_session_id:string;target_session_id:string},credential?:string) => apiClient.post<MemberResult>(`${path(id)}/makeup-assignments`,body,credentialOptions(credential)),
  cancelMakeup: (id:string,assignmentId:string,body:MemberCommand,credential?:string) => apiClient.post<MemberResult>(`${path(id)}/makeup-assignments/${encodeURIComponent(assignmentId)}/cancel`,body,credentialOptions(credential)),
  consents: (id:string,body:MemberCommand&Partial<MemberConsents>,credential?:string) => apiClient.put<MemberResult>(`${path(id)}/me/consents`,body,credentialOptions(credential)),
  withdrawResearch: (id:string,body:MemberCommand&{reason:string},credential?:string) => apiClient.post<MemberResult>(`${path(id)}/me/research-withdrawal`,body,credentialOptions(credential)),
  report: (reportId:string,credential?:string,signal?:AbortSignal) => apiClient.get<import('./reports').ReportDto>(`/reports/${encodeURIComponent(reportId)}`,credentialOptions(credential,signal)),
  guestJoin: (id:string,body:GuestJoinInput) => apiClient.post<GuestResult>(`${path(id)}/guest-memberships`,body,credentialOptions('')),
  guestExchange: (id:string,exchange_token:string) => apiClient.post<GuestResult>(`${path(id)}/guest-credentials/exchange`,{exchange_token},credentialOptions('')),
  guestRefresh: (id:string,credential:string) => apiClient.post<{credential_bundle:CredentialBundle}>(`${path(id)}/guest-credentials/refresh`,undefined,credentialOptions(credential)),
  guestLogout: (id:string,credential:string) => apiClient.post<{logged_out:boolean}>(`${path(id)}/guest-credentials/logout`,undefined,credentialOptions(credential)),
  guestRejoin: (id:string,body:MemberCommand&{code:string},credential:string) => apiClient.post<MemberResult>(`${path(id)}/guest-credentials/rejoin`,body,credentialOptions(credential)),
  guestEntry: (id:string,sessionId:string,body:MemberCommand,credential:string) => apiClient.post<{session_id:string;participant_id:string;entry_credential:string;expires_at:string}>(`${path(id)}/sessions/${encodeURIComponent(sessionId)}/guest-entry`,body,credentialOptions(credential)),
  mergePreview: (id:string,body:{source_member_id:string;target_member_id:string;reason:string}) => apiClient.post<MergePreview>(`${path(id)}/guest-merges/preview`,body),
  merge: (id:string,body:MemberCommand&{source_member_id:string;target_member_id:string;confirmed_preview_fingerprint:string;identity_confirmed:true}) => apiClient.post<MemberResult>(`${path(id)}/guest-merges`,body),
  recovery: (id:string,memberId:string,body:MemberCommand&{identity_confirmed:true}) => apiClient.post<MemberResult&{exchange_token?:string;expires_at?:string}>(`${path(id)}/members/${encodeURIComponent(memberId)}/recovery`,body),
  rotate: (id:string,body:MemberCommand) => apiClient.post<MemberResult&{access_code:string}>(`${path(id)}/access-code/rotate`,body),
};
