// 개선 3: 상담사 대기실 인원 — waiting_room_changed(join/leave) 를 세어 표시한다.
//
// 서버에 대기 상태를 저장하지 않으므로, 참가자의 15초 heartbeat 를 기준으로
// 마지막 신호가 TTL(45초) 을 넘긴 항목은 정리한다(탭 강제 종료·네트워크 단절 대비).

import { useEffect, useRef, useState } from 'react';
import { tokenStorage } from '../lib/api/client';
import {
  getActiveSessionLiveSocket,
  getSessionLiveSocket,
  joinSessionLive,
  subscribeWaitingRoomChanged,
  type WaitingRoomChangedEvent,
  type WaitingRoomCheckin,
  type WaitingRoomReadiness,
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

export interface WaitingRoomEntry {
  participantId: string;
  nickname: string | null;
  checkin: WaitingRoomCheckin | null;
  readiness?: WaitingRoomReadiness | null;
}

export interface WaitingRoomCountResult {
  /** 현재 대기실에 있는 참가자 수 */
  count: number;
  /** 표시용 닉네임 목록(없으면 participant_id) */
  nicknames: string[];
  /** participant_id → 입장 전 체크인 요약(미제출 참가자는 키 없음) */
  checkins: Record<string, WaitingRoomCheckin>;
  /** 표시용 참가자 목록(닉네임·체크인 정렬) */
  entries: WaitingRoomEntry[];
}

export function useWaitingRoomCount({
  sessionId,
  enabled,
  skipAuth = false,
}: UseWaitingRoomCountOptions): WaitingRoomCountResult {
  const [count, setCount] = useState(0);
  const [nicknames, setNicknames] = useState<string[]>([]);
  const [checkins, setCheckins] = useState<Record<string, WaitingRoomCheckin>>({});
  const [entries, setEntries] = useState<WaitingRoomEntry[]>([]);
  /** participant_id → 마지막 신호 시각·닉네임·체크인 */
  const seenRef = useRef<Map<string, { at: number; nickname: string | null; checkin: WaitingRoomCheckin | null; readiness?: WaitingRoomReadiness | null }>>(
    new Map(),
  );
  /** 대기실(호스트 대기 씬)에서만 구독한다 */
  const active = Boolean(enabled && sessionId);
  /** 이 훅이 마지막으로 초기화한 세션 — skipAuth 변경 재구독 시 명부를 유지하기 위한 키 */
  const seenSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !sessionId) return undefined;

    // HOOK-STATE-06: 실제 세션이 바뀔 때만 대기 명부를 초기화한다.
    // (skipAuth 토글로 effect 가 재실행돼도 이전 세션의 명부를 보존한다.)
    if (seenSessionRef.current !== sessionId) {
      seenSessionRef.current = sessionId;
      seenRef.current.clear();
    }

    const socket =
      getActiveSessionLiveSocket() ?? getSessionLiveSocket(skipAuth ? null : tokenStorage.getAccess());
    /** 이 effect 인스턴스가 다루는 대기 명부(맵 인스턴스는 고정) */
    const seen = seenRef.current;

    // WS-10: 호스트 대기실 구독 훅이 소켓 join 상태를 보장한다 — 다른 컴포넌트의
    // join 타이밍에 의존하지 않도록 waiting_room_changed 수신 전에 room join 을 요청한다.
    // (joinSessionLive 는 세션 dedup 을 하므로 이미 join 된 소켓에는 중복 emit 하지 않는다.)
    joinSessionLive(socket, sessionId);

    const publish = (): void => {
      const now = Date.now();
      for (const [id, entry] of seen) {
        if (now - entry.at > WAITING_ROOM_TTL_MS) seen.delete(id);
      }
      const names = [...seen.entries()].map(([id, entry]) => entry.nickname ?? id);
      const nextCheckins: Record<string, WaitingRoomCheckin> = {};
      const nextEntries: WaitingRoomEntry[] = [];
      for (const [id, entry] of seen) {
        if (entry.checkin) nextCheckins[id] = entry.checkin;
        nextEntries.push({
          participantId: id,
          nickname: entry.nickname,
          checkin: entry.checkin,
          readiness: entry.readiness,
        });
      }
      setCount(seen.size);
      setNicknames(names);
      setCheckins(nextCheckins);
      setEntries(nextEntries);
    };

    const onChanged = (event: WaitingRoomChangedEvent): void => {
      if (!event || event.session_id !== sessionId || !event.participant_id) return;
      if (event.action === 'leave') {
        seen.delete(event.participant_id);
      } else {
        seen.set(event.participant_id, {
          at: Date.now(),
          nickname: event.nickname ?? null,
          checkin: event.checkin ?? null,
          readiness: event.readiness ?? null,
        });
      }
      publish();
    };

    const unsubscribe = subscribeWaitingRoomChanged(socket, onChanged);
    const prune = window.setInterval(publish, PRUNE_INTERVAL_MS);
    // 재구독(세션 유지) 시 현재 명부를 즉시 반영한다.
    publish();

    return () => {
      window.clearInterval(prune);
      unsubscribe();
      // HOOK-STATE-06: cleanup 에서 공유 seenRef 를 clear 하지 않는다.
      // skipAuth 변경으로 인한 재구독 시 명부가 통째로 비워지던 문제를 막고,
      // 세션 변경 시에만 effect 본문에서 초기화한다.
    };
  }, [active, sessionId, skipAuth]);

  // 비활성(대기실 아님)에서는 항상 0 — effect 본문 setState 없이 파생값으로 처리한다.
  return active
    ? { count, nicknames, checkins, entries }
    : { count: 0, nicknames: [], checkins: {}, entries: [] };
}
