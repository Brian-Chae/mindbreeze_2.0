import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../src/lib/api/client';
import { updateChatRoom, listChatRoomParticipants, addChatRoomParticipants, removeChatRoomParticipant } from '../src/lib/api/chat';
vi.mock('../src/lib/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
it('이름 PATCH와 참여자 API가 합의된 경로 및 payload를 사용한다', async () => {
  await updateChatRoom('room', { name: '공유 이름' });
  expect(apiClient.patch).toHaveBeenCalledWith('/chat/rooms/room', { name: '공유 이름' });
  await listChatRoomParticipants('room');
  expect(apiClient.get).toHaveBeenCalledWith('/chat/rooms/room/participants');
  await addChatRoomParticipants('room', ['client']);
  expect(apiClient.post).toHaveBeenCalledWith('/chat/rooms/room/participants', { participant_ids: ['client'] });
  await removeChatRoomParticipant('room', 'client');
  expect(apiClient.delete).toHaveBeenCalledWith('/chat/rooms/room/participants/client');
});
