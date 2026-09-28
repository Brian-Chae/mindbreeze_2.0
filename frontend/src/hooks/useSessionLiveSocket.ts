// `/session-live` 네임스페이스 구독 훅 — 호스트/게스트 실시간 EEG + SDD-026 상태 계약
// snapshot 적용 전에는 isReady=false → 호출측이 REST 폴백을 유지해야 한다.
// SDD-028: eeg_feature는 setState 없이 콜백만 — 대규모 참여자 전체 재렌더 회피

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { tokenStorage } from '../lib/api/client';
import { type ClassSignalType } from '../lib/class/quiet-signal';
import {
  emitClassSignal,
  getSessionLiveSocket,
  joinSessionLive,
  leaveSessionLive,
  normalizeJoinSnapshot,
  subscribeClassSignal,
  subscribeDeviceStatusChanged,
  subscribeParticipantChanged,
  subscribeSessionLiveEegFeature,
  subscribeSessionLiveJoined,
  subscribeSessionStateChanged,
  subscribeSpeakingChanged,
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
}

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
  /** 개선 5: 무음 시그널 전송 — 미연결이면 false(UI는 조용히 안내) */
  sendSignal: (signalType: ClassSignalType) => boolean;
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
  /** 개선 5: 무음 시그널 전송용 — effect 안에서 생성한 소켓을 참조한다 */
  const socketRef = useRef<Socket | null>(null);
  const joinedSessionRef = useRef<string | null>(null);
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
      setIsConnected(true);
      // 연결만으로 hasSnapshot을 true로 만들지 않음
      joinSessionLive(socket, sessionId, participantId);
      joinedSessionRef.current = sessionId;
    };

    const onDisconnect = (): void => {
      setIsConnected(false);
      // 단절 시 snapshot 무효 → 폴백 재개
      setHasSnapshot(false);
    };

    const onJoined = (event: SessionLiveJoinedEvent): void => {
      if (event.session_id && event.session_id !== sessionId) return;
      const normalized = normalizeJoinSnapshot(event);
      if (normalized) {
        applySnapshot(normalized);
      }
      // snapshot 없는 joined(구 BE) → hasSnapshot 유지 false, 폴백 계속
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

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const unsubJoined = subscribeSessionLiveJoined(socket, onJoined);
    const unsubFeature = subscribeSessionLiveEegFeature(socket, handleFeature);
    const unsubState = subscribeSessionStateChanged(socket, onState);
    const unsubParticipant = subscribeParticipantChanged(socket, onParticipant);
    const unsubDevice = subscribeDeviceStatusChanged(socket, onDevice);
    const unsubSpeaking = subscribeSpeakingChanged(socket, onSpeaking);
    const unsubSignal = subscribeClassSignal(socket, onSignal);

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
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
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
   * 미연결(또는 세션 미확정)이면 false 를 돌려 호출측이 조용히 안내하게 한다.
   */
  const sendSignal = useCallback(
    (signalType: ClassSignalType): boolean => {
      const socket = socketRef.current;
      if (!socket || !sessionId) return false;
      return emitClassSignal(socket, {
        session_id: sessionId,
        participant_id: participantId,
        signal_type: signalType,
      });
    },
    [sessionId, participantId],
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
  };
}
