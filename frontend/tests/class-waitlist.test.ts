import { describe, expect, it } from 'vitest';
import { isParticipantWaitlisted } from '../src/lib/class/waitlist';
import type { SessionParticipant } from '../src/lib/api/session';

const participant = (overrides: Partial<SessionParticipant>): SessionParticipant => ({
  user_id: null,
  guest_name: null,
  is_guest: false,
  band_connected: false,
  linkband_device_id: null,
  webrtc_peer_id: null,
  consent_audio: false,
  consent_eeg: true,
  is_waitlisted: false,
  waitlist_position: null,
  ...overrides,
});

describe('isParticipantWaitlisted — join 응답의 참가자 목록에서 본인이 대기열인지 판별', () => {
  const list = [
    participant({ participant_id: 'p-active', is_waitlisted: false }),
    participant({ participant_id: 'p-wait', is_waitlisted: true, waitlist_position: 1 }),
  ];

  it('본인 participant_id 의 is_waitlisted 가 true 면 대기열이다', () => {
    expect(isParticipantWaitlisted(list, 'p-wait')).toBe(true);
  });

  it('입장 허용된 참가자는 대기열이 아니다', () => {
    expect(isParticipantWaitlisted(list, 'p-active')).toBe(false);
  });

  it('다른 사람이 대기열이어도 본인 id 가 아니면 영향이 없다', () => {
    expect(isParticipantWaitlisted(list, 'p-unknown')).toBe(false);
  });

  it('participant_id 가 없는 응답·본인 id 가 없는 경우는 대기열로 보지 않는다', () => {
    expect(isParticipantWaitlisted([participant({ is_waitlisted: true })], 'p-wait')).toBe(false);
    expect(isParticipantWaitlisted(list, null)).toBe(false);
    expect(isParticipantWaitlisted(undefined, 'p-wait')).toBe(false);
  });
});
