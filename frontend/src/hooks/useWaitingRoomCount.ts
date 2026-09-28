// 개선 3: 상담사 대기실 인원 — waiting_room_changed(join/leave) 를 세어 표시한다.
//
// 서버에 대기 상태를 저장하지 않으므로, 참가자의 15초 heartbeat 를 기준으로
// 마지막 신호가 TTL(45초) 을 넘긴 항목은 정리한다(탭 강제 종료·네트워크 단절 대비).

import { useEffect, useRef, useState } from 'react';
import { tokenStorage } from '../lib/api/client';
import {
  getActiveSessionLiveSocket,
  getSessionLiveSocket,
  subscribeWaitingRoomChanged,
  type WaitingRoomChangedEvent,
} from '../lib/socket';

/** 마지막 heartbeat 이후 이 시간이 지나면 대기실에서 나간 것으로 본다. */
export const WAITING_ROOM_TTL_MS = 45_000;
const PRUNE_INTERVAL_MS = 15_000;

interface UseWaitingRoomCountOptions {
  sessionId: string | null | undefined;
  enabled: boolean;
  /** 게스트(비로그인) 연결 — 상담사는 보통 false */
  skipAuth?: boolean;
}

export interface WaitingRoomCountResult {
  /** 현재 대기실에 있는 참가자 수 */
  count: number;
  /** 표시용 닉네임 목록(없으면 participant_id) */
  nicknames: string[];
}

export function useWaitingRoomCount({
  sessionId,
  enabled,
  skipAuth = false,
}: UseWaitingRoomCountOptions): WaitingRoomCountResult {
  const [count, setCount] = useState(0);
  const [nicknames, setNicknames] = useState<string[]>([]);
  /** participant_id → 마지막 신호 시각·닉네임 */
  const seenRef = useRef<Map<string, { at: number; nickname: string | null }>>(new Map());
  /** 대기실(호스트 대기 씬)에서만 구독한다 */
  const active = Boolean(enabled && sessionId);

  useEffect(() => {
    if (!active || !sessionId) return undefined;

    const socket =
      getActiveSessionLiveSocket() ?? getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess());
    /** 이 effect 인스턴스가 다루는 대기 명부(맵 인스턴스는 고정) */
    const seen = seenRef.current;

    const publish = (): void => {
      const now = Date.now();
      for (const [id, entry] of seen) {
        if (now - entry.at > WAITING_ROOM_TTL_MS) seen.delete(id);
      }
      const names = [...seen.entries()].map(([id, entry]) => entry.nickname ?? id);
      setCount(seen.size);
      setNicknames(names);
    };

    const onChanged = (event: WaitingRoomChangedEvent): void => {
      if (!event || event.session_id !== sessionId || !event.participant_id) return;
      if (event.action === 'leave') {
        seen.delete(event.participant_id);
      } else {
        seen.set(event.participant_id, {
          at: Date.now(),
          nickname: event.nickname ?? null,
        });
      }
      publish();
    };

    const unsubscribe = subscribeWaitingRoomChanged(socket, onChanged);
    const prune = window.setInterval(publish, PRUNE_INTERVAL_MS);

    return () => {
      window.clearInterval(prune);
      unsubscribe();
      seen.clear();
    };
  }, [active, sessionId, skipAuth]);

  // 비활성(대기실 아님)에서는 항상 0 — effect 본문 setState 없이 파생값으로 처리한다.
  return active ? { count, nicknames } : { count: 0, nicknames: [] };
}
