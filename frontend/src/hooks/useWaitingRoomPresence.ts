// 개선 3: 대기실 참여 알림 — 참가자가 대기실에 머무는 동안 'join' 을, 나갈 때 'leave' 를 알린다.
//
// 서버는 `/session-live` join 으로 저장된 세션 컨텍스트(role/participant_id)로만 신원을
// 판정하므로 클라이언트는 participant_id 를 보내지 않는다(사칭 차단).
// 상담사가 늦게 접속해도 인원이 수렴하도록 15초 heartbeat 로 join 을 반복한다
// — 서버에 대기 상태를 저장하지 않고 클라이언트 TTL(useWaitingRoomCount)로 정리한다.
//
// 입장 전 체크인(기분 SAM 2축 + 상담사 전달 메시지): 저장은 REST(/sessions/{id}/checkin)가
// 하고, 여기서는 그 요약을 join 이벤트에 실어 상담사 화면에 실시간으로 흘린다.

import { useEffect, useRef } from 'react';
import { tokenStorage } from '../lib/api/client';
import {
  emitWaitingRoomPresence,
  getSessionLiveSocket,
  joinSessionLive,
  type WaitingRoomCheckin,
  type WaitingRoomReadiness,
} from '../lib/socket';

/** join heartbeat 주기 — 상담사 화면 인원 수렴 지연 상한 */
export const WAITING_ROOM_HEARTBEAT_MS = 15_000;

interface UseWaitingRoomPresenceOptions {
  sessionId: string | null | undefined;
  participantId: string | null | undefined;
  /** 표시용 닉네임(상담사 화면 참고용 — 서버는 신원 판정에 쓰지 않는다) */
  nickname?: string | null;
  /** 입장 전 체크인 요약 — 저장 후 함께 실어 보내 상담사가 실시간으로 본다 */
  checkin?: WaitingRoomCheckin | null;
  readiness?: WaitingRoomReadiness | null;
  enabled: boolean;
  /** 게스트(비로그인) 연결 */
  skipAuth?: boolean;
}

/**
 * 대기실 입장/퇴장을 알린다. room join 컨텍스트가 필요하므로 join 을 함께 보낸다
 * (useBand 가 이미 join 을 보낸 경우에도 멱등하다).
 */
export function useWaitingRoomPresence({
  sessionId,
  participantId,
  nickname = null,
  checkin = null,
  readiness = null,
  enabled,
  skipAuth = false,
}: UseWaitingRoomPresenceOptions): void {
  // 닉네임·체크인은 ref 로 들고 있어 effect 재실행(leave/join 플리커) 없이
  // heartbeat 가 최신 값을 실어 보낸다. 체크인은 변경 즉시 별도 재전송한다.
  const nicknameRef = useRef<string | null | undefined>(nickname);
  const checkinRef = useRef<WaitingRoomCheckin | null | undefined>(checkin);
  const readinessRef = useRef(readiness);
  useEffect(() => { readinessRef.current = readiness; }, [readiness]);
  useEffect(() => {
    nicknameRef.current = nickname;
  }, [nickname]);
  useEffect(() => {
    checkinRef.current = checkin;
  }, [checkin]);

  useEffect(() => {
    if (!enabled || !sessionId || !participantId) return undefined;

    const socket = getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess());
    let announced = false;

    const announce = (action: 'join' | 'leave'): void => {
      if (!socket.connected) return;
      if (action === 'join') joinSessionLive(socket, sessionId, participantId);
      emitWaitingRoomPresence(socket, {
        session_id: sessionId,
        action,
        nickname: nicknameRef.current,
        checkin: action === 'join' ? checkinRef.current : null,
        readiness: action === 'join' ? readinessRef.current : null,
      });
    };

    const onConnect = (): void => {
      announce('join');
      announced = true;
    };

    socket.on('connect', onConnect);
    if (socket.connected) onConnect();

    const heartbeat = window.setInterval(() => announce('join'), WAITING_ROOM_HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeat);
      socket.off('connect', onConnect);
      // 대기실을 벗어나면(입장·나가기) 인원에서 제거한다 — 실패해도 TTL 로 정리된다.
      if (announced) announce('leave');
    };
  }, [enabled, sessionId, participantId, skipAuth]);

  // 체크인이 저장되면 즉시 join 을 재전송해 상담사 화면을 갱신한다(15초 heartbeat 대기 없이).
  useEffect(() => {
    if (!enabled || !sessionId || !participantId || (!checkin && !readiness)) return undefined;
    const socket = getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess());
    if (!socket.connected) return undefined;
    joinSessionLive(socket, sessionId, participantId);
    emitWaitingRoomPresence(socket, {
      session_id: sessionId,
      action: 'join',
      nickname: nicknameRef.current,
      checkin,
      readiness,
    });
    return undefined;
  }, [checkin, readiness, enabled, sessionId, participantId, skipAuth]);
}
