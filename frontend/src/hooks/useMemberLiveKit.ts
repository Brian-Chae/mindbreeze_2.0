// 회원/게스트 LiveKit 연결 훅 — 온라인 양방향이면 카메라/마이크 송출(can_publish=true),
// 오프라인이면 수신 전용(can_publish=false)
// SDD-094: 온라인 그룹(≤20)은 기본 뮤트이고, speaking_changed(발언권) 수신 시 토큰을 재발급해
// can_publish를 갱신한다 — 재발급된 토큰으로 재연결하면 카메라·마이크가 켜진다.
// 손들기 상태도 이 훅이 소유한다(손들기 완료 ↔ 발언권 부여를 같은 출처로 유지).
import { resolveLiveKitUrl } from '../lib/livekit-url';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, tokenStorage } from '../lib/api/client';
import { getEntryLiveKitToken, lowerEntryHand, raiseEntryHand } from '../lib/api/class-flow';
import {
  getActiveSessionLiveSocket,
  getSessionLiveSocket,
  joinSessionLive,
  subscribeSpeakingChanged,
  type SpeakingChangedEvent,
} from '../lib/socket';

/** LiveKit 서버 URL — 환경변수 또는 기본값 사용 */
const LIVEKIT_URL = resolveLiveKitUrl();

interface UseMemberLiveKitOptions {
  participantId: string | null;
  /** SDD-209: 입장 자격 — 이 자격으로 토큰 발급·손들기·room join 을 한다(6자리 코드·참여자 토큰 경로 없음) */
  entryCredential: string | null;
  /** SDD-094: 발언권 이벤트 수신용 세션 id — 없으면(미지정) 자기 룸 join 이 불가해 리스너를 만들지 않는다 */
  sessionId?: string | null;
  /** SDD-094: 온라인 그룹(≤20)에서만 true — speaking_changed 수신 시 토큰 재발급 (기본 true) */
  listenSpeakingChanges?: boolean;
}

export function useMemberLiveKit({
  participantId,
  entryCredential,
  sessionId = null,
  listenSpeakingChanges = true,
}: UseMemberLiveKitOptions) {
  const [token, setToken] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  /** 온라인 양방향이면 카메라/마이크 송출 허용 — 미확인/오프라인은 false(수신 전용) */
  const [canPublish, setCanPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** 상담사 화상이 아직 시작되지 않아 토큰이 없는 상태 (폴링 재시도 대상) */
  const [notReady, setNotReady] = useState(true);
  /** SDD-131(②-17): 재시도 횟수 — 지수 백오프 상한 판단 */
  const [attemptCount, setAttemptCount] = useState(0);
  /** SDD-094: 손들기 요청 완료 — 상담사가 발언권을 부여하면 BE가 내린다 */
  const [raisedHand, setRaisedHand] = useState(false);
  /** SDD-094: 발언권(송출) 부여 상태 — speaking_changed 로 갱신 */
  const [speaking, setSpeaking] = useState(false);
  const [raising, setRaising] = useState(false);
  /** 손들기·손 내리기 중복 호출 방지(state 는 렌더 뒤에야 반영되므로 ref 로 즉시 막는다) */
  const raisingRef = useRef(false);
  const [raiseError, setRaiseError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (!entryCredential || !participantId || !sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getEntryLiveKitToken(sessionId, entryCredential);
      setToken(res.livekit_token);
      setRoomId(res.webrtc_room_id);
      setCanPublish(res.can_publish);
      setNotReady(false);
      setAttemptCount(0);
    } catch (e) {
      setToken(null);
      setRoomId(null);
      // 송출 권한 미확인 상태에서 로컬 캡처를 켜지 않는다
      setCanPublish(false);
      if (e instanceof ApiError && e.status === 400) {
        // 상담사 화상 미시작 — 재시도 유지
        setNotReady(true);
        setAttemptCount((c) => c + 1);
      } else {
        setNotReady(false);
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [participantId, entryCredential, sessionId]);

  const disconnect = useCallback(() => {
    setToken(null);
    setRoomId(null);
    setCanPublish(false);
    setNotReady(true);
  }, []);

  /** 리스너가 최신 connect(재발급 함수)를 참조하도록 — 재구독 방지 */
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  /**
   * SDD-094: 발언권(speaking) 변경 수신.
   * 회원 측 실시간 지표는 같은 `/session-live` 싱글톤으로 수신하므로,
   * 이미 열린 연결이 있으면 그대로 구독하고 없으면 같은 연결을 만들어 room 에 join 한다.
   */
  useEffect(() => {
    if (!listenSpeakingChanges || !participantId) return undefined;
    const existing = getActiveSessionLiveSocket();
    if (!existing && !sessionId) return undefined;
    const socket = existing ?? getSessionLiveSocket(tokenStorage.getAccess());

    const handleSpeaking = (event: SpeakingChangedEvent): void => {
      if (!event || event.participant_id !== participantId) return;
      if (sessionId && event.session_id && event.session_id !== sessionId) return;
      setSpeaking(event.speaking);
      // BE는 부여 시 손들기를 내린다 — 해제 시에도 손들기 표시를 남기지 않는다
      setRaisedHand(event.raise_hand ?? false);
      // 자기 speaking 변경 → 토큰 재발급(can_publish 갱신) → 재연결
      void connectRef.current();
    };

    // 새로 만든 연결은 아직 room 에 없으므로 join 이 필요하다(기존 연결은 소유 훅이 join 담당).
    const ownsJoin = !existing && Boolean(sessionId);
    const onConnect = (): void => {
      if (ownsJoin && sessionId) joinSessionLive(socket, sessionId, participantId, entryCredential);
    };

    const unsubSpeaking = subscribeSpeakingChanged(socket, handleSpeaking);
    socket.on('connect', onConnect);
    if (ownsJoin && socket.connected) onConnect();

    return () => {
      unsubSpeaking();
      socket.off('connect', onConnect);
    };
  }, [listenSpeakingChanges, participantId, sessionId, entryCredential]);

  /** SDD-094: 손들기 — 상담사가 발언권을 부여할 때까지 대기 상태로 둔다 */
  const raiseHand = useCallback(async (): Promise<void> => {
    if (!sessionId || !participantId || !entryCredential || raisingRef.current) return;
    raisingRef.current = true;
    setRaising(true);
    setRaiseError(null);
    try {
      await raiseEntryHand(sessionId, participantId, entryCredential);
      setRaisedHand(true);
    } catch (e) {
      setRaiseError(e instanceof Error ? e.message : '손들기에 실패했습니다');
    } finally {
      raisingRef.current = false;
      setRaising(false);
    }
  }, [sessionId, participantId, entryCredential]);

  /** 손 내리기(손들기 취소) — 실패하면 손든 상태를 그대로 두고 오류만 남긴다. 진행 중 연타는 무시 */
  const lowerHand = useCallback(async (): Promise<void> => {
    if (!sessionId || !participantId || !entryCredential || raisingRef.current) return;
    raisingRef.current = true;
    setRaising(true);
    setRaiseError(null);
    try {
      await lowerEntryHand(sessionId, participantId, entryCredential);
      setRaisedHand(false);
    } catch {
      setRaiseError('손을 내리지 못했어요. 잠시 후 다시 눌러 주세요');
    } finally {
      raisingRef.current = false;
      setRaising(false);
    }
  }, [sessionId, participantId, entryCredential]);

  return {
    token,
    roomId,
    canPublish,
    error,
    loading,
    notReady,
    attemptCount,
    connect,
    disconnect,
    serverUrl: LIVEKIT_URL,
    /** SDD-094 발언권 — speaking: 부여 상태, raisedHand: 손들기 상태 */
    speaking,
    raisedHand,
    raising,
    raiseHandError: raiseError,
    raiseHand,
    lowerHand,
  };
}
