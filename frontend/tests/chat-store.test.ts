import { beforeEach, expect, it } from 'vitest';
import { useChatStore } from '../src/stores/chatStore';
import type { ChatRoom, ChatMessage } from '../src/lib/api/chat';
const room: ChatRoom = {
  id: 'room', room_type: 'direct', session_id: null, host_id: 'host', name: 'private-id',
  peer_name: '내담자', peer_id: 'private-id', session_title: null, session_scheduled_at: null,
  participant_count: 2, created_at: '2026-09-01T00:00:00Z', unread_count: 3,
};
beforeEach(() => useChatStore.setState({ rooms: [room], messagesByRoom: {} }));
it('이름 변경은 읽음 수와 최근 대화 시각을 바꾸지 않는다', () => {
  useChatStore.getState().updateRoom('room', { display_name: '새 이름', custom_name: '새 이름' });
  const updated = useChatStore.getState().rooms[0];
  expect(updated.name).toBe('private-id');
  expect(updated.unread_count).toBe(3);
  expect(updated.last_message_at).toBeUndefined();
  expect(room.display_name).toBeUndefined();
});
it('늦게 도착한 과거 미리보기는 최신 메시지를 덮어쓰지 않는다', () => {
  const store = useChatStore.getState();
  store.updateRoomLastMessage('room', { content: '최신', created_at: '2026-09-03T00:00:00Z' });
  store.updateRoomLastMessage('room', { content: '과거', created_at: '2026-09-02T00:00:00Z' });
  expect(useChatStore.getState().rooms[0].last_message?.content).toBe('최신');
});
it('전송 응답과 소켓 중복 수신에도 메시지는 하나이며 파일 미리보기를 갱신한다', () => {
  const message: ChatMessage = { id: 'message', room_id: 'room', sender_id: 'host', type: 'image', content: null, file_url: '/image', event_type: null, created_at: '2026-09-03T00:00:00Z' };
  const store = useChatStore.getState();
  store.appendMessage('room', message);
  store.appendMessage('room', message);
  expect(useChatStore.getState().messagesByRoom.room).toHaveLength(1);
  expect(useChatStore.getState().rooms[0].last_message?.content).toBe('사진');
});
