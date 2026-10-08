import { expect, it } from 'vitest';
import { feedbackLabel, resolveCounselorCta, serializeSettings, sortRelayEvents } from '../src/pages/agent/counselor-agent-utils';
import type { BriefingSettings, CounselorCta, RelayEvent } from '../src/lib/api/agent-counselor';

const cta = (action: CounselorCta['action'], payload?: CounselorCta['payload']): CounselorCta => ({ id: action, action, label: action, payload });
it('상담사 CTA가 실제 상담사 화면으로 연결된다', () => {
  expect(resolveCounselorCta(cta('open_schedule'))).toBe('/sessions');
  expect(resolveCounselorCta(cta('open_client', { client_id: 'c/1' }))).toBe('/clients/c%2F1');
  expect(resolveCounselorCta(cta('open_record', { session_id: 's1' }))).toBe('/sessions/s1/record');
  expect(resolveCounselorCta(cta('open_report', { report_id: 'r1' }))).toBe('/reports/r1');
  expect(resolveCounselorCta(cta('open_change_requests'))).toBe('/agent?tab=relay');
});
it('위험한 URL, 장소·연락처 CTA, 대상 없는 CTA를 차단한다', () => {
  for (const url of ['javascript:alert(1)', '//evil.com', '/\\evil.com', 'https://evil.com', '/app/reports/r']) {
    expect(resolveCounselorCta(cta('open_report', { url }))).toBeNull();
  }
  expect(resolveCounselorCta(cta('open_report', { url: '/reports/r1' }))).toBe('/reports/r1');
  expect(resolveCounselorCta(cta('open_map', { url: 'https://map.naver.com' }))).toBeNull();
  expect(resolveCounselorCta(cta('call_counselor', { tel: '1234' }))).toBeNull();
  expect(resolveCounselorCta(cta('open_client'))).toBeNull();
});
const settings: BriefingSettings = { morning_enabled: true, morning_time: '08:00', evening_enabled: false, evening_time: '21:00', skip_no_session_days: true };
it('시각을 KST HH:MM 그대로 직렬화하고 설정을 보존한다', () => {
  expect(serializeSettings(settings)).toEqual(settings);
  expect(serializeSettings(settings)).not.toBe(settings);
});
it.each(['25:00', '24:00', '8:0', '08:60', '', ' 08:00', '08:00:00'])('잘못된 시각 %s 거부', (time) => {
  expect(() => serializeSettings({ ...settings, morning_time: time })).toThrow();
  expect(() => serializeSettings({ ...settings, evening_time: time })).toThrow();
});
it('자정과 마지막 분을 허용한다', () => {
  expect(serializeSettings({ ...settings, morning_time: '00:00', evening_time: '23:59' }).morning_time).toBe('00:00');
});
it('피드백을 3지선다 문구로만 표시한다', () => {
  expect(['helpful', 'neutral', 'disappointed'].map((choice) => feedbackLabel(choice as 'helpful' | 'neutral' | 'disappointed'))).toEqual(['도움이 됐어요', '보통이었어요', '아쉬웠어요']);
  expect(feedbackLabel(undefined)).toBe('피드백');
});
it('미처리 우선, 그룹 내 최신순으로 정렬하며 원문과 입력 배열을 보존한다', () => {
  const event = (id: string, handled_at: string | null, created_at: string): RelayEvent => ({ id, handled_at, created_at, kind: 'feedback', client_id: 'c', client_name: '내담자', session_id: null, session_title: null, scheduled_at: null, payload: { texts: ['  원문\n그대로  '] } });
  const items = [event('done', '2026-10-08', '2026-10-08'), event('old', null, '2026-10-06'), event('new', null, '2026-10-07')];
  expect(sortRelayEvents(items).map((item) => item.id)).toEqual(['new', 'old', 'done']);
  expect(items[0].id).toBe('done');
  expect(sortRelayEvents(items)[0].payload.texts).toEqual(['  원문\n그대로  ']);
});
