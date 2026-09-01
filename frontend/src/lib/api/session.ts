// 세션 관리 API

import { ApiError, apiClient, refreshAccessToken, tokenStorage } from './client';

export type SessionType = 'clinical' | 'hypnosis' | 'meditation' | 'custom';
export type SessionStatus = 'ready' | 'scheduled' | 'in_progress' | 'paused' | 'completed' | 'cancelled';
export type LocationType = 'online' | 'offline';
export type ParticipantMode = 'one_on_one' | 'group';
export type LinkbandMode = 'none' | 'required' | 'optional';

export interface SessionParticipant {
  user_id: string | null;
  guest_name: string | null;
  is_guest: boolean;
  band_connected: boolean;
  linkband_device_id: string | null;
  webrtc_peer_id: string | null;
  consent_audio: boolean;
  consent_eeg: boolean;
  is_waitlisted: boolean;
  waitlist_position: number | null;
  user_name?: string;
  user_email?: string;
}

export interface SessionDto {
  id: string;
  type: SessionType;
  custom_type_name: string | null;
  status: SessionStatus;
  host_id: string;
  scheduled_at: string | null;
  access_code: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_min: number;
  title: string | null;
  notes: string | null;
  max_participants: number;
  location_type: LocationType;
  participant_mode: ParticipantMode;
  linkband_mode: LinkbandMode;
  webrtc_room_id: string | null;
  sfu_enabled: boolean;
  created_at: string;
  participants: SessionParticipant[];
  waitlist_count: number;
}

export interface SessionListResponse {
  sessions: SessionDto[];
  total: number;
}

export interface CreateSessionPayload {
  type: SessionType;
  scheduled_at?: string;
  duration_min: number;
  title?: string;
  notes?: string;
  max_participants?: number;
  participant_ids?: string[];
  force?: boolean;
  custom_type_name?: string;
  location_type?: LocationType;
  participant_mode?: ParticipantMode;
  linkband_mode?: LinkbandMode;
  sfu_enabled?: boolean;
}

export interface UpdateSessionPayload {
  scheduled_at?: string;
  duration_min?: number;
  title?: string;
  notes?: string;
  max_participants?: number;
  force?: boolean;
  custom_type_name?: string;
  location_type?: LocationType;
  participant_mode?: ParticipantMode;
  linkband_mode?: LinkbandMode;
  sfu_enabled?: boolean;
}

export interface SessionByCodeResponse {
  id: string;
  access_code: string | null;
  title: string | null;
  type: SessionType;
  custom_type_name: string | null;
  status: SessionStatus;
  host_name: string | null;
  participant_mode: ParticipantMode;
  linkband_mode: LinkbandMode;
  location_type: LocationType;
  participant_count: number;
  max_participants: number;
  started_at: string | null;
  scheduled_at: string | null;
}

export interface JoinByCodePayload {
  name?: string;
}

export interface JoinByCodeResponse {
  session: SessionDto;
  participant_id: string | null;
  is_guest: boolean;
}

export const listSessions = (): Promise<SessionListResponse> =>
  apiClient.get<SessionListResponse>('/sessions');

export const getSession = (id: string): Promise<SessionDto> =>
  apiClient.get<SessionDto>(`/sessions/${id}`);

export const getSessionByCode = (code: string): Promise<SessionByCodeResponse> =>
  apiClient.get<SessionByCodeResponse>(`/sessions/by-code/${code}`, { skipAuth: true });

export const joinSessionByCode = async (
  code: string,
  payload: JoinByCodePayload = {},
): Promise<JoinByCodeResponse> => {
  if (tokenStorage.getAccess()) {
    const refreshedToken = await refreshAccessToken();
    if (!refreshedToken) {
      throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해주세요.', null);
    }
    return apiClient.post<JoinByCodeResponse>(`/sessions/by-code/${code}/join`, payload);
  }

  return apiClient.post<JoinByCodeResponse>(
    `/sessions/by-code/${code}/join`,
    payload,
    { skipAuth: true },
  );
};

export const createSession = (payload: CreateSessionPayload): Promise<SessionDto> =>
  apiClient.post<SessionDto>('/sessions', payload);

export const updateSession = (id: string, payload: UpdateSessionPayload): Promise<SessionDto> =>
  apiClient.put<SessionDto>(`/sessions/${id}`, payload);

export const deleteSession = (id: string): Promise<void> =>
  apiClient.delete<void>(`/sessions/${id}`);

export type SessionAction = 'start' | 'pause' | 'resume' | 'end' | 'cancel';

export const transitionSession = (id: string, action: SessionAction): Promise<SessionDto> =>
  apiClient.post<SessionDto>(`/sessions/${id}/${action}`);

export const inviteParticipant = (id: string, userId: string): Promise<SessionDto> =>
  apiClient.post<SessionDto>(`/sessions/${id}/invite`, { user_id: userId });

export const removeParticipant = (id: string, userId: string): Promise<SessionDto> =>
  apiClient.delete<SessionDto>(`/sessions/${id}/participants/${userId}`);

export const addMarker = (id: string, timestampSec: number, note: string): Promise<{ markers: unknown[] }> =>
  apiClient.post<{ markers: unknown[] }>(`/sessions/${id}/markers`, { timestamp_sec: timestampSec, note });

// LiveKit WebRTC 화상 회의 — 세션 참여 + 토큰 발급
export const joinSession = (id: string): Promise<SessionDto> =>
  apiClient.post<SessionDto>(`/sessions/${id}/join`);

export const getLiveKitToken = (id: string): Promise<{ livekit_token: string; webrtc_room_id: string }> =>
  apiClient.post<{ livekit_token: string; webrtc_room_id: string }>(`/sessions/${id}/livekit-token`);
