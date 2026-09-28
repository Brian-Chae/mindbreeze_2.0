// 채팅 REST API 클라이언트

import { apiClient, ApiError } from './client';
import type { UserRole } from './auth';

export type ChatMessageType = 'text' | 'image' | 'file' | 'system';
export type RoomType = 'direct' | 'session' | 'group';

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string | null;
  sender_name?: string | null;
  type: ChatMessageType;
  content: string | null;
  file_url: string | null;
  event_type: string | null;
  created_at: string;
  unread_count?: number;
  read_count?: number;
  read_by?: string[];
  recipient_count?: number;
}

export interface ChatRoom {
  id: string;
  session_id: string | null;
  room_type: RoomType;
  host_id: string | null;
  name: string | null;
  peer_name: string | null;
  peer_id: string | null;
  session_title: string | null;
  session_scheduled_at: string | null;
  participant_count: number;
  created_at: string;
  unread_count: number;
  last_message_at?: string | null;
  custom_name?: string | null;
  display_name?: string | null;
  can_rename?: boolean;
  rename_disabled_reason?: string | null;
  last_message?: {
    content: string | null;
    created_at: string;
  } | null;
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
  event_type?: string;
  file_url?: string;
}

export interface CreateDirectRoomPayload {
  client_id: string;
  room_type: 'direct';
  name?: string;
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

export interface UpdateChatRoomPayload {
  name: string;
}

export interface ChatRoomParticipant {
  user_id: string;
  name: string;
  joined_at?: string;
  role?: UserRole;
}

export interface ChatRoomParticipantsResponse {
  participants: ChatRoomParticipant[];
}

export const updateChatRoom = (roomId: string, payload: UpdateChatRoomPayload): Promise<ChatRoom> =>
  apiClient.patch<ChatRoom>(`/chat/rooms/${roomId}`, payload);

export const listChatRoomParticipants = (roomId: string): Promise<ChatRoomParticipantsResponse> =>
  apiClient.get<ChatRoomParticipantsResponse>(`/chat/rooms/${roomId}/participants`);

export const addChatRoomParticipants = (roomId: string, participantIds: string[]): Promise<ChatRoom> =>
  apiClient.post<ChatRoom>(`/chat/rooms/${roomId}/participants`, { participant_ids: participantIds });

export const removeChatRoomParticipant = (roomId: string, userId: string): Promise<void> =>
  apiClient.delete<void>(`/chat/rooms/${roomId}/participants/${userId}`);

export const listChatMessages = (roomId: string, limit = 50): Promise<ChatMessageListResponse> =>
  apiClient.get<ChatMessageListResponse>(`/chat/rooms/${roomId}/messages?limit=${limit}`);

export const sendChatMessage = (roomId: string, payload: SendMessagePayload): Promise<ChatMessage> =>
  apiClient.post<ChatMessage>(`/chat/rooms/${roomId}/messages`, payload);

export const markRoomRead = (roomId: string): Promise<void> =>
  apiClient.put<void>(`/chat/rooms/${roomId}/read`);

/** 여러 메시지를 한 번에 읽음 처리 (IntersectionObserver 배치 전송) */
export const markMessagesRead = (roomId: string, messageIds: string[]): Promise<void> =>
  apiClient.post<void>(`/chat/rooms/${roomId}/messages/read`, { message_ids: messageIds });

interface ChatMessageContextResponse {
  message: ChatMessage;
  before: ChatMessage[];
  after: ChatMessage[];
  before_cursor: string | null;
  after_cursor: string | null;
}

// ── SDD-095: 클래스(세션) 채팅 ──────────────────────────────────────

/** 세션의 채팅방 — room_type="session" 방을 세션 기준으로 해석한 결과 */
export interface SessionChatRoomResponse {
  /** 방 미개설(마이그레이션 이전 세션 등)이면 null */
  room_id: string | null;
  room_type?: RoomType;
  session_id?: string | null;
  /** 서버가 함께 내려주면 세션 토글 상태로도 쓴다 */
  chat_enabled?: boolean;
}

/** 세션 채팅방 조회 — 방이 아직 개설되지 않았으면 서버가 404를 낸다 */
export const getSessionChatRoom = (sessionId: string): Promise<SessionChatRoomResponse> =>
  apiClient.get<SessionChatRoomResponse>(`/sessions/${encodeURIComponent(sessionId)}/chat-room`);

export interface SetSessionChatEnabledResponse {
  chat_enabled: boolean;
  room_id?: string | null;
}

/** 상담사(호스트) 채팅 켜기/끄기 — 서버가 호스트 권한을 검증한다 */
export const setSessionChatEnabled = (
  sessionId: string,
  enabled: boolean,
): Promise<SetSessionChatEnabledResponse> =>
  apiClient.post<SetSessionChatEnabledResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/chat-enabled`,
    { enabled },
  );

/** 주변 조회는 기존 메시지 저장소와 동일하게 최신순으로 반환한다. */
export async function listChatMessagesAround(roomId: string, messageId: string): Promise<ChatMessageListResponse> {
  const room = encodeURIComponent(roomId);
  const message = encodeURIComponent(messageId);
  try {
    return await apiClient.get<ChatMessageListResponse>(
      `/chat/rooms/${room}/messages-around?message_id=${message}`,
    );
  } catch (error) {
    // SDD-093의 context 경로를 먼저 배포한 서버와 호환한다.
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    const context = await apiClient.get<ChatMessageContextResponse>(
      `/chat/rooms/${room}/messages/${message}/context`,
    );
    return {
      messages: [...context.before, context.message, ...context.after].reverse(),
      next_cursor: context.before_cursor,
    };
  }
}
