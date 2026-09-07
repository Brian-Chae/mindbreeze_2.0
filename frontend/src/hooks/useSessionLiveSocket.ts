// `/session-live` 네임스페이스 구독 훅 — 호스트/게스트 실시간 EEG feature 수신

import { useCallback, useEffect, useRef, useState } from 'react';
import { tokenStorage } from '../lib/api/client';
import {
  getSessionLiveSocket,
  joinSessionLive,
  leaveSessionLive,
  subscribeSessionLiveEegFeature,
  type SessionLiveEegFeatureEvent,
  type SessionLiveEegFeatureHandler,
} from '../lib/socket';

interface UseSessionLiveSocketOptions {
  sessionId: string | null | undefined;
  /** false면 연결하지 않음 */
  enabled?: boolean;
  /** 게스트 등 비인증 연결 */
  skipAuth?: boolean;
  onEegFeature?: SessionLiveEegFeatureHandler;
}

interface UseSessionLiveSocketResult {
  isConnected: boolean;
  /** 최신 수신 feature (참가자별 맵은 호출측에서 관리) */
  lastEvent: SessionLiveEegFeatureEvent | null;
}

/**
 * 세션 room join + eeg_feature 구독.
 * WS 연결 여부는 호출측 폴링 폴백 전환에 사용한다.
 */
export function useSessionLiveSocket({
  sessionId,
  enabled = true,
  skipAuth = false,
  onEegFeature,
}: UseSessionLiveSocketOptions): UseSessionLiveSocketResult {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SessionLiveEegFeatureEvent | null>(null);
  const onFeatureRef = useRef(onEegFeature);
  onFeatureRef.current = onEegFeature;
  const joinedSessionRef = useRef<string | null>(null);

  const handleFeature = useCallback((event: SessionLiveEegFeatureEvent) => {
    setLastEvent(event);
    onFeatureRef.current?.(event);
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setIsConnected(false);
      return undefined;
    }

    const token = skipAuth ? null : tokenStorage.getAccess();
    const socket = getSessionLiveSocket(token);

    const onConnect = (): void => {
      setIsConnected(true);
      joinSessionLive(socket, sessionId);
      joinedSessionRef.current = sessionId;
    };

    const onDisconnect = (): void => {
      setIsConnected(false);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const unsubscribe = subscribeSessionLiveEegFeature(socket, handleFeature);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      const joined = joinedSessionRef.current;
      if (joined) {
        leaveSessionLive(socket, joined);
        joinedSessionRef.current = null;
      }
      unsubscribe();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      setIsConnected(false);
    };
  }, [enabled, sessionId, skipAuth, handleFeature]);

  return { isConnected, lastEvent };
}
