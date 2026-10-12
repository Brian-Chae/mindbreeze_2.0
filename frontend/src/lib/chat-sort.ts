import type { ChatRoom } from './api/chat';

function timestamp(value: string | null | undefined): number {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}

/** 최신 대화순(기본) + 안읽음 우선 정렬. 세션방 제거(SDD-091)로 정렬 모드 없음. */
export function sortRooms(rooms: readonly ChatRoom[], unreadFirst: boolean): ChatRoom[] {
  return [...rooms].sort((a, b) => {
    if (unreadFirst) {
      const unreadOrder = Number(b.unread_count > 0) - Number(a.unread_count > 0);
      if (unreadOrder) return unreadOrder;
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
