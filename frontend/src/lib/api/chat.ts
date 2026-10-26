// 채팅 REST API 클라이언트

import { apiClient, ApiError } from './client';
import type { UserRole } from './auth';
import { OPERATIONS_EMAIL } from '../legal-copy';

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
  /** SDD-220: direct 방 상대와 상호 차단 상태(서버 판정) */
  is_blocked?: boolean;
  /** SDD-220: direct 방 상대가 탈퇴한 사용자인지 */
  peer_deleted?: boolean;
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

// ── SDD-220: 채팅 신고 → 즉시 상호 차단 ──────────────────────────────

export type ChatReportReason = 'abuse' | 'spam' | 'sexual' | 'privacy' | 'other';

/** 신고 사유(선택 입력). 사용자 노출 문구는 한국어. */
export const CHAT_REPORT_REASONS: ReadonlyArray<{ value: ChatReportReason; label: string }> = [
  { value: 'abuse', label: '욕설·비하·괴롭힘' },
  { value: 'sexual', label: '불쾌하거나 선정적인 내용' },
  { value: 'spam', label: '광고·스팸' },
  { value: 'privacy', label: '개인정보 노출' },
  { value: 'other', label: '기타' },
];

/** 신고·차단 문의를 받는 운영 이메일 — 승인된 공개 문의 주소와 같다([MB261026][FIX] 개인 주소 노출 제거). */
export const CHAT_REPORT_CONTACT_EMAIL = OPERATIONS_EMAIL;

/** 신고 처리 기한 안내(D4 승인: 접수 확인 2영업일 · 1차 판단 5영업일). 약관 문구와 같은 약속이다. */
export const CHAT_REPORT_HANDLING_NOTICE = '운영팀이 영업일 기준 2일 안에 접수를 확인하고, 5일 안에 1차 판단해요.';

export interface ChatReportPayload {
  target_user_id: string;
  room_id?: string;
  message_id?: string;
  reason?: ChatReportReason;
  /** 같은 신고를 재전송해도 중복 접수되지 않게 하는 키 */
  operation_key: string;
}

export interface ChatReportResult {
  reported: boolean;
  blocked: boolean;
  report_id: string;
}

export const reportChatUser = (payload: ChatReportPayload): Promise<ChatReportResult> =>
  apiClient.post<ChatReportResult>('/chat/reports', payload);

/** 서버 게시 필터가 운영정책 위반 표현으로 거부했는지(detail.code === 'CHAT_CONTENT_BLOCKED') — [MB261026][FIX] */
export function isChatContentBlockedError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 422) return false;
  const data = error.data as { detail?: { code?: string } } | null;
  return data?.detail?.code === 'CHAT_CONTENT_BLOCKED';
}

/** 서버가 차단 때문에 거부했는지(detail.code === 'CHAT_BLOCKED') */
export function isChatBlockedError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const data = error.data as { detail?: { code?: string } } | null;
  return data?.detail?.code === 'CHAT_BLOCKED';
}

// ── 차단 목록·해제, 신고 철회 ──────────────────────────────

export interface ChatBlockItem {
  user_id: string;
  name: string | null;
  blocked_at: string | null;
  report_id: string | null;
  /** submitted(접수) | withdrawn(철회) | 관리자 처리 상태 */
  report_status: string | null;
}

export const listChatBlocks = (): Promise<{ blocks: ChatBlockItem[] }> =>
  apiClient.get<{ blocks: ChatBlockItem[] }>('/chat/blocks');

export const unblockChatUser = (userId: string): Promise<{ unblocked: boolean }> =>
  apiClient.delete<{ unblocked: boolean }>(`/chat/blocks/${encodeURIComponent(userId)}`);

export const withdrawChatReport = (reportId: string): Promise<{ report_id: string; status: string }> =>
  apiClient.post<{ report_id: string; status: string }>(`/chat/reports/${encodeURIComponent(reportId)}/withdraw`);
