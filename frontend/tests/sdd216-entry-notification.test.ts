import { describe, expect, it } from 'vitest';
import { resolveNotificationTarget } from '../src/lib/api/notifications';
import { eventLabel } from '../src/lib/notification-format';
import { allowedPushDeeplink } from '../src/lib/native/push';
describe('클래스 알림 연결', () => {
  const extra = { target_type: 'session', target_id: 's1', event_type: 'session_host_transfer_requested', params: { class_id: 'c1', request_id: 'r1' } };
  it('강사 요청을 실제 부모 회차 경로와 requestId로 연결한다', () => {
    expect(resolveNotificationTarget(extra, 'counselor')).toEqual({ path: '/classes/c1/sessions/s1?requestId=r1' });
  });
  it('회원은 클래스 상세의 해당 회차를 선택한다', () => {
    expect(resolveNotificationTarget(extra, 'client')).toEqual({ path: '/app/classes/c1?sessionId=s1' });
  });
  it('진행자 변경 이벤트는 한글로 표시한다', () => {
    expect(eventLabel('session_host_transfer_requested')).toBe('진행자 양도 요청');
  });
  it('강사 푸시의 실제 회차 경로만 추가 허용한다', () => {
    expect(allowedPushDeeplink('/classes/c1/sessions/s1')).toBe('/classes/c1/sessions/s1');
    expect(allowedPushDeeplink('/classes/c1/settings')).toBeNull();
  });
});
