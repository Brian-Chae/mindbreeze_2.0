// 회원/게스트 LiveKit 연결 훅 — 온라인 양방향이면 카메라/마이크 송출(can_publish=true),
// 오프라인이면 수신 전용(can_publish=false)
import { useCallback, useState } from 'react';
import { ApiError } from '../lib/api/client';
import { getMemberLiveKitToken } from '../lib/api/session';

/** LiveKit 서버 URL — 환경변수 또는 기본값 사용 */
const LIVEKIT_URL =
  (import.meta.env.VITE_LIVEKIT_URL as string | undefined) ??
  'wss://dev-api.mindbreeze.looxidlabs.com/livekit';

interface UseMemberLiveKitOptions {
  code: string | null;
  participantId: string | null;
  participantToken?: string | null;
}

export function useMemberLiveKit({ code, participantId, participantToken }: UseMemberLiveKitOptions) {
  const [token, setToken] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  /** 온라인 양방향이면 카메라/마이크 송출 허용 — 미확인/오프라인은 false(수신 전용) */
  const [canPublish, setCanPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** 상담사 화상이 아직 시작되지 않아 토큰이 없는 상태 (폴링 재시도 대상) */
  const [notReady, setNotReady] = useState(true);

  const connect = useCallback(async () => {
    if (!code || !participantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getMemberLiveKitToken(code, participantId, participantToken);
      setToken(res.livekit_token);
      setRoomId(res.webrtc_room_id);
      setCanPublish(res.can_publish);
      setNotReady(false);
    } catch (e) {
      setToken(null);
      setRoomId(null);
      // 송출 권한 미확인 상태에서 로컬 캡처를 켜지 않는다
      setCanPublish(false);
      if (e instanceof ApiError && e.status === 400) {
        // 상담사 화상 미시작 — 재시도 유지
        setNotReady(true);
      } else {
        setNotReady(false);
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [code, participantId, participantToken]);

  const disconnect = useCallback(() => {
    setToken(null);
    setRoomId(null);
    setCanPublish(false);
    setNotReady(true);
  }, []);

  return {
    token,
    roomId,
    canPublish,
    error,
    loading,
    notReady,
    connect,
    disconnect,
    serverUrl: LIVEKIT_URL,
  };
}
