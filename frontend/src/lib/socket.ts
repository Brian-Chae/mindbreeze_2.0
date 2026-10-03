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
import { CLASS_SIGNAL_EVENT, type ClassSignalCounts, type ClassSignalType } from './class/quiet-signal';
import {
  CLASS_AGGREGATE_EVENT,
  type ClassAggregateEvent,
} from './class/group-aggregate';
import {
  CLASS_AUDIO_SYNC_EVENT,
  parseAudioSyncEvent,
  type AudioSyncEmit,
  type AudioSyncEvent,
} from './class/audio-sync';

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

/** 개선 3: 대기실 입장/퇴장 알림 — 상담사가 대기 인원을 실시간으로 본다 */

/** 입장 전 체크인 요약 — 대기실 실시간 표시 전용(저장은 REST checkin). 세 값 모두 비면 미전송. */
export interface WaitingRoomCheckin {
  arousal: number | null;
  valence: number | null;
  note: string | null;
}

export interface WaitingRoomReadiness {
  surveyDone: boolean;
  bandDone: boolean;
  deviceDone: boolean;
}

export interface WaitingRoomChangedEvent {
  session_id: string;
  participant_id: string;
  action: 'join' | 'leave';
  /** 표시용 닉네임(서버가 정리해 전달 — 신원 판정에는 쓰지 않는다) */
  nickname?: string | null;
  /** 입장 전 체크인 요약(기분 SAM 2축 + 상담사 전달 메시지). 미제출이면 없음. */
  checkin?: WaitingRoomCheckin | null;
  readiness?: WaitingRoomReadiness | null;
}

export type WaitingRoomChangedHandler = (event: WaitingRoomChangedEvent) => void;

export interface WaitingRoomPresenceEmit {
  session_id: string;
  action: 'join' | 'leave';
  nickname?: string | null;
  /** 입장 전 체크인 요약 — 체크인 저장 후 재전송으로 상담사 화면에 갱신된다 */
  checkin?: WaitingRoomCheckin | null;
  readiness?: WaitingRoomReadiness | null;
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

/**
 * SDD-094: 발언권 변경 — 호스트 룸 + 해당 참가자 본인 룸에만 발행된다.
 * 회원은 이 이벤트를 받아 토큰을 재발급(can_publish 재계산)한다.
 */
export interface SpeakingChangedEvent {
  session_id?: string;
  participant_id: string;
  speaking: boolean;
  /** 부여 시 BE가 손들기를 내린다 — 응답에 포함되면 그대로 반영 */
  raise_hand?: boolean | null;
  version?: number;
}

/**
 * 개선 5: 무음 시그널 — 회원의 비언어 상태 신호를 상담사에게 전달한다.
 * 서버는 호스트 룸에만 브로드캐스트하므로 회원 소켓은 이 이벤트를 받지 않는다.
 * 발언권(손들기/부여)과 독립이며 DB 저장 없는 휘발성 신호다.
 */
export interface ClassSignalEvent {
  session_id?: string;
  participant_id: string;
  signal_type: ClassSignalType;
  /** 표시용 이름(서버가 정리해 전달 — 신원 판정에는 쓰지 않는다) */
  display_name?: string | null;
  /** 서버 수신 시각(ISO) */
  at?: string | null;
  /** 전송 직후 유형별 집계(서버 기준 TTL 창) */
  counts?: ClassSignalCounts | null;
}

/** 클라이언트 → 서버: `class:signal` emit payload */
export interface ClassSignalEmit {
  session_id: string;
  participant_id?: string | null;
  signal_type: ClassSignalType;
}

export type ClassSignalHandler = (event: ClassSignalEvent) => void;

/**
 * 개선 8: 그룹 익명 집계 상태 지표 — 상담사 화면 단일 게이지의 근거.
 * 개인 점수·순위·식별자는 담기지 않으며 상담사(호스트)에게만 발행된다.
 * 타입·표시 규칙은 `lib/class/group-aggregate` 가 단일 출처다.
 */
export type ClassAggregateEventHandler = (event: ClassAggregateEvent) => void;

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
export type SpeakingChangedHandler = (event: SpeakingChangedEvent) => void;
/** 개선 10: 재생 타임코드 수신 핸들러(회원 동기 재생용) */
export type ClassAudioSyncHandler = (event: AudioSyncEvent) => void;

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

/**
 * 이미 생성된 `/session-live` 소켓(없으면 null).
 * 새 연결을 만들지 않고 기존 연결을 재사용/구독할 때 쓴다 (SDD-094 발언권 리스너).
 */
export const getActiveSessionLiveSocket = (): Socket | null => sessionLiveSocket;

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

/** SDD-094: `speaking_changed` 구독 — 호스트/본인 룸에만 발행된다 */
export const subscribeSpeakingChanged = (
  socket: Socket,
  handler: SpeakingChangedHandler,
): (() => void) => {
  socket.on('speaking_changed', handler);
  return () => {
    socket.off('speaking_changed', handler);
  };
};

/**
 * 개선 5: 무음 시그널 emit — 회원/게스트가 상태 신호를 보낸다.
 * 발언권 없이도 보낼 수 있고(독립), 연결이 없으면 false 를 돌려 UI 가 조용히 안내한다.
 * participant_id 는 게스트 식별용이며 로그인 회원은 서버가 토큰(user_id)으로 해석한다.
 */
export const emitClassSignal = (socket: Socket, payload: ClassSignalEmit): boolean => {
  if (!socket.connected) return false;
  socket.emit(CLASS_SIGNAL_EVENT, payload);
  return true;
};

/** 개선 5: `class:signal` 구독 — 상담사(호스트 룸) 전용 이벤트 */
export const subscribeClassSignal = (
  socket: Socket,
  handler: ClassSignalHandler,
): (() => void) => {
  socket.on(CLASS_SIGNAL_EVENT, handler);
  return () => {
    socket.off(CLASS_SIGNAL_EVENT, handler);
  };
};

/**
 * 개선 8: `class:aggregate` 구독 — 상담사(호스트) 전용 그룹 익명 집계.
 * 서버가 호스트 룸/상담사 소켓으로만 발행하므로 회원 화면에는 전달되지 않는다.
 */
export const subscribeClassAggregate = (
  socket: Socket,
  handler: ClassAggregateEventHandler,
): (() => void) => {
  socket.on(CLASS_AGGREGATE_EVENT, handler);
  return () => {
    socket.off(CLASS_AGGREGATE_EVENT, handler);
  };
};

/**
 * 개선 10: `class:audio_sync` emit — 상담사의 재생 제어(play/pause/seek/stop).
 * 서버가 발신자를 세션 호스트로 검증하므로 회원/게스트가 보내도 무시된다.
 * 미연결이면 false 를 돌려 호출측이 조용히 안내하게 한다.
 */
export const emitClassAudioSync = (socket: Socket, payload: AudioSyncEmit): boolean => {
  if (!socket.connected) return false;
  socket.emit(CLASS_AUDIO_SYNC_EVENT, payload);
  return true;
};

/**
 * 개선 10: `class:audio_sync` 구독 — 세션 공용 룸(상담사+회원) 재생 타임코드.
 * 계약 밖 payload 는 parseAudioSyncEvent 가 걸러낸다(회원 화면이 깨지지 않게).
 */
export const subscribeClassAudioSync = (
  socket: Socket,
  handler: ClassAudioSyncHandler,
): (() => void) => {
  const listener = (raw: unknown): void => {
    const event = parseAudioSyncEvent(raw);
    if (event) handler(event);
  };
  socket.on(CLASS_AUDIO_SYNC_EVENT, listener);
  return () => {
    socket.off(CLASS_AUDIO_SYNC_EVENT, listener);
  };
};

/**
 * 개선 3: 대기실 입장/퇴장 emit.
 * 서버는 join 으로 저장된 세션 컨텍스트(role/participant_id)로만 신원을 판정하므로
 * 클라이언트가 participant_id 를 보내지 않는다(사칭 차단).
 */
export const emitWaitingRoomPresence = (
  socket: Socket,
  payload: WaitingRoomPresenceEmit,
): boolean => {
  if (!socket.connected) return false;
  socket.emit('waiting_room', payload);
  return true;
};

/** 개선 3: `waiting_room_changed` 구독 — 호스트 룸 전용 이벤트 */
export const subscribeWaitingRoomChanged = (
  socket: Socket,
  handler: WaitingRoomChangedHandler,
): (() => void) => {
  socket.on('waiting_room_changed', handler);
  return () => {
    socket.off('waiting_room_changed', handler);
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

export interface WaitingRoomReminderEvent {
  session_id: string;
  message: string;
}

export interface WaitingRoomReminderAck {
  ok: boolean;
  sent?: number;
  error?: string;
}

/** 서버 수락을 확인하며, 응답이 없으면 실패로 처리한다. */
export function requestWaitingRoomReminder(socket: Socket, sessionId: string, participantIds: string[]): Promise<WaitingRoomReminderAck> {
  if (!socket.connected) return Promise.reject(new Error('연결이 끊겼어요. 다시 연결한 뒤 시도해 주세요.'));
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit('waiting_room_remind', { session_id: sessionId, participant_ids: participantIds },
      (error: Error | null, result?: WaitingRoomReminderAck) => {
        if (error || !result?.ok) reject(new Error(result?.error ?? '안내를 보내지 못했어요. 다시 시도해 주세요.'));
        else resolve(result);
      });
  });
}
