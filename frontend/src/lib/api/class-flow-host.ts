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
