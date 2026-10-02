// 세션 관리 API

import { ApiError, apiClient, refreshAccessToken, tokenStorage } from './client';

export type SessionType = 'clinical' | 'hypnosis' | 'meditation' | 'custom';
/** SDD-088: 'open' = 오픈/대기 — 상담사가 클래스를 열어 회원 입장을 받는 단계 */
export type SessionStatus = 'ready' | 'scheduled' | 'open' | 'in_progress' | 'paused' | 'completed' | 'cancelled';
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
  /** SDD-094: 손들기/발언권 상태 — 상담사 UI 표시용 */
  raise_hand?: boolean;
  /** SDD-094: 발언권(송출) 부여 상태 */
  speaking?: boolean;
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
  /** SDD-088: 클래스 오픈(대기실 개방) 시각 */
  opened_at?: string | null;
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
  record_audio: boolean;
  record_video: boolean;
  created_at: string;
  participants: SessionParticipant[];
  waitlist_count: number;
  /** SDD-028: 실행 회차 키(기본=session_id). 반복 실행 표시는 후순위 */
  run_id?: string | null;
  /** SDD-095: 클래스 채팅 활성 여부(상담사 토글) */
  chat_enabled?: boolean;
  /** SDD-095: 세션 채팅방 id — 방 미개설 시 null */
  chat_room_id?: string | null;
  /** SDD-095: 클래스 템플릿 여부 — 템플릿은 실제 진행 대상이 아니며 일반 목록에서 제외된다 */
  is_template?: boolean;
  /** SDD-097: 예약 사전 안내(리마인더) 시점 — 시작 N분 전 정수 목록(빈 배열=끔) */
  reminder_offsets?: number[];
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
  /** AI 클래스 분석 — 영상/음성 녹화 여부(기본 On). Off 시 해당 미디어 리포트 미생성 */
  record_audio?: boolean;
  record_video?: boolean;
  /** SDD-095: 템플릿으로 저장 — 일정·참여자·코드 없이 설정만 보관한다 */
  is_template?: boolean;
  /** SDD-097: 예약 사전 안내(리마인더) 시점 — 시작 N분 전 정수 목록(예: [1440, 60]). 빈 배열=끔 */
  reminder_offsets?: number[];
}

/** SDD-095: 클래스 복제 요청 — 유형 설정은 원본에서 복사, 일정/제목만 선택적으로 덮어쓴다 */
export interface DuplicateSessionPayload {
  scheduled_at?: string;
  title?: string;
  force?: boolean;
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
  record_audio?: boolean;
  record_video?: boolean;
  /** SDD-097: 리마인더 시점 — 주면 교체·재예약, 생략하면 기존 유지 */
  reminder_offsets?: number[];
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
  /** SDD-095: 클래스 채팅 활성 여부 — 회원 입장 화면의 채팅 패널 노출 조건 */
  chat_enabled?: boolean;
  /** SDD-095: 세션 채팅방 id */
  chat_room_id?: string | null;
}

export interface JoinByCodePayload {
  name?: string;
  /** SDD-062: 게스트 성별 — male | female | other */
  gender?: string;
  /** SDD-062: 게스트 생년월일 YYYY-MM-DD */
  birth_date?: string;
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
  email_verify_token: string | null;
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
  /** 몸 지표 — BPM (산출 불가 시 null) */
  heart_rate?: number | null;
  /** 몸 지표 — 호흡수 breaths/min (산출 불가 시 null) */
  respiratory_rate?: number | null;
  /** SDD-094: 손들기 상태 (온라인 그룹에서 기본 뮤트 → 손들기로 발언 요청) */
  raise_hand?: boolean;
  /** SDD-094: 발언권(송출) 부여 상태 — true면 can_publish */
  speaking?: boolean;
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
  /** PPG HRV — 계산 불가 시 null (0 치환 금지) */
  sdnn?: number | null;
  rmssd?: number | null;
  lf_power?: number | null;
  hf_power?: number | null;
  lf_hf_ratio?: number | null;
  heart_rate?: number | null;
  /** PPG RSA 호흡수(breaths/min). 산출 불가 시 null */
  respiratory_rate?: number | null;
  /** 움직임 활동도 0~1 */
  motion?: number | null;
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
  /** SDD-095: 클래스 채팅 활성 여부 */
  chat_enabled?: boolean;
  /** SDD-095: 세션 채팅방 id */
  chat_room_id?: string | null;
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

// ── SDD-095: 클래스 복제 · 템플릿 ──

/**
 * 클래스 복제 — 유형 설정만 복사해 새 클래스를 만든다.
 * 참여코드·실행 회차·WebRTC 룸은 신규 발급되고, 참여자 명단은 복사되지 않는다.
 * payload.scheduled_at 을 주면 그 일정의 예약 클래스로, 없으면 즉시 클래스(ready)로 생성된다.
 */
export const duplicateSession = (
  id: string,
  payload: DuplicateSessionPayload = {},
): Promise<SessionDto> =>
  apiClient.post<SessionDto>(`/sessions/${encodeURIComponent(id)}/duplicate`, payload);

/** 현재 클래스의 유형 설정을 재사용 가능한 템플릿으로 저장한다 */
export const saveSessionAsTemplate = (id: string, title?: string): Promise<SessionDto> =>
  apiClient.post<SessionDto>(`/sessions/${encodeURIComponent(id)}/save-as-template`, {
    title: title ?? null,
  });

/** 내 클래스 템플릿 목록 — 생성 폼의 '내 템플릿에서 시작' 드롭다운용 */
export const listSessionTemplates = (): Promise<SessionListResponse> =>
  apiClient.get<SessionListResponse>('/sessions/templates');

/** 템플릿에서 실제 클래스 만들기 — 템플릿 복제와 동일한 경로를 사용한다 */
export const createSessionFromTemplate = (
  templateId: string,
  payload: DuplicateSessionPayload = {},
): Promise<SessionDto> => duplicateSession(templateId, payload);

export type SessionAction = 'open' | 'start' | 'pause' | 'resume' | 'end' | 'cancel';

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

/** 회원/게스트 구독 전용 LiveKit 토큰 — 상담사 영상·음성 라이브 수신용 */
export interface MemberLiveKitTokenResponse {
  livekit_token: string;
  webrtc_room_id: string;
  /** 온라인 양방향 여부 — true면 회원도 카메라/마이크를 송출한다 */
  can_publish: boolean;
}

export const getMemberLiveKitToken = async (
  code: string,
  participantId: string,
  participantToken?: string | null,
): Promise<MemberLiveKitTokenResponse> => {
  const payload = { participant_id: participantId, participant_token: participantToken ?? null };
  if (tokenStorage.getAccess()) {
    const refreshedToken = await refreshAccessToken();
    if (!refreshedToken) {
      throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해주세요.', null);
    }
    return apiClient.post<MemberLiveKitTokenResponse>(
      `/sessions/by-code/${code}/livekit-token`,
      payload,
    );
  }
  return apiClient.post<MemberLiveKitTokenResponse>(
    `/sessions/by-code/${code}/livekit-token`,
    payload,
    { skipAuth: true },
  );
};

/** SDD-094: 회원/게스트 손들기 — 온라인 그룹에서 발언권을 요청한다 */
export interface RaiseHandResponse {
  participant_id: string;
  raise_hand: boolean;
  speaking?: boolean;
}

/** SDD-094: 상담사 발언권 부여/해제 응답 */
export interface SetSpeakingResponse {
  participant_id: string;
  speaking: boolean;
  raise_hand?: boolean;
}

/**
 * 회원/게스트 손들기.
 * 로그인 회원은 액세스 토큰으로, 비로그인 게스트는 participant_token 소유 증명으로 호출한다
 * (member livekit token 과 동일한 인증 분기).
 */
export const raiseHand = async (
  sessionId: string,
  participantId: string,
  participantToken?: string | null,
): Promise<RaiseHandResponse> => {
  const payload = { participant_token: participantToken ?? null };
  const path = `/sessions/${sessionId}/participants/${participantId}/raise-hand`;
  if (tokenStorage.getAccess()) {
    const refreshedToken = await refreshAccessToken();
    if (!refreshedToken) {
      throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해주세요.', null);
    }
    return apiClient.post<RaiseHandResponse>(path, payload);
  }
  return apiClient.post<RaiseHandResponse>(path, payload, { skipAuth: true });
};

/** 상담사(호스트) 발언권 부여/해제 — granted=false 면 회수 */
export const setParticipantSpeaking = (
  sessionId: string,
  participantId: string,
  granted: boolean,
): Promise<SetSpeakingResponse> =>
  apiClient.post<SetSpeakingResponse>(
    `/sessions/${sessionId}/participants/${participantId}/speaking`,
    { granted },
  );

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
