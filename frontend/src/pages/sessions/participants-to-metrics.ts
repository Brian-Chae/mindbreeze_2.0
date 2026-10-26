import type { SessionDto, SessionLiveMetric } from '../../lib/api/session';

/**
 * live-metrics 가 없을 때(시작 전 대기, v2 경로) 세션 참가자로 테이블 행을 만든다.
 * id 는 서버 participant_id 를 우선한다 — v2 LiveState 행과 같은 키여야 신원·입장 시각이 붙는다.
 * (participant_id 가 없는 구 응답만 user_id / 게스트 합성 id 로 대체)
 */
export function participantsToMetrics(session: Pick<SessionDto, 'participants'>): SessionLiveMetric[] {
  return session.participants
    .filter((p) => !p.is_waitlisted)
    .map((p, index) => ({
      participant_id: p.participant_id ?? p.user_id ?? `guest-${index}-${p.guest_name ?? 'unknown'}`,
      user_id: p.user_id,
      display_name:
        p.user_name || p.guest_name || p.user_email || (p.is_guest ? '게스트' : '참가자'),
      is_guest: p.is_guest,
      band_connected: p.band_connected,
      device_status: null,
      band_battery: null,
      avg_efficiency: null,
      current_efficiency: null,
      upload_status: null,
      last_eeg_at: null,
      entered_at: p.entered_at ?? null,
      // SDD-094: 세션 상세에 실린 발언권 상태를 그대로 승계
      raise_hand: p.raise_hand ?? false,
      speaking: p.speaking ?? false,
    }));
}
