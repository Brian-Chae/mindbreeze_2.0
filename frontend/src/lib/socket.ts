// Socket.IO 클라이언트 — /chat · /session-live 네임스페이스 헬퍼

import { io, Socket } from 'socket.io-client';
import type { DeviceStatus, EegFeatureItem, UploadStatus } from './api/session';

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

// ── /session-live (SDD-024) ────────────────────────────────────────

/** 클라이언트 → 서버: 1초 EEG feature emit */
export interface SessionLiveFeatureEmit {
  session_id: string;
  participant_id: string | null;
  feature: EegFeatureItem;
  band_battery?: number | null;
  device_status?: DeviceStatus | null;
}

/** 서버 → 클라이언트: room broadcast `eeg_feature` */
export interface SessionLiveEegFeatureEvent {
  session_id: string;
  participant_id: string;
  feature?: EegFeatureItem;
  /** 두뇌휴식도 — feature.relaxation_index 와 동일 의미 */
  relaxation_index?: number | null;
  current_efficiency?: number | null;
  focus_index?: number | null;
  stress_index?: number | null;
  signal_quality?: number | null;
  band_battery?: number | null;
  device_status?: DeviceStatus | null;
  band_connected?: boolean;
  upload_status?: UploadStatus;
  last_eeg_at?: string | null;
}

export type SessionLiveEegFeatureHandler = (event: SessionLiveEegFeatureEvent) => void;

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

/** room `session:{id}` 진입 */
export const joinSessionLive = (socket: Socket, sessionId: string): void => {
  const payload = { session_id: sessionId };
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

/** 1초 feature 업로드 (저장+브로드캐스트는 서버 담당) */
export const emitSessionLiveFeature = (
  socket: Socket,
  payload: SessionLiveFeatureEmit,
): boolean => {
  if (!socket.connected) return false;
  socket.emit('feature', payload);
  return true;
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

export { SOCKET_URL };
