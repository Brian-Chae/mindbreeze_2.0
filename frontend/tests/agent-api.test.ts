import { afterEach, expect, it, vi } from 'vitest';
import { agree, getConsent, getUnreadCount, listMessages, markRead, runCta, sendMessage } from '../src/lib/api/agent';
import { apiClient, ApiError } from '../src/lib/api/client';
afterEach(() => vi.restoreAllMocks());
it('GET 계약 경로와 before 인코딩을 사용한다', async () => {
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({});
  await getConsent(); await getUnreadCount(); await listMessages('2026-10-08T10:00:00+09:00');
  expect(get.mock.calls).toEqual([['/agent/consent'], ['/agent/unread-count'], ['/agent/messages?limit=30&before=2026-10-08T10%3A00%3A00%2B09%3A00']]);
});
it('POST 계약 body와 메시지/CTA 식별자를 사용한다', async () => {
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
  await agree(); await sendMessage('원문 그대로'); await markRead('2026-10-08T01:00:00Z'); await runCta('m/1', 'c/1', { reason: '회사 일정' });
  expect(post.mock.calls).toEqual([
    ['/agent/consent', { agreed: true }], ['/agent/messages', { content: '원문 그대로' }],
    ['/agent/messages/read', { up_to: '2026-10-08T01:00:00Z' }],
    ['/agent/messages/m%2F1/cta/c%2F1', { reason: '회사 일정' }],
  ]);
});
it('HTML 오류 응답도 성공 JSON으로 해석하지 않고 API 오류로 처리한다', async () => {
  const order: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 502,
    get ok() { order.push('ok'); return false; },
    json: async () => { order.push('json'); throw new SyntaxError('HTML'); },
  } as Response);
  await expect(listMessages()).rejects.toBeInstanceOf(ApiError);
  expect(order).toEqual(['ok', 'json']);
});
