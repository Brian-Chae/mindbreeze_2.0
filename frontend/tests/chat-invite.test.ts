import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../src/lib/api/client';
import { canInviteToRoom, forkChatRoom, listInvitableCounselors } from '../src/lib/api/chat-invite';
import type { ChatRoom } from '../src/lib/api/chat';
import { useChatStore } from '../src/stores/chatStore';
vi.mock('../src/lib/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));
export const room: ChatRoom = {
  id: 'source', room_type: 'group', host_id: 'host', peer_id: 'peer', peer_name: '상대',
  name: '원본', session_id: null, session_title: null, session_scheduled_at: null,
  participant_count: 2, created_at: '2026-09-25T00:00:00Z', unread_count: 3,
};
beforeEach(() => vi.clearAllMocks());
it('상담사 호스트와 기관 관리자만 초대할 수 있다', () => {
  expect(canInviteToRoom(room, { id: 'host', role: 'counselor' })).toBe(true);
  expect(canInviteToRoom(room, { id: 'other', role: 'org_admin' })).toBe(true);
  expect(canInviteToRoom(room, { id: 'other', role: 'counselor' })).toBe(false);
  expect(canInviteToRoom(room, { id: 'host', role: 'client' })).toBe(false);
  expect(canInviteToRoom({ ...room, room_type: 'session' }, { id: 'host', role: 'counselor' })).toBe(false);
});
it('확정된 상담사 후보 경로와 fork payload를 사용한다', async () => {
  await listInvitableCounselors({ q: '김 & 이', page: 2, size: 50 });
  expect(apiClient.get).toHaveBeenCalledWith('/chat/invitable-counselors?q=%EA%B9%80+%26+%EC%9D%B4&page=2&size=50');
  await forkChatRoom('source', { participant_ids: ['counselor', 'client'] });
  expect(apiClient.post).toHaveBeenCalledWith('/chat/rooms/source/fork', { participant_ids: ['counselor', 'client'] });
});
it('새 방 삽입은 원본과 메시지를 보존하고 중복 응답은 최신 읽음 상태를 덮지 않는다', () => {
  useChatStore.setState({ rooms: [room], messagesByRoom: { source: [] } });
  const fresh = { ...room, id: 'new', unread_count: 0 };
  useChatStore.getState().upsertRoom(fresh);
  useChatStore.getState().incrementUnread('new');
  useChatStore.getState().upsertRoom({ ...fresh, participant_count: 4 });
  expect(useChatStore.getState().rooms).toHaveLength(2);
  expect(useChatStore.getState().rooms.find((item) => item.id === 'source')).toEqual(room);
  expect(useChatStore.getState().rooms.find((item) => item.id === 'new')).toMatchObject({ unread_count: 1, participant_count: 4 });
  expect(useChatStore.getState().messagesByRoom).toEqual({ source: [] });
});
