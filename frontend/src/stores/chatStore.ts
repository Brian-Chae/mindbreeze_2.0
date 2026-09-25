// 채팅 전역 상태 (Zustand)

import { create } from 'zustand';
import type { ChatMessage, ChatRoom } from '../lib/api/chat';

interface ChatState {
  rooms: ChatRoom[];
  messagesByRoom: Record<string, ChatMessage[]>;
  activeRoomId: string | null;

  setRooms: (rooms: ChatRoom[]) => void;
  updateRoom: (roomId: string, changes: Partial<ChatRoom>) => void;
  updateRoomLastMessage: (roomId: string, preview: NonNullable<ChatRoom["last_message"]>) => void;
  setMessages: (roomId: string, messages: ChatMessage[]) => void;
  appendMessage: (roomId: string, message: ChatMessage) => void;
  setActiveRoom: (roomId: string | null) => void;
  clearRoomUnread: (roomId: string) => void;
  incrementUnread: (roomId: string) => void;
  updateSenderName: (senderId: string, newName: string) => void;
  updateMessageReadCount: (roomId: string, messageId: string, readCount: number, unreadCount: number, readBy?: string[]) => void;
  markAllMessagesRead: (roomId: string, readerId?: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  rooms: [],
  messagesByRoom: {},
  activeRoomId: null,

  setRooms: (rooms) => set({ rooms }),
  updateRoom: (roomId, changes) => set((state) => ({
    rooms: state.rooms.map((room) => room.id === roomId ? { ...room, ...changes, id: room.id } : room),
  })),
  updateRoomLastMessage: (roomId, preview) => set((state) => ({
    rooms: state.rooms.map((room) => {
      if (room.id !== roomId) return room;
      const previous = room.last_message_at ?? room.last_message?.created_at;
      if (previous && Date.parse(previous) > Date.parse(preview.created_at)) return room;
      return { ...room, last_message: { ...preview }, last_message_at: preview.created_at };
    }),
  })),
  setMessages: (roomId, messages) =>
    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: messages },
    })),
  appendMessage: (roomId, message) => {
    get().updateRoomLastMessage(roomId, {
      content: message.type === 'image' ? '사진' : message.type === 'file' ? '파일' : message.content,
      created_at: message.created_at,
    });
    set((state) => {
      const prev = state.messagesByRoom[roomId] ?? [];
      if (prev.some((m) => m.id === message.id)) return state;
      return {
        messagesByRoom: { ...state.messagesByRoom, [roomId]: [message, ...prev] },
      };
    });
  },
  setActiveRoom: (roomId) => set({ activeRoomId: roomId }),
  clearRoomUnread: (roomId) =>
    set((state) => ({
      rooms: state.rooms.map((r) => (r.id === roomId ? { ...r, unread_count: 0 } : r)),
    })),
  incrementUnread: (roomId) =>
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.id === roomId ? { ...r, unread_count: (r.unread_count ?? 0) + 1 } : r,
      ),
    })),
  updateSenderName: (senderId, newName) =>
    set((state) => {
      const updated: Record<string, ChatMessage[]> = {};
      let changed = false;
      for (const [roomId, msgs] of Object.entries(state.messagesByRoom)) {
        const newMsgs = msgs.map((m) =>
          m.sender_id === senderId ? { ...m, sender_name: newName } : m,
        );
        if (newMsgs !== msgs) changed = true;
        updated[roomId] = newMsgs;
      }
      if (!changed) return state;
      return { messagesByRoom: updated };
    }),

  updateMessageReadCount: (roomId, messageId, readCount, unreadCount, readBy) =>
    set((state) => {
      const msgs = state.messagesByRoom[roomId];
      if (!msgs) return state;
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: msgs.map((m) =>
            m.id === messageId
              ? { ...m, read_count: readCount, unread_count: unreadCount, read_by: readBy ?? m.read_by }
              : m,
          ),
        },
      };
    }),

  markAllMessagesRead: (roomId, readerId) =>
    set((state) => {
      const msgs = state.messagesByRoom[roomId];
      if (!msgs) return state;
      return {
        messagesByRoom: {
          ...state.messagesByRoom,
          [roomId]: msgs.map((m) => {
            // readerId가 보낸 메시지는 건드리지 않음 (자기 메시지 읽음 방지)
            if (readerId && m.sender_id === readerId) return m;

            const currentReadBy = m.read_by ?? [];
            const newReadBy = readerId && !currentReadBy.includes(readerId)
              ? [...currentReadBy, readerId]
              : currentReadBy;
            return {
              ...m,
              unread_count: 0,
              read_by: newReadBy,
            };
          }),
        },
      };
    }),
}));
