// 채팅 전역 상태 (Zustand)

import { create } from 'zustand';
import type { ChatMessage, ChatRoom } from '../lib/api/chat';

interface ChatState {
  rooms: ChatRoom[];
  messagesByRoom: Record<string, ChatMessage[]>;
  activeRoomId: string | null;

  setRooms: (rooms: ChatRoom[]) => void;
  setMessages: (roomId: string, messages: ChatMessage[]) => void;
  appendMessage: (roomId: string, message: ChatMessage) => void;
  setActiveRoom: (roomId: string | null) => void;
  clearRoomUnread: (roomId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  rooms: [],
  messagesByRoom: {},
  activeRoomId: null,

  setRooms: (rooms) => set({ rooms }),
  setMessages: (roomId, messages) =>
    set((state) => ({
      messagesByRoom: { ...state.messagesByRoom, [roomId]: messages },
    })),
  appendMessage: (roomId, message) =>
    set((state) => {
      const prev = state.messagesByRoom[roomId] ?? [];
      if (prev.some((m) => m.id === message.id)) return state;
      return {
        messagesByRoom: { ...state.messagesByRoom, [roomId]: [message, ...prev] },
      };
    }),
  setActiveRoom: (roomId) => set({ activeRoomId: roomId }),
  clearRoomUnread: (roomId) =>
    set((state) => ({
      rooms: state.rooms.map((r) => (r.id === roomId ? { ...r, unread_count: 0 } : r)),
    })),
}));
