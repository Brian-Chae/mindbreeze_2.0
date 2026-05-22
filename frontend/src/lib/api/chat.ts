// 채팅 REST API 클라이언트

import { apiClient } from './client';

export type ChatMessageType = 'text' | 'image' | 'file' | 'system';
export type RoomType = 'direct' | 'session' | 'group';

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string | null;
  type: ChatMessageType;
  content: string | null;
  file_url: string | null;
  event_type: string | null;
  created_at: string;
}

export interface ChatRoom {
  id: string;
  session_id: string | null;
  room_type: RoomType;
  host_id: string | null;
  name: string | null;
  created_at: string;
  unread_count: number;
}

export interface ChatRoomListResponse {
  rooms: ChatRoom[];
}

export interface ChatMessageListResponse {
  messages: ChatMessage[];
  next_cursor: string | null;
}

export interface SendMessagePayload {
  content: string;
  type?: ChatMessageType;
  file_url?: string;
}

export interface CreateDirectRoomPayload {
  client_id: string;
  room_type: 'direct';
}

export interface CreateGroupRoomPayload {
  participant_ids: string[];
  room_type: 'group';
  name?: string;
}

export const listChatRooms = (): Promise<ChatRoomListResponse> =>
  apiClient.get<ChatRoomListResponse>('/chat/rooms');

export const createDirectRoom = (payload: CreateDirectRoomPayload): Promise<ChatRoom> =>
  apiClient.post<ChatRoom>('/chat/rooms', payload);

export const createGroupRoom = (payload: CreateGroupRoomPayload): Promise<ChatRoom> =>
  apiClient.post<ChatRoom>('/chat/rooms', payload);

export const getChatRoom = (roomId: string): Promise<ChatRoom> =>
  apiClient.get<ChatRoom>(`/chat/rooms/${roomId}`);

export const listChatMessages = (roomId: string, limit = 50): Promise<ChatMessageListResponse> =>
  apiClient.get<ChatMessageListResponse>(`/chat/rooms/${roomId}/messages?limit=${limit}`);

export const sendChatMessage = (roomId: string, payload: SendMessagePayload): Promise<ChatMessage> =>
  apiClient.post<ChatMessage>(`/chat/rooms/${roomId}/messages`, payload);

export const markRoomRead = (roomId: string): Promise<void> =>
  apiClient.put<void>(`/chat/rooms/${roomId}/read`);
