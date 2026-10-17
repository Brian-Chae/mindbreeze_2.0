// SDD-209 I1 — 알림 이동: 열림·시작·대기열 승격 알림은 회원을 입장 화면으로 직행, 그 밖의 세션 알림은 상세로.
import { describe, expect, it } from 'vitest';
import { resolveNotificationTarget } from '../src/lib/api/notifications';

const extraOf = (eventType: string) => ({ schema_version: 1, event_type: eventType, target_type: 'session', target_id: 's1' });

describe('resolveNotificationTarget — 클래스 입장 직행', () => {
  it.each(['session_opened', 'session_started', 'session_waitlist_promoted'])('회원 %s → /class/{id}/enter', (eventType) => {
    expect(resolveNotificationTarget(extraOf(eventType), 'client')).toEqual({ path: '/class/s1/enter' });
  });

  it.each(['session_cancelled', 'session_invited', 'session_ended'])('회원 %s → 상세', (eventType) => {
    expect(resolveNotificationTarget(extraOf(eventType), 'client')).toEqual({ path: '/app/sessions/s1' });
  });

  it('상담사는 열림 알림도 세션 상세로 간다', () => {
    expect(resolveNotificationTarget(extraOf('session_opened'), 'counselor')).toEqual({ path: '/sessions/s1' });
  });

  it('레거시 알림(event_type 없음)은 회원 상세로 간다', () => {
    expect(resolveNotificationTarget({ session_id: 's1' }, 'client')).toEqual({ path: '/app/sessions/s1' });
  });
});
