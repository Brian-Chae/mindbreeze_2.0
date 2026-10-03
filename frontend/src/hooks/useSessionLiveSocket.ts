// `/session-live` 네임스페이스 구독 훅 — 호스트/게스트 실시간 EEG + SDD-026 상태 계약
// snapshot 적용 전에는 isReady=false → 호출측이 REST 폴백을 유지해야 한다.
// SDD-028: eeg_feature는 setState 없이 콜백만 — 대규모 참여자 전체 재렌더 회피
// 개선 8: class:aggregate(상담사 전용 그룹 익명 집계)도 콜백으로만 전달한다.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { tokenStorage } from '../lib/api/client';
import { type ClassSignalType } from '../lib/class/quiet-signal';
import {
  normalizeAggregate,
  type ClassAggregateEvent,
} from '../lib/class/group-aggregate';
import {
  emitClassAudioSync,
  emitClassSignal,
  getSessionLiveSocket,
  joinSessionLive,
  leaveSessionLive,
  normalizeJoinSnapshot,
  subscribeClassAggregate,
  subscribeClassAudioSync,
  subscribeClassSignal,
  subscribeDeviceStatusChanged,
  subscribeParticipantChanged,
  subscribeSessionLiveEegFeature,
  subscribeSessionLiveJoined,
  subscribeSessionStateChanged,
  subscribeSpeakingChanged,
  type ClassAggregateEventHandler,
  type ClassAudioSyncHandler,
  type ClassSignalEvent,
  type ClassSignalHandler,
  type DeviceStatusChangedEvent,
  type DeviceStatusChangedHandler,
  type ParticipantChangedEvent,
  type ParticipantChangedHandler,
  type SessionLiveEegFeatureEvent,
  type SessionLiveEegFeatureHandler,
  type SessionLiveJoinSnapshot,
  type SessionLiveJoinedEvent,
  type SessionStateChangedEvent,
  type SessionStateChangedHandler,
  type SpeakingChangedEvent,
  type SpeakingChangedHandler,
} from '../lib/socket';
import type { AudioSyncEmit, AudioSyncEvent } from '../lib/class/audio-sync';

interface UseSessionLiveSocketOptions {
  sessionId: string | null | undefined;
  participantId?: string | null;
  /** false면 연결하지 않음 */
  enabled?: boolean;
  /** 게스트 등 비인증 연결 */
  skipAuth?: boolean;
  onEegFeature?: SessionLiveEegFeatureHandler;
  onSnapshot?: (snapshot: SessionLiveJoinSnapshot) => void;
  onSessionStateChanged?: SessionStateChangedHandler;
  onParticipantChanged?: ParticipantChangedHandler;
  onDeviceStatusChanged?: DeviceStatusChangedHandler;
  /** SDD-094: 발언권 변경 — 호스트 화면 참여자 목록 갱신용 */
  onSpeakingChanged?: SpeakingChangedHandler;
  /** 개선 5: 무음 시그널 수신 — 상담사 화면 카드 배지·집계 카운트 갱신용 */
  onClassSignal?: ClassSignalHandler;
  /** 개선 8: 그룹 익명 집계 수신 — 상담사 상단 단일 게이지 갱신용 */
  onClassAggregate?: ClassAggregateEventHandler;
  /** 개선 10: 재생 타임코드 수신 — 회원 화면 동기 재생용 */
  onClassAudioSync?: ClassAudioSyncHandler;
}

/** 무음 시그널 전송 결과 — 즉시 전송 / 단절로 버퍼링(재연결 후 flush) / 실패(전송 불가) */
export type SignalSendResult = 'sent' | 'queued' | 'failed';

interface UseSessionLiveSocketResult {
  /** 소켓 transport 연결 여부 — 폴백 중단 조건으로 쓰지 말 것 */
  isConnected: boolean;
  /** join snapshot 적용 완료 — 이 때만 REST 폴백 중단 */
  hasSnapshot: boolean;
  /** hasSnapshot과 동의어 — UI 폴링 게이트 */
  isReady: boolean;
  snapshot: SessionLiveJoinSnapshot | null;
  version: number;
  /** 최신 수신 feature (참가자별 맵은 호출측에서 관리) */
  lastEvent: SessionLiveEegFeatureEvent | null;
  /** 개선 5: 무음 시그널 전송 — 즉시 전송되거나 단절 중이면 버퍼링(재연결 후 flush)된다 */
  sendSignal: (signalType: ClassSignalType) => SignalSendResult;
  /** 개선 10: 재생 제어 전송(상담사) — 미연결이면 false(UI는 조용히 안내) */
  sendAudioSync: (payload: Omit<AudioSyncEmit, 'session_id'>) => boolean;
}

/**
 * 세션 room join + eeg_feature/상태 이벤트 구독.
 * 연결만으로는 폴백을 끄지 않는다 — hasSnapshot/isReady를 본다.
 */
export function useSessionLiveSocket({
  sessionId,
  participantId = null,
  enabled = true,
  skipAuth = false,
  onEegFeature,
  onSnapshot,
  onSessionStateChanged,
  onParticipantChanged,
  onDeviceStatusChanged,
  onSpeakingChanged,
  onClassSignal,
  onClassAggregate,
  onClassAudioSync,
}: UseSessionLiveSocketOptions): UseSessionLiveSocketResult {
  const [isConnected, setIsConnected] = useState(false);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [snapshot, setSnapshot] = useState<SessionLiveJoinSnapshot | null>(null);
  const [version, setVersion] = useState(0);

  const onFeatureRef = useRef(onEegFeature);
  onFeatureRef.current = onEegFeature;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const onStateRef = useRef(onSessionStateChanged);
  onStateRef.current = onSessionStateChanged;
  const onParticipantRef = useRef(onParticipantChanged);
  onParticipantRef.current = onParticipantChanged;
  const onDeviceRef = useRef(onDeviceStatusChanged);
  onDeviceRef.current = onDeviceStatusChanged;
  const onSpeakingRef = useRef(onSpeakingChanged);
  onSpeakingRef.current = onSpeakingChanged;
  const onClassSignalRef = useRef(onClassSignal);
  onClassSignalRef.current = onClassSignal;
  const onClassAggregateRef = useRef(onClassAggregate);
  onClassAggregateRef.current = onClassAggregate;
  const onClassAudioSyncRef = useRef(onClassAudioSync);
  onClassAudioSyncRef.current = onClassAudioSync;
  /** 개선 5: 무음 시그널 전송용 — effect 안에서 생성한 소켓을 참조한다 */
  const socketRef = useRef<Socket | null>(null);
  const joinedSessionRef = useRef<string | null>(null);
  const signalParticipantRef = useRef<string | null>(null);
  /** 단절 중 눌린 신호를 보관 — 재join 확정 후 확정된 본인 id로 flush한다 */
  const pendingSignalsRef = useRef<ClassSignalType[]>([]);
  /** join 거부 상태 — 이 상태에서는 신호를 전송하지 않는다 */
  const joinDeniedRef = useRef(false);
  const versionRef = useRef(0);
  /** SDD-028: feature는 콜백으로만 전달 — setState 하면 대규모 테이블 전체 재렌더 */
  const lastEventRef = useRef<SessionLiveEegFeatureEvent | null>(null);

  /** version이 이전이면 무시 (중복·역순 방어) */
  const acceptVersion = useCallback((next: number): boolean => {
    if (next < versionRef.current) return false;
    versionRef.current = next;
    setVersion(next);
    return true;
  }, []);

  const applySnapshot = useCallback(
    (next: SessionLiveJoinSnapshot): void => {
      if (!acceptVersion(next.version)) return;
      setSnapshot(next);
      setHasSnapshot(true);
      onSnapshotRef.current?.(next);
    },
    [acceptVersion],
  );

  const handleFeature = useCallback((event: SessionLiveEegFeatureEvent) => {
    // 최신 feature만 콜백으로 증분 반영 — 훅 state를 건드리지 않음
    lastEventRef.current = event;
    onFeatureRef.current?.(event);
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setIsConnected(false);
      setHasSnapshot(false);
      setSnapshot(null);
      versionRef.current = 0;
      setVersion(0);
      return undefined;
    }

    // 재join 시 snapshot 재수신 전까지 폴백 유지
    setHasSnapshot(false);
    setSnapshot(null);

    const token = skipAuth ? null : tokenStorage.getAccess();
    const socket = getSessionLiveSocket(token);
    socketRef.current = socket;

    const onConnect = (): void => {
      signalParticipantRef.current = null;
      joinDeniedRef.current = false;
      setIsConnected(true);
      // 연결만으로 hasSnapshot을 true로 만들지 않음
      joinSessionLive(socket, sessionId, participantId);
      joinedSessionRef.current = sessionId;
    };

    const onDisconnect = (reason: string): void => {
      signalParticipantRef.current = null;
      // 단절 원인은 진단용으로 기록한다(transport close / ping timeout 등).
      console.warn('[session-live] disconnect:', reason);
      setIsConnected(false);
      // 단절 시 snapshot 무효 → 폴백 재개
      setHasSnapshot(false);
    };

    // 단절 중 눌린 신호를 재join 확정된 본인 id로 일괄 전송한다.
    const flushPendingSignals = (pid: string): void => {
      const sock = socketRef.current;
      const queue = pendingSignalsRef.current;
      // 연결이 없으면 flush 하지 않고 버퍼를 유지한다(다음 재join에서 재시도).
      if (!sock || !sock.connected || !sessionId || !pid || queue.length === 0) return;
      pendingSignalsRef.current = [];
      for (const type of queue) {
        emitClassSignal(sock, { session_id: sessionId, participant_id: pid, signal_type: type });
      }
    };

    const onJoined = (event: SessionLiveJoinedEvent): void => {
      if (event.session_id && event.session_id !== sessionId) return;
      // 서버가 확정한 본인 id를 사용한다. 구 서버의 joined는 요청 id로 호환한다.
      const pid = event.participant_id === undefined ? participantId : event.participant_id;
      signalParticipantRef.current = pid;
      joinDeniedRef.current = false;
      const normalized = normalizeJoinSnapshot(event);
      if (normalized) {
        applySnapshot(normalized);
      }
      // snapshot 없는 joined(구 BE) → hasSnapshot 유지 false, 폴백 계속
      // 단절 중 눌린 신호 flush — 확정된 pid가 있을 때만
      if (pid) flushPendingSignals(pid);
    };

    const onJoinDenied = (event: { session_id?: string }): void => {
      if (event.session_id && event.session_id !== sessionId) return;
      signalParticipantRef.current = null;
      joinDeniedRef.current = true;
      pendingSignalsRef.current = [];
      setHasSnapshot(false);
      setSnapshot(null);
    };

    const onState = (event: SessionStateChangedEvent): void => {
      if (event.session_id !== sessionId) return;
      if (!acceptVersion(event.version)) return;
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              status: event.status,
              version: event.version,
              started_at: event.started_at ?? prev.started_at,
              ended_at: event.ended_at ?? prev.ended_at,
            }
          : prev,
      );
      onStateRef.current?.(event);
    };

    const onParticipant = (event: ParticipantChangedEvent): void => {
      if (event.session_id !== sessionId) return;
      if (!acceptVersion(event.version)) return;
      setSnapshot((prev) =>
        prev
          ? { ...prev, version: event.version, participants: event.participants }
          : prev,
      );
      onParticipantRef.current?.(event);
    };

    const onDevice = (event: DeviceStatusChangedEvent): void => {
      if (event.session_id !== sessionId) return;
      if (!acceptVersion(event.version)) return;
      onDeviceRef.current?.(event);
    };

    // SDD-094: 발언권 변경 — session_id가 생략될 수 있어 있을 때만 검증한다
    const onSpeaking = (event: SpeakingChangedEvent): void => {
      if (event.session_id && event.session_id !== sessionId) return;
      if (typeof event.version === 'number' && !acceptVersion(event.version)) return;
      onSpeakingRef.current?.(event);
    };

    // 개선 5: 무음 시그널(호스트 룸 전용) — session_id가 생략될 수 있어 있을 때만 검증한다
    const onSignal = (event: ClassSignalEvent): void => {
      if (event.session_id && event.session_id !== sessionId) return;
      onClassSignalRef.current?.(event);
    };

    // 개선 8: 그룹 익명 집계(상담사 전용) — 계약 밖 payload는 normalizeAggregate가 걸러낸다
    const onAggregate = (event: ClassAggregateEvent): void => {
      const normalized = normalizeAggregate(event);
      if (!normalized) return;
      if (normalized.session_id && normalized.session_id !== sessionId) return;
      onClassAggregateRef.current?.(normalized);
    };

    // 개선 10: 재생 타임코드(세션 공용 룸) — 계약 밖 payload는 subscribeClassAudioSync가 걸러낸다.
    // session_id는 있을 때만 검증한다(스냅샷 replay 등 생략 가능 경로 대비).
    const onAudioSync = (event: AudioSyncEvent): void => {
      if (event.session_id && event.session_id !== sessionId) return;
      onClassAudioSyncRef.current?.(event);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('join_denied', onJoinDenied);

    const unsubJoined = subscribeSessionLiveJoined(socket, onJoined);
    const unsubFeature = subscribeSessionLiveEegFeature(socket, handleFeature);
    const unsubState = subscribeSessionStateChanged(socket, onState);
    const unsubParticipant = subscribeParticipantChanged(socket, onParticipant);
    const unsubDevice = subscribeDeviceStatusChanged(socket, onDevice);
    const unsubSpeaking = subscribeSpeakingChanged(socket, onSpeaking);
    const unsubSignal = subscribeClassSignal(socket, onSignal);
    const unsubAggregate = subscribeClassAggregate(socket, onAggregate);
    const unsubAudioSync = subscribeClassAudioSync(socket, onAudioSync);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      const joined = joinedSessionRef.current;
      if (joined) {
        leaveSessionLive(socket, joined);
        joinedSessionRef.current = null;
      }
      unsubJoined();
      unsubFeature();
      unsubState();
      unsubParticipant();
      unsubDevice();
      unsubSpeaking();
      unsubSignal();
      unsubAggregate();
      unsubAudioSync();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('join_denied', onJoinDenied);
      signalParticipantRef.current = null;
      pendingSignalsRef.current = [];
      joinDeniedRef.current = false;
      socketRef.current = null;
      setIsConnected(false);
      setHasSnapshot(false);
    };
  }, [
    enabled,
    sessionId,
    participantId,
    skipAuth,
    handleFeature,
    applySnapshot,
    acceptVersion,
  ]);

  /**
   * 개선 5: 무음 시그널 전송 — 발언권과 무관하게 언제든 보낼 수 있다.
   * 연결 + 확정된 본인 id가 있으면 즉시 전송('sent').
   * 단절(또는 아직 미확정)이면 버퍼에 담고 'queued' — 재join 확정 시 flush 된다.
   * 소켓/세션이 없거나 join 거부 상태면 'failed'.
   */
  const sendSignal = useCallback(
    (signalType: ClassSignalType): SignalSendResult => {
      const socket = socketRef.current;
      if (!socket || !sessionId) return 'failed';
      if (joinDeniedRef.current) return 'failed';
      const signalParticipantId = signalParticipantRef.current;
      if (socket.connected && signalParticipantId) {
        emitClassSignal(socket, {
          session_id: sessionId,
          participant_id: signalParticipantId,
          signal_type: signalType,
        });
        return 'sent';
      }
      pendingSignalsRef.current.push(signalType);
      return 'queued';
    },
    [sessionId],
  );

  /**
   * 개선 10: 재생 제어 전송 — 상담사 플레이어가 재생/일시정지/정지/이동 시 호출한다.
   * session_id 는 훅이 알고 있으므로 호출측은 나머지 필드만 넘긴다.
   * 미연결(또는 세션 미확정)이면 false 를 돌려 호출측이 조용히 안내하게 한다.
   */
  const sendAudioSync = useCallback(
    (payload: Omit<AudioSyncEmit, 'session_id'>): boolean => {
      const socket = socketRef.current;
      if (!socket || !sessionId) return false;
      return emitClassAudioSync(socket, { ...payload, session_id: sessionId });
    },
    [sessionId],
  );

  return {
    isConnected,
    hasSnapshot,
    isReady: hasSnapshot,
    snapshot,
    version,
    /** 렌더 구독 없음 — onEegFeature로 증분 반영. 디버그/폴백용 최신값 */
    lastEvent: lastEventRef.current,
    sendSignal,
    sendAudioSync,
  };
}
