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
  /** SDD-028: 실행 회차 키(기본=session_id). 반복 실행 표시는 후순위 */
  run_id?: string | null;
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
  /** SDD-029: 게스트 리포트 메일 소유 증명 — 공개 참가자 목록에는 미포함 */
  participant_token?: string | null;
}

/** SDD-029: 완료 세션 리포트 메일 요청 */
export interface ReportEmailRequest {
  participant_id: string;
  email: string;
  email_verify_token: string;
  participant_token?: string | null;
}

export type ReportEmailStatus = 'pending_review' | 'queued' | 'sent' | string;

export interface ReportEmailResponse {
  status: ReportEmailStatus;
  message: string;
}

/** 호스트 라이브 모니터링 — 참가자별 실시간(placeholder) 지표 */
export type DeviceStatus = 'ok' | 'lead_off' | 'disconnected' | 'unsupported' | 'unknown';
export type UploadStatus = 'idle' | 'streaming' | 'delayed' | 'failed' | 'completed' | null;

export interface SessionLiveMetric {
  participant_id: string;
  user_id?: string | null;
  display_name: string;
  is_guest: boolean;
  band_connected: boolean;
  /** 접촉(LeadOff) — SQI와 분리. unknown을 ok로 표시하지 않음 */
  device_status: DeviceStatus | null;
  band_battery: number | null;
  avg_efficiency: number | null;
  current_efficiency: number | null;
  upload_status: UploadStatus;
  last_eeg_at: string | null;
  /** 신호품질 0~1 (SQI). 접촉과 별도 */
  signal_quality?: number | null;
  /** ok | degraded | invalid | unknown */
  signal_quality_level?: 'ok' | 'degraded' | 'invalid' | 'unknown' | null;
}

export interface SessionLiveMetricsResponse {
  /** SDD-023 BE 계약 — 참가자별 라이브 지표 */
  metrics: SessionLiveMetric[];
  /** 하위 호환 — 일부 호출부가 participants 를 기대할 수 있음 */
  participants?: SessionLiveMetric[];
}

/** 1초 EEG feature — POST /sessions/{id}/features 배치 항목 */
export interface EegFeatureItem {
  second_offset: number;
  timestamp?: number | null;
  delta_power?: number | null;
  theta_power?: number | null;
  alpha_power?: number | null;
  beta_power?: number | null;
  gamma_power?: number | null;
  total_power?: number | null;
  focus_index?: number | null;
  relaxation_index?: number | null;
  stress_index?: number | null;
  meditation_level?: number | null;
  attention_level?: number | null;
  cognitive_load?: number | null;
  emotional_stability?: number | null;
  hemispheric_balance?: number | null;
  /** 0~1 신호 품질 */
  signal_quality?: number | null;
}

export interface EegFeatureBatchPayload {
  participant_id?: string | null;
  features: EegFeatureItem[];
}

export interface EegFeatureBatchResponse {
  session_id: string;
  saved: number;
}

/** 게스트 by-code 상태 — waiting→meditation 전이 감지용 */
export type GuestState = 'waiting' | 'meditation' | 'complete' | string;

export interface SessionByCodeStateResponse {
  status: SessionStatus;
  guest_state?: GuestState;
  /** BE는 participant_state 로도 내려줄 수 있음 */
  participant_state?: string | null;
  started_at?: string | null;
  duration_min?: number | null;
  title?: string | null;
  /** SDD-023: 게스트 본인 최신 EEG (미착용 시 null) */
  band_connected?: boolean;
  relaxation_index?: number | null;
  focus_index?: number | null;
  stress_index?: number | null;
  signal_quality?: number | null;
  last_eeg_at?: string | null;
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

/** 호스트 콘솔용 참가자 라이브 지표 */
export const getSessionLiveMetrics = async (
  id: string,
): Promise<SessionLiveMetricsResponse> => {
  const res = await apiClient.get<SessionLiveMetricsResponse>(
    `/sessions/${id}/live-metrics`,
  );
  // BE는 metrics, 구 FE는 participants — 양쪽 정규화
  const rows = res.metrics ?? res.participants ?? [];
  return { ...res, metrics: rows, participants: rows };
};

/** SDD-023: 5초 배치 EEG feature 업로드 */
export const postSessionFeatures = (
  id: string,
  payload: EegFeatureBatchPayload,
  options?: { skipAuth?: boolean },
): Promise<EegFeatureBatchResponse> =>
  apiClient.post<EegFeatureBatchResponse>(`/sessions/${id}/features`, payload, {
    skipAuth: options?.skipAuth ?? false,
  });

/** 게스트 대기/명상 전이용 세션 상태 */
export const getSessionByCodeState = (
  code: string,
  participantId: string,
): Promise<SessionByCodeStateResponse> =>
  apiClient.get<SessionByCodeStateResponse>(
    `/sessions/by-code/${code}/state?participant_id=${encodeURIComponent(participantId)}`,
    { skipAuth: true },
  );

/** SDD-029: 인증된 이메일로 리포트 메일 발송 요청 (202 pending_review/queued/sent) */
export const requestReportEmail = (
  sessionId: string,
  payload: ReportEmailRequest,
  options?: { skipAuth?: boolean },
): Promise<ReportEmailResponse> =>
  apiClient.post<ReportEmailResponse>(`/sessions/${sessionId}/report-email`, payload, {
    skipAuth: options?.skipAuth ?? false,
  });
