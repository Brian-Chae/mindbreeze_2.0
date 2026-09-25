import type { ChatRoom } from './api/chat';

export type ChatSortMode = 'recent_message' | 'recent_session';

function timestamp(value: string | null | undefined): number {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

/** 서버 배열을 보존하고 실제 시각 기준으로 안정 정렬한다. */
export function sortRooms(rooms: readonly ChatRoom[], mode: ChatSortMode, unreadFirst: boolean): ChatRoom[] {
  return [...rooms].sort((a, b) => {
    if (unreadFirst) {
      const unreadOrder = Number(b.unread_count > 0) - Number(a.unread_count > 0);
      if (unreadOrder) return unreadOrder;
    }
    if (mode === 'recent_session') {
      const sessionOrder = Number(b.room_type === 'session') - Number(a.room_type === 'session');
      if (sessionOrder) return sessionOrder;
      if (a.room_type === 'session' && b.room_type === 'session') {
        const scheduledOrder = Number(Boolean(b.session_scheduled_at)) - Number(Boolean(a.session_scheduled_at));
        if (scheduledOrder) return scheduledOrder;
        const timeOrder = timestamp(b.session_scheduled_at) - timestamp(a.session_scheduled_at);
        if (timeOrder) return timeOrder;
      }
    }
    return timestamp(b.last_message_at ?? b.created_at) - timestamp(a.last_message_at ?? a.created_at);
  });
}

/** direct의 name은 식별자이므로 표시 이름으로 사용하지 않는다. */
export function chatRoomDisplayName(room: ChatRoom): string {
  if (room.display_name?.trim()) return room.display_name;
  if (room.room_type === 'direct') return room.custom_name?.trim() || room.peer_name || '1:1 채팅';
  if (room.room_type === 'group') return room.custom_name?.trim() || room.name?.trim() || '그룹 채팅';
  return room.session_title || '세션';
}

export function lastMessagePreview(room: ChatRoom, fallback: string): string {
  const content = room.last_message?.content;
  return content ? Array.from(content).slice(0, 40).join('') + (Array.from(content).length > 40 ? '…' : '') : fallback;
}

export function formatChatTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return `${date.getMonth() + 1}.${date.getDate()}`;
}
