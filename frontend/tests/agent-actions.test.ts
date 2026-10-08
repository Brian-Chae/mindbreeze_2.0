import { describe, expect, it } from 'vitest';
import type { AgentCta, AgentMessage } from '../src/lib/api/agent';
import { canAccessAgent, isCtaDisabled, mergeAgentMessages, resolveCta, safeAgentUrl } from '../src/lib/agent/actions';
const cta = (action: AgentCta['action'], payload?: AgentCta['payload']): AgentCta => ({ id: action, action, label: action, payload });
describe('AI CTA URL 보안', () => {
  it.each(['javascript:alert(1)', 'data:text/html,test', 'http://example.com', '//evil.com', '/\\evil.com', 'https://ok.com\n', ' https://ok.com', 'https://user:pass@evil.com', 'https:\\evil.com', 'tel:123', ''])('위험한 URL %s 차단', (value) => {
    expect(safeAgentUrl(value)).toBeNull();
    expect(resolveCta(cta('open_map', { url: value }))).toBeNull();
    expect(resolveCta(cta('open_report', { url: value }))).toBeNull();
  });
  it('HTTPS와 앱 내부 루트 상대경로 허용', () => {
    expect(safeAgentUrl('https://map.naver.com/?query=%EB%8C%80%EC%A0%84')).toContain('https://map.naver.com/');
    expect(safeAgentUrl('/app/reports?id=report-1')).toBe('/app/reports?id=report-1');
  });
});
it('8개 액션을 계약대로 매핑', () => {
  expect(resolveCta(cta('ack'))).toEqual({ type: 'submit' });
  expect(resolveCta(cta('feedback_choice', { choice: 'disappointed' }))).toEqual({ type: 'submit' });
  expect(resolveCta(cta('request_change'))).toEqual({ type: 'reason' });
  expect(resolveCta(cta('open_map', { url: 'https://map.naver.com/' }))).toEqual({ type: 'map', url: 'https://map.naver.com/' });
  expect(resolveCta(cta('open_report', { url: '/app/reports' }))).toEqual({ type: 'navigate', url: '/app/reports' });
  expect(resolveCta(cta('join_session', { session_id: 's1' }))).toEqual({ type: 'join', sessionId: 's1' });
  expect(resolveCta(cta('open_chat', { room_id: 'r/1' }))).toEqual({ type: 'navigate', url: '/app/chat/r%2F1' });
  expect(resolveCta(cta('call_counselor', { tel: '+82 (10) 1234-5678' }))).toEqual({ type: 'phone', url: 'tel:+821012345678' });
});
it('필수 payload가 없거나 완료된 CTA는 동작하지 않음', () => {
  for (const action of ['open_map', 'open_report', 'join_session', 'open_chat', 'call_counselor'] as const) expect(resolveCta(cta(action))).toBeNull();
  const done = { ...cta('feedback_choice', { choice: 'helpful' }), done: true };
  const other = cta('feedback_choice', { choice: 'neutral' });
  expect(resolveCta(done)).toBeNull();
  expect(isCtaDisabled(other, [done, other])).toBe(true);
  expect(isCtaDisabled(cta('ack'), [done])).toBe(false);
});
it('미조회·미동의·거절이면 대화 접근 불가', () => {
  expect(canAccessAgent(null)).toBe(false);
  expect(canAccessAgent({ agreed: false, version: '1.0' })).toBe(false);
  expect(canAccessAgent({ agreed: true, version: '1.0' }, true)).toBe(false);
  expect(canAccessAgent({ agreed: true, version: '1.0' })).toBe(true);
});
it('최신순 응답과 이전 페이지를 오래된 순서로 합치고 중복 제거', () => {
  const message = (id: string, created_at: string): AgentMessage => ({ id, created_at, sender: 'agent', kind: 'free', content: id, cta: [], ref_type: null, ref_id: null, read_at: null });
  const old = message('old', '2026-10-01T10:00:00Z');
  const latest = message('new', '2026-10-02T10:00:00Z');
  expect(mergeAgentMessages([latest], [latest, old]).map((item) => item.id)).toEqual(['old', 'new']);
});

it('늦은 조회 응답이 완료된 CTA를 다시 활성화하지 않는다', () => {
  const message: AgentMessage = { id: 'm', created_at: '2026-10-08T00:00:00Z', sender: 'agent', kind: 'free', content: '', cta: [{ ...cta('ack'), done: true }], ref_type: null, ref_id: null, read_at: null };
  const merged = mergeAgentMessages([message], [{ ...message, cta: [cta('ack')] }]);
  expect(merged[0].cta[0].done).toBe(true);
  expect(isCtaDisabled(merged[0].cta[0], merged[0].cta)).toBe(true);
});
it('내담자 리포트 상세 딥링크로 연결한다', () => {
  expect(resolveCta(cta('open_report', { url: '/app/reports/report-id' }))).toEqual({ type: 'navigate', url: '/app/reports?report=report-id' });
});
