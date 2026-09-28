import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../src/lib/api/client';
import { getSessionChatRoom, setSessionChatEnabled } from '../src/lib/api/chat';
vi.mock('../src/lib/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
it('세션 채팅방 조회와 상담사 토글이 합의된 경로 및 payload를 사용한다', async () => {
  await getSessionChatRoom('session-1');
  expect(apiClient.get).toHaveBeenCalledWith('/sessions/session-1/chat-room');
  await setSessionChatEnabled('session-1', true);
  expect(apiClient.post).toHaveBeenCalledWith('/sessions/session-1/chat-enabled', { enabled: true });
  await setSessionChatEnabled('session-1', false);
  expect(apiClient.post).toHaveBeenLastCalledWith('/sessions/session-1/chat-enabled', { enabled: false });
});
it('세션 id는 경로 인코딩을 거쳐 조회·토글에 전달된다', async () => {
  await getSessionChatRoom('a/b');
  expect(apiClient.get).toHaveBeenCalledWith('/sessions/a%2Fb/chat-room');
  await setSessionChatEnabled('a/b', true);
  expect(apiClient.post).toHaveBeenCalledWith('/sessions/a%2Fb/chat-enabled', { enabled: true });
});
