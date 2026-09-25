import { describe, expect, it } from 'vitest';
import type { ChatRoom } from '../src/lib/api/chat';
import { sortRooms } from '../src/lib/chat-sort';

const room = (id: string, values: Partial<ChatRoom> = {}): ChatRoom => ({
  id, room_type: 'direct', session_id: null, host_id: null, name: null,
  peer_name: null, peer_id: null, session_title: null, session_scheduled_at: null,
  participant_count: 2, created_at: '2026-09-01T00:00:00Z', unread_count: 0,
  ...values,
});
const ids = (rooms: ChatRoom[]) => rooms.map((item) => item.id);

describe('채팅방 정렬', () => {
  it('최근 대화와 메시지 없는 방의 생성 시각을 같은 축에서 비교한다', () => {
    expect(ids(sortRooms([
      room('old'), room('message', { last_message_at: '2026-09-03T00:00:00Z' }),
      room('new', { created_at: '2026-09-04T00:00:00Z' }),
    ], 'recent_message', false))).toEqual(['new', 'message', 'old']);
  });
  it('세션순은 일정 없는 세션도 비세션보다 앞에 둔다', () => {
    expect(ids(sortRooms([
      room('direct', { last_message_at: '2026-12-01T00:00:00Z' }),
      room('undated', { room_type: 'session' }),
      room('early', { room_type: 'session', session_scheduled_at: '2026-09-01T00:00:00Z' }),
      room('late', { room_type: 'session', session_scheduled_at: '2026-09-02T00:00:00Z' }),
    ], 'recent_session', false))).toEqual(['late', 'early', 'undated', 'direct']);
  });
  it('안읽음 우선을 두 정렬 기준보다 먼저 적용한다', () => {
    for (const mode of ['recent_message', 'recent_session'] as const) {
      expect(ids(sortRooms([room('read', { room_type: 'session' }), room('unread', { unread_count: 2 })], mode, true))).toEqual(['unread', 'read']);
    }
  });
  it('시간대 오프셋이 달라도 실제 시각으로 비교한다', () => {
    expect(ids(sortRooms([room('earlier', { last_message_at: '2026-09-01T09:00:00+09:00' }), room('later', { last_message_at: '2026-09-01T01:00:00Z' })], 'recent_message', false))).toEqual(['later', 'earlier']);
  });
  it('원본 배열과 객체를 변경하지 않고 동률 순서를 유지한다', () => {
    const rooms = Object.freeze([Object.freeze(room('a')), Object.freeze(room('b'))]);
    const sorted = sortRooms(rooms, 'recent_message', false);
    expect(ids(sorted)).toEqual(['a', 'b']);
    expect(sorted).not.toBe(rooms);
    expect(sorted[0]).toBe(rooms[0]);
  });
});

it('direct 레거시 식별자는 제목으로 노출하지 않는다', async () => {
  const { chatRoomDisplayName } = await import('../src/lib/chat-sort');
  expect(chatRoomDisplayName(room('direct', { name: 'private-client-id' }))).toBe('1:1 채팅');
  expect(chatRoomDisplayName(room('direct', { name: 'private-client-id', peer_name: '내담자', display_name: '공유 이름' }))).toBe('공유 이름');
});
it('오늘은 실제 현지 시각을, 다른 날은 날짜를 표시한다', async () => {
  const { formatChatTime } = await import('../src/lib/chat-sort');
  const now = new Date(2026, 8, 25, 15, 0);
  expect(formatChatTime(new Date(2026, 8, 25, 9, 30).toISOString(), now)).toBe('09:30');
  expect(formatChatTime(new Date(2026, 8, 24).toISOString(), now)).toBe('9.24');
});
