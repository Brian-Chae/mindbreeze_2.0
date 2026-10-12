// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { listChatMessagesAround } from '../src/lib/api/chat';
afterEach(() => vi.unstubAllGlobals());
it('messages-around가 없으면 context 응답을 최신순 목록으로 변환한다', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    paths.push(url);
    if (url.includes('messages-around')) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ message: { id: 'target' }, before: [{ id: 'older' }], after: [{ id: 'newer' }], before_cursor: null, after_cursor: null }));
  });
  const result = await listChatMessagesAround('room', 'target');
  expect(result.messages.map((message) => message.id)).toEqual(['newer', 'target', 'older']);
  expect(paths[0]).toContain('/chat/rooms/room/messages-around?message_id=target');
  expect(paths[1]).toContain('/chat/rooms/room/messages/target/context');
});
it('접근 거부는 다른 API로 재시도하지 않는다', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { paths.push(url); return new Response('{}', { status: 403 }); });
  await expect(listChatMessagesAround('room', 'target')).rejects.toMatchObject({ status: 403 });
  expect(paths).toHaveLength(1);
});
