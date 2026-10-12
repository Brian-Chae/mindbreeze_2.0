import type { User, UserRole } from './auth';
import { apiClient } from './client';
import type { ChatRoom } from './chat';

export type InviteRole = Extract<UserRole, 'counselor' | 'org_admin' | 'client'>;
export type InviteMode = 'existing' | 'fork';
export interface InvitableCounselor {
  user_id: string;
  name: string;
  role: 'counselor' | 'org_admin';
  org_names: string[];
}
export interface InvitableCounselorsResponse {
  counselors: InvitableCounselor[];
  total: number;
  page: number;
}
export interface InviteSearchParams { q?: string; page?: number; size?: number }
export interface ForkChatRoomPayload { participant_ids: string[]; name?: string }
export interface InviteCandidate {
  userId: string;
  name: string;
  role: InviteRole;
  email?: string;
  orgNames: string[];
}

// 기관 공유 여부와 active 멤버십은 서버가 최종 검증한다.
export function canInviteToRoom(room: ChatRoom, user: Pick<User, 'id' | 'role'> | null | undefined): boolean {
  return !!user && !!room.host_id && (room.room_type === 'group' || room.room_type === 'direct')
    && (user.role === 'org_admin' || (user.role === 'counselor' && room.host_id === user.id));
}

export const listInvitableCounselors = (params: InviteSearchParams = {}): Promise<InvitableCounselorsResponse> => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.size !== undefined) search.set('size', String(params.size));
  const query = search.toString();
  return apiClient.get<InvitableCounselorsResponse>(`/chat/invitable-counselors${query ? `?${query}` : ''}`);
};
export const forkChatRoom = (roomId: string, payload: ForkChatRoomPayload): Promise<ChatRoom> =>
  apiClient.post<ChatRoom>(`/chat/rooms/${roomId}/fork`, payload);

export function inviteRoomMetadata(room: ChatRoom): Partial<ChatRoom> {
  return {
    name: room.name, custom_name: room.custom_name, display_name: room.display_name,
    host_id: room.host_id, peer_id: room.peer_id, peer_name: room.peer_name,
    participant_count: room.participant_count, can_rename: room.can_rename,
    rename_disabled_reason: room.rename_disabled_reason,
  };
}
export const inviteRoleLabel = (role: InviteRole): string =>
  role === 'client' ? '내담자' : role === 'org_admin' ? '기관 관리자' : '상담사';
