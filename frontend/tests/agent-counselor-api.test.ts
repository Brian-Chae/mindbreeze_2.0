import { afterEach, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api/agent-counselor';
import { ApiError, apiClient } from '../src/lib/api/client';
afterEach(() => vi.restoreAllMocks());
it('상담사 전용 경로와 커서·상태 쿼리로 조회한다', async () => {
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({});
  await api.getSettings(); await api.getUnreadCount(); await api.listMessages('2026-10-08T10:00:00+09:00'); await api.listRelayEvents('open');
  expect(get.mock.calls).toEqual([
    ['/agent/counselor/settings'], ['/agent/counselor/unread-count'],
    ['/agent/counselor/messages?limit=30&before=2026-10-08T10%3A00%3A00%2B09%3A00'], ['/agent/counselor/relay-events?status=open&limit=50'],
  ]);
});
it('설정 PUT 및 메시지·읽음·처리·CTA POST 계약을 유지한다', async () => {
  const put = vi.spyOn(apiClient, 'put').mockResolvedValue({});
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
  const settings = { morning_enabled: true, morning_time: '08:00', evening_enabled: false, evening_time: '21:00', skip_no_session_days: true };
  await api.putSettings(settings); await api.sendMessage('오늘 일정'); await api.markRead('2026-10-08T01:00:00Z'); await api.markHandled('e/1'); await api.runCta('m/1', 'c/1');
  expect(put.mock.calls).toEqual([['/agent/counselor/settings', settings]]);
  expect(post.mock.calls).toEqual([
    ['/agent/counselor/messages', { content: '오늘 일정' }], ['/agent/counselor/messages/read', { up_to: '2026-10-08T01:00:00Z' }],
    ['/agent/counselor/relay-events/e%2F1/handled'], ['/agent/counselor/messages/m%2F1/cta/c%2F1', {}],
  ]);
});
it('HTTP 오류는 성공 응답으로 사용하지 않고 JSON보다 상태를 먼저 확인한다', async () => {
  const order: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 502, get ok() { order.push('ok'); return false; }, json: async () => { order.push('json'); throw new SyntaxError('HTML'); } } as Response);
  await expect(api.getSettings()).rejects.toBeInstanceOf(ApiError); expect(order).toEqual(['ok', 'json']);
});
