import { expect, it } from 'vitest';
import { resolveCta } from '../src/lib/agent/actions';
import { resolveCounselorCta } from '../src/pages/agent/counselor-agent-utils';
it('상담사 대화 CTA는 기존 내담자 채팅 경로로 이동한다', () => {
  expect(resolveCta({ id: 'talk', action: 'talk_to_counselor', label: '상담사님과 대화하기', payload: { room_id: 'room/1' } })).toEqual({ type: 'navigate', url: '/app/chat/room%2F1' });
});
it('위험 신호 CTA는 내부 목록만 연다', () => {
  expect(resolveCounselorCta({ id: 'risk', action: 'open_risk_signals', label: '위험 신호 보기', payload: { url: 'https://outside.example' } })).toBe('/agent?tab=risk');
});
