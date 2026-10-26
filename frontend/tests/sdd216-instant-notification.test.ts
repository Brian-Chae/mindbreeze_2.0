import { describe, expect, it } from 'vitest';
import { resolveNotificationTarget } from '../src/lib/api/notifications';

const sessionId = 'a1111111-1111-4111-8111-111111111111';
const invite = { target_type: 'class', target_id: 'class-1', event_type: 'class_invited', params: { start_now: true, session_id: sessionId } };
describe('즉시 클래스 알림 입장', () => {
  it('회원의 즉시 초대는 클래스 타겟을 유지하면서 회차 입장으로 연결한다', () => {
    expect(resolveNotificationTarget(invite, 'client')).toEqual({ path: `/class/${sessionId}/enter` });
  });
  it.each(['counselor', 'org_admin', 'platform_admin', undefined])('%s 직원·미확인 역할은 기존 클래스 상세로 연결한다', (role) => {
    expect(resolveNotificationTarget(invite, role)).toEqual({ path: '/classes/class-1' });
  });
  it.each([
    {}, { start_now: false, session_id: sessionId }, { start_now: 'true', session_id: sessionId },
    { start_now: true }, { start_now: true, session_id: '' }, { start_now: true, session_id: 123 },
    { start_now: true, session_id: '../other' }, { start_now: true, session_id: 'https://evil.example' },
    { start_now: true, session_id: 'invalid' },
  ])('일반 초대·잘못된 추가 필드는 안전하게 클래스 상세로 남긴다: %j', (params) => {
    expect(resolveNotificationTarget({ ...invite, params }, 'client')).toEqual({ path: '/app/classes/class-1' });
  });
  it('다른 이벤트와 없는 클래스 ID로 즉시 입장하지 않는다', () => {
    expect(resolveNotificationTarget({ ...invite, event_type: 'class_updated' }, 'client')).toEqual({ path: '/app/classes/class-1' });
    expect(resolveNotificationTarget({ ...invite, target_id: '' }, 'client')).toBeNull();
  });
});
