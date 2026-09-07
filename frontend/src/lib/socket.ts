// Socket.IO 클라이언트 — /chat · /session-live 네임스페이스 헬퍼
// SDD-026: join snapshot · feature ACK · 상태/참여자/기기 이벤트

import { io, Socket } from 'socket.io-client';
import type {
  DeviceStatus,
  EegFeatureItem,
  SessionLiveMetric,
  SessionStatus,
  UploadStatus,
} from './api/session';
import type { LeadOffStatus } from './eeg/types/eeg';
import type { SignalQualityLevel } from './session-live/signal-status';

const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL as string | undefined) ??
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/api\/v1\/?$/, '') ??
  'http://localhost:8000';

// ── /chat ──────────────────────────────────────────────────────────

let chatSocket: Socket | null = null;

export const getChatSocket = (token: string): Socket => {
  if (chatSocket && chatSocket.connected) return chatSocket;
  if (chatSocket) {
    chatSocket.disconnect();
  }
  chatSocket = io(`${SOCKET_URL}/chat`, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token },
    autoConnect: true,
    reconnection: true,
  });
  return chatSocket;
};

export const disconnectChatSocket = (): void => {
  if (chatSocket) {
    chatSocket.disconnect();
    chatSocket = null;
  }
};

// ── /session-live (SDD-024 / SDD-026) ───────────────────────────────

/** 클라이언트 → 서버: 1초 EEG feature emit */
export interface SessionLiveFeatureEmit {
  session_id: string;
  participant_id: string | null;
  /** 영속 스트림 식별자 — ACK/재전송 키 */
  stream_id: string;
  /** 스트림 내 단조증가 sequence (= second_offset) */
  sequence: number;
  feature: EegFeatureItem;
  band_battery?: number | null;
  device_status?: DeviceStatus | null;
  /** 하드웨어 접촉 (SQI와 분리) */
  lead_off?: LeadOffStatus | null;
  signal_quality?: number | null;
  signal_quality_level?: SignalQualityLevel | null;
}

/** 서버 → 클라이언트: feature 저장 ACK */
export interface SessionLiveFeatureAck {
  session_id: string;
  stream_id: string;
  sequence: number;
  participant_id?: string;
  second_offset?: number | null;
  feature?: Partial<EegFeatureItem> | null;
  saved?: number;
}

/** join 응답 snapshot — status/version/참여자/집계 */
export interface SessionLiveJoinSnapshot {
  session_id: string;
  /** SDD-028: 실행 회차 키(기본=session_id). 반복 실행 UI는 후순위 */
  run_id?: string | null;
  status: SessionStatus | string;
  version: number;
  started_at?: string | null;
  ended_at?: string | null;
  participants: SessionLiveMetric[];
  aggregates?: {
    participants?: number;
    lead_off?: number;
    connection_failed?: number;
    low_battery?: number;
    avg_efficiency?: number | null;
  };
}

export interface SessionLiveJoinedEvent {
  session_id: string;
  /** SDD-026: snapshot이 포함되면 폴백 중단 가능 */
  snapshot?: SessionLiveJoinSnapshot | null;
  version?: number;
  status?: SessionStatus | string;
  participants?: SessionLiveMetric[];
  started_at?: string | null;
  ended_at?: string | null;
  aggregates?: SessionLiveJoinSnapshot['aggregates'];
}

export interface SessionStateChangedEvent {
  session_id: string;
  version: number;
  status: SessionStatus | string;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface ParticipantChangedEvent {
  session_id: string;
  version: number;
  participants: SessionLiveMetric[];
}

export interface DeviceStatusChangedEvent {
  session_id: string;
  version: number;
  participant_id: string;
  device_status?: DeviceStatus | null;
  band_connected?: boolean;
  band_battery?: number | null;
  last_eeg_at?: string | null;
  lead_off?: LeadOffStatus | null;
  signal_quality?: number | null;
  signal_quality_level?: SignalQualityLevel | null;
}

/** 서버 → 클라이언트: room broadcast `eeg_feature` */
export interface SessionLiveEegFeatureEvent {
  session_id: string;
  /** SDD-028: 실행 회차 키 — 증분 반영 시 필터/표시용(선택) */
  run_id?: string | null;
  participant_id: string;
  feature?: EegFeatureItem;
  stream_id?: string;
  sequence?: number;
  /** 두뇌휴식도 — feature.relaxation_index 와 동일 의미 */
  relaxation_index?: number | null;
  current_efficiency?: number | null;
  focus_index?: number | null;
  stress_index?: number | null;
  signal_quality?: number | null;
  signal_quality_level?: SignalQualityLevel | null;
  band_battery?: number | null;
  device_status?: DeviceStatus | null;
  lead_off?: LeadOffStatus | null;
  band_connected?: boolean;
  upload_status?: UploadStatus;
  last_eeg_at?: string | null;
  saved?: number;
}

export type SessionLiveEegFeatureHandler = (event: SessionLiveEegFeatureEvent) => void;
export type SessionLiveFeatureAckHandler = (ack: SessionLiveFeatureAck) => void;
export type SessionLiveJoinedHandler = (event: SessionLiveJoinedEvent) => void;
export type SessionStateChangedHandler = (event: SessionStateChangedEvent) => void;
export type ParticipantChangedHandler = (event: ParticipantChangedEvent) => void;
export type DeviceStatusChangedHandler = (event: DeviceStatusChangedEvent) => void;

let sessionLiveSocket: Socket | null = null;
let sessionLiveToken: string | null | undefined = undefined;

/**
 * `/session-live` 싱글톤 소켓.
 * 게스트(비로그인)는 token=null 로 연결한다 (record 네임스페이스와 동일 정책).
 */
export const getSessionLiveSocket = (token: string | null = null): Socket => {
  // 토큰이 바뀌면 재연결
  if (sessionLiveSocket && sessionLiveToken === token) {
    return sessionLiveSocket;
  }
  if (sessionLiveSocket) {
    sessionLiveSocket.disconnect();
    sessionLiveSocket = null;
  }

  sessionLiveToken = token;
  sessionLiveSocket = io(`${SOCKET_URL}/session-live`, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: token ? { token } : {},
    autoConnect: true,
    reconnection: true,
  });
  return sessionLiveSocket;
};

export const disconnectSessionLiveSocket = (): void => {
  if (sessionLiveSocket) {
    sessionLiveSocket.disconnect();
    sessionLiveSocket = null;
    sessionLiveToken = undefined;
  }
};

export interface SessionLiveJoinPayload {
  session_id: string;
  participant_id?: string | null;
}

/** room `session:{id}` 진입 — participant_id는 권한·본인 EEG 스코프용 */
export const joinSessionLive = (
  socket: Socket,
  sessionId: string,
  participantId?: string | null,
): void => {
  const payload: SessionLiveJoinPayload = {
    session_id: sessionId,
    ...(participantId ? { participant_id: participantId } : {}),
  };
  if (socket.connected) {
    socket.emit('join', payload);
  } else {
    socket.once('connect', () => {
      socket.emit('join', payload);
    });
  }
};

/** room 퇴장 */
export const leaveSessionLive = (socket: Socket, sessionId: string): void => {
  if (!socket.connected) return;
  socket.emit('leave', { session_id: sessionId });
};

/**
 * 1초 feature 업로드.
 * emit 성공 ≠ 저장 성공 — ACK 전까지 미확정 큐에 유지해야 한다.
 */
export const emitSessionLiveFeature = (
  socket: Socket,
  payload: SessionLiveFeatureEmit,
): boolean => {
  if (!socket.connected) return false;
  socket.emit('feature', payload);
  return true;
};

/** `joined` 구독 — snapshot 포함 가능 */
export const subscribeSessionLiveJoined = (
  socket: Socket,
  handler: SessionLiveJoinedHandler,
): (() => void) => {
  socket.on('joined', handler);
  return () => {
    socket.off('joined', handler);
  };
};

/** `feature_ack` 구독 */
export const subscribeSessionLiveFeatureAck = (
  socket: Socket,
  handler: SessionLiveFeatureAckHandler,
): (() => void) => {
  socket.on('feature_ack', handler);
  return () => {
    socket.off('feature_ack', handler);
  };
};

/** `eeg_feature` 구독 — 해제 함수 반환 */
export const subscribeSessionLiveEegFeature = (
  socket: Socket,
  handler: SessionLiveEegFeatureHandler,
): (() => void) => {
  socket.on('eeg_feature', handler);
  return () => {
    socket.off('eeg_feature', handler);
  };
};

export const subscribeSessionStateChanged = (
  socket: Socket,
  handler: SessionStateChangedHandler,
): (() => void) => {
  socket.on('session_state_changed', handler);
  return () => {
    socket.off('session_state_changed', handler);
  };
};

export const subscribeParticipantChanged = (
  socket: Socket,
  handler: ParticipantChangedHandler,
): (() => void) => {
  socket.on('participant_changed', handler);
  return () => {
    socket.off('participant_changed', handler);
  };
};

export const subscribeDeviceStatusChanged = (
  socket: Socket,
  handler: DeviceStatusChangedHandler,
): (() => void) => {
  socket.on('device_status_changed', handler);
  return () => {
    socket.off('device_status_changed', handler);
  };
};

/**
 * joined 페이로드를 snapshot으로 정규화.
 * snapshot 필드가 있거나 version+participants가 top-level이면 유효 snapshot.
 */
export function normalizeJoinSnapshot(
  event: SessionLiveJoinedEvent,
): SessionLiveJoinSnapshot | null {
  if (event.snapshot && typeof event.snapshot.version === 'number') {
    return {
      ...event.snapshot,
      session_id: event.snapshot.session_id || event.session_id,
      participants: event.snapshot.participants ?? [],
    };
  }
  if (typeof event.version === 'number') {
    return {
      session_id: event.session_id,
      status: event.status ?? 'in_progress',
      version: event.version,
      started_at: event.started_at ?? null,
      ended_at: event.ended_at ?? null,
      participants: event.participants ?? [],
      aggregates: event.aggregates,
    };
  }
  return null;
}

export { SOCKET_URL };
