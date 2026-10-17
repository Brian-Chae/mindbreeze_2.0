// SDD-209 H3 — 상담사 흐름 API 어댑터(초대 결과 구조화·이메일 초대·재발송). session.ts 는 수정하지 않는다.
// 계약 정본: 백엔드 sdd/209-backend 의 InviteResult·InviteEmailResponse·InviteRemindResponse(plan §3 BE-7·BE-R4).
// 초대 결과는 "요청 결과"이며 전달·수신 확인이 아니다(P7).
import { apiClient } from './client';
import type { SessionDto } from './session';

/** 채널별 알림 요청 결과: queued / skipped / failed / not_requested */
export interface InviteChannelResults {
  in_app: string;
  email: string;
}

export interface InviteResult {
  registered: boolean;
  user_id: string;
  channels: InviteChannelResults;
}

export interface InviteMemberResponse extends SessionDto {
  invite_result?: InviteResult | null;
}

export const inviteMember = (sessionId: string, userId: string): Promise<InviteMemberResponse> =>
  apiClient.post<InviteMemberResponse>(`/sessions/${sessionId}/invite`, { user_id: userId });

/** queued / skipped_cooldown / skipped_pending / enqueue_failed / invalid_email / duplicate_in_request / limit_exceeded */
export interface InviteEmailResult {
  email: string;
  registered: boolean;
  request: string;
  invite_id?: string | null;
}

export interface InviteEmailResponse {
  session_id: string;
  cooldown_sec: number;
  results: InviteEmailResult[];
  summary: Record<string, number>;
}

export const inviteByEmail = (sessionId: string, emails: readonly string[]): Promise<InviteEmailResponse> =>
  apiClient.post<InviteEmailResponse>(`/sessions/${sessionId}/invite/email`, { emails });

/** 이메일 초대 목록 한 건(호스트 전용 GET /sessions/{id}/invite/email). status 는 발송 "요청" 상태이며 전달·수신 확인이 아니다 */
export interface InviteEmailItem {
  invite_id: string;
  /** 스위프로 지워졌으면 null */
  email: string | null;
  /** queued(큐 투입) / requested(발송 접수) / failed */
  status: string;
  /** 큐에 오래 머물러 보내지 못한 것으로 보이는 건 */
  stale: boolean;
  request_count: number;
  queued_at: string | null;
  requested_at: string | null;
  pii_scrubbed: boolean;
}

export interface InviteEmailListResponse {
  session_id: string;
  invites: InviteEmailItem[];
  summary: Record<string, number>;
}

export const listEmailInvites = (sessionId: string): Promise<InviteEmailListResponse> =>
  apiClient.get<InviteEmailListResponse>(`/sessions/${sessionId}/invite/email`);

/** 서버 재요청 쿨다운(INVITE_EMAIL_COOLDOWN_SEC)과 같은 값 — 응답의 cooldown_sec 이 정본이고, 목록만 있을 때의 표시용 */
export const EMAIL_INVITE_COOLDOWN_SEC = 60;

/** queued / skipped_cooldown / skipped_no_account / skipped_waitlisted / skipped_notification_off / not_found / failed */
export interface InviteRemindResult {
  participant_id: string;
  user_id?: string | null;
  status: string;
  channels?: InviteChannelResults | null;
}

export interface InviteRemindResponse {
  session_id: string;
  cooldown_sec: number;
  results: InviteRemindResult[];
  summary: Record<string, number>;
}

export const remindInvitees = (sessionId: string, participantIds?: readonly string[]): Promise<InviteRemindResponse> =>
  apiClient.post<InviteRemindResponse>(`/sessions/${sessionId}/invite/remind`, participantIds ? { participant_ids: participantIds } : {});

/** 상담사용 익명 집계(개별 선택·이름 비노출) — 시작 확인 시트의 `리포트에 반영하지 않는 참가자 N명` */
export interface ReportChoiceSummary {
  included: number;
  excluded: number;
  total: number;
}

export const getReportChoiceSummary = (sessionId: string): Promise<ReportChoiceSummary> =>
  apiClient.get<ReportChoiceSummary>(`/sessions/${sessionId}/report-choice/summary`);

/** 연구 목적 활용에 동의한 인원 수만(개별 상태·가명 ID 비노출) */
export interface ResearchConsentSummary {
  consented: number;
  total: number;
}

export const getResearchConsentSummary = (sessionId: string): Promise<ResearchConsentSummary> =>
  apiClient.get<ResearchConsentSummary>(`/sessions/${sessionId}/research-consent/summary`);
