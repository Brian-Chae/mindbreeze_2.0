// SDD-208 — 정원이 차서 대기열에 들어간 참가자 판별. join 응답의 session.participants[] 에서 본인 행을 찾는다.
import type { SessionParticipant } from '../api/session';

export function isParticipantWaitlisted(
  participants: readonly SessionParticipant[] | undefined,
  participantId: string | null,
): boolean {
  if (!participants || !participantId) return false;
  return participants.some((p) => p.participant_id === participantId && p.is_waitlisted);
}
