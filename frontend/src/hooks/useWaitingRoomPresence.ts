// 개선 3: 대기실 참여 알림 — 참가자가 대기실에 머무는 동안 'join' 을, 나갈 때 'leave' 를 알린다.
//
// 서버는 `/session-live` join 으로 저장된 세션 컨텍스트(role/participant_id)로만 신원을
// 판정하므로 클라이언트는 participant_id 를 보내지 않는다(사칭 차단).
// 상담사가 늦게 접속해도 인원이 수렴하도록 15초 heartbeat 로 join 을 반복한다
// — 서버에 대기 상태를 저장하지 않고 클라이언트 TTL(useWaitingRoomCount)로 정리한다.

import { useEffect } from 'react';
import { tokenStorage } from '../lib/api/client';
import {
  emitWaitingRoomPresence,
  getSessionLiveSocket,
  joinSessionLive,
} from '../lib/socket';

/** join heartbeat 주기 — 상담사 화면 인원 수렴 지연 상한 */
export const WAITING_ROOM_HEARTBEAT_MS = 15_000;

interface UseWaitingRoomPresenceOptions {
  sessionId: string | null | undefined;
  participantId: string | null | undefined;
  /** 표시용 닉네임(상담사 화면 참고용 — 서버는 신원 판정에 쓰지 않는다) */
  nickname?: string | null;
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
  enabled,
  skipAuth = false,
}: UseWaitingRoomPresenceOptions): void {
  useEffect(() => {
    if (!enabled || !sessionId || !participantId) return undefined;

    const socket = getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess());
    let announced = false;

    const announce = (action: 'join' | 'leave'): void => {
      if (!socket.connected) return;
      if (action === 'join') joinSessionLive(socket, sessionId, participantId);
      emitWaitingRoomPresence(socket, { session_id: sessionId, action, nickname });
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
  }, [enabled, sessionId, participantId, nickname, skipAuth]);
}
