// LiveKit 토큰 발급 + 방 연결 훅
// 세션 참여(join) 후 LiveKit 토큰을 받아 VideoConference에 전달

import { useState, useCallback } from 'react';
import { joinSession, getLiveKitToken, type SessionDto } from '../lib/api/session';

/** LiveKit 서버 URL — 환경변수 또는 기본값 사용 */
const LIVEKIT_URL =
  (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ??
  'wss://dev-api.mindbreeze.looxidlabs.com/livekit';

export function useLiveKit(sessionId: string | undefined) {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** 세션 참여 → LiveKit 토큰 발급 → 연결 준비 */
  const connect = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const s = await joinSession(sessionId);
      setSession(s);
      const t = await getLiveKitToken(sessionId);
      setToken(t.livekit_token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  /** 연결 해제 (토큰 폐기) */
  const disconnect = useCallback(() => {
    setToken(null);
  }, []);

  return {
    token,
    session,
    error,
    loading,
    connect,
    disconnect,
    serverUrl: LIVEKIT_URL,
  };
}
