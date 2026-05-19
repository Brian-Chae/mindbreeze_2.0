// 세션 관리 API

import { apiClient } from './client';

export type SessionType = 'clinical' | 'hypnosis' | 'meditation';
export type SessionStatus = 'scheduled' | 'in_progress' | 'paused' | 'completed' | 'cancelled';

export interface SessionParticipant {
  user_id: string;
  band_connected: boolean;
  consent_audio: boolean;
  consent_eeg: boolean;
}

export interface SessionDto {
  id: string;
  type: SessionType;
  status: SessionStatus;
  host_id: string;
  scheduled_at: string;
  duration_min: number;
  title: string | null;
  notes: string | null;
  max_participants: number;
  created_at: string;
  participants: SessionParticipant[];
}

export interface SessionListResponse {
  sessions: SessionDto[];
  total: number;
}

export interface CreateSessionPayload {
  type: SessionType;
  scheduled_at: string;
  duration_min: number;
  title?: string;
  notes?: string;
  max_participants?: number;
  participant_ids?: string[];
  force?: boolean;
}

export interface UpdateSessionPayload {
  scheduled_at?: string;
  duration_min?: number;
  title?: string;
  notes?: string;
  max_participants?: number;
  force?: boolean;
}

export const listSessions = (): Promise<SessionListResponse> =>
  apiClient.get<SessionListResponse>('/sessions');

export const getSession = (id: string): Promise<SessionDto> =>
  apiClient.get<SessionDto>(`/sessions/${id}`);

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

export const addMarker = (id: string, timestampSec: number, note: string): Promise<{ markers: unknown[] }> =>
  apiClient.post<{ markers: unknown[] }>(`/sessions/${id}/markers`, { timestamp_sec: timestampSec, note });
