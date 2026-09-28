// 개선 5: 무음 시그널 — 순수 로직(TTL 정리·집계) + Socket.IO `class:signal` 계약
import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import {
  CLASS_SIGNAL_EVENT,
  CLASS_SIGNAL_META,
  CLASS_SIGNAL_TYPES,
  SIGNAL_ACTIVE_MS,
  SIGNAL_FLASH_MS,
  countSignals,
  isClassSignalType,
  pruneSignals,
  recordSignal,
  signalCountParts,
  type SignalMap,
} from '../src/lib/class/quiet-signal';
import { emitClassSignal, subscribeClassSignal } from '../src/lib/socket';

/** 소켓은 계약(이벤트명·payload)만 검증하면 되므로 최소 fake 로 대체한다 */
function fakeSocket(connected: boolean) {
  const emit = vi.fn();
  const on = vi.fn();
  const off = vi.fn();
  return {
    socket: { connected, emit, on, off } as unknown as Socket,
    emit,
    on,
    off,
  };
}

const NOW = 1_700_000_000_000;

describe('무음 시그널 계약', () => {
  it('이벤트명은 백엔드와 동일한 class:signal 이다', () => {
    expect(CLASS_SIGNAL_EVENT).toBe('class:signal');
  });

  it('신호 유형은 3종(잘 따라가요·조금 어려워요·잠시 쉴게요)이다', () => {
    expect(CLASS_SIGNAL_TYPES).toEqual(['following', 'difficult', 'resting']);
    for (const type of CLASS_SIGNAL_TYPES) {
      const meta = CLASS_SIGNAL_META[type];
      expect(meta.icon).not.toBe('');
      expect(meta.label).not.toBe('');
      expect(meta.hint).not.toBe('');
      expect(meta.badgeClass).not.toBe('');
      expect(meta.buttonClass).not.toBe('');
    }
  });

  it('카드 표시(6초)는 집계 유지(10초)보다 짧다 — 페이드 후에도 카운트가 남는다', () => {
    expect(SIGNAL_FLASH_MS).toBeLessThan(SIGNAL_ACTIVE_MS);
    expect(SIGNAL_ACTIVE_MS).toBe(10_000);
  });

  it('isClassSignalType 는 미정의 값을 걸러낸다', () => {
    expect(isClassSignalType('following')).toBe(true);
    expect(isClassSignalType('difficult')).toBe(true);
    expect(isClassSignalType('resting')).toBe(true);
    expect(isClassSignalType('happy')).toBe(false);
    expect(isClassSignalType(undefined)).toBe(false);
    expect(isClassSignalType(null)).toBe(false);
    expect(isClassSignalType(3)).toBe(false);
    expect(isClassSignalType({ type: 'following' })).toBe(false);
  });
});

describe('활성 신호 맵', () => {
  it('참여자당 최신 1건만 유지하고 원본 맵을 변경하지 않는다', () => {
    const first: SignalMap = recordSignal({}, 'p1', 'following', NOW);
    const second = recordSignal(first, 'p1', 'difficult', NOW + 100);

    expect(first['p1']).toEqual({ type: 'following', at: NOW }); // 불변성
    expect(second['p1']).toEqual({ type: 'difficult', at: NOW + 100 });
    expect(Object.keys(second)).toEqual(['p1']); // 참여자당 1건
  });

  it('참여자 id 가 비면 무시한다', () => {
    const map: SignalMap = recordSignal({}, 'p1', 'resting', NOW);
    expect(recordSignal(map, '', 'following', NOW)).toBe(map);
  });

  it('pruneSignals 는 만료분만 제거하고 변화가 없으면 동일 참조를 돌려준다', () => {
    const map = recordSignal(recordSignal({}, 'p1', 'following', NOW), 'p2', 'resting', NOW);

    // 아직 TTL 이내 → 동일 참조(불필요한 리렌더 방지)
    expect(pruneSignals(map, NOW + 1000)).toBe(map);

    const pruned = pruneSignals(map, NOW + SIGNAL_ACTIVE_MS, SIGNAL_ACTIVE_MS);
    expect(Object.keys(pruned)).toEqual([]);
    expect(pruned).not.toBe(map);
  });
});

describe('집계 카운트', () => {
  it('유형별로 세고 만료된 신호는 제외한다', () => {
    let map: SignalMap = {};
    map = recordSignal(map, 'p1', 'following', NOW);
    map = recordSignal(map, 'p2', 'following', NOW + 500);
    map = recordSignal(map, 'p3', 'difficult', NOW + 500);
    map = recordSignal(map, 'p4', 'resting', NOW - SIGNAL_ACTIVE_MS - 1); // 만료

    const counts = countSignals(map, NOW + 1000);
    expect(counts).toEqual({ following: 2, difficult: 1, resting: 0, total: 3 });
  });

  it('빈 맵은 0 집계', () => {
    expect(countSignals({}, NOW)).toEqual({
      following: 0,
      difficult: 0,
      resting: 0,
      total: 0,
    });
  });

  it('요약 조각은 카운트가 있는 유형만 만든다', () => {
    expect(signalCountParts({ following: 2, difficult: 0, resting: 1, total: 3 })).toEqual([
      '🌿 잘 따라가요 2',
      '🌙 잠시 쉴게요 1',
    ]);
    expect(signalCountParts({ following: 0, difficult: 0, resting: 0, total: 0 })).toEqual([]);
  });
});

describe('Socket.IO 헬퍼', () => {
  it('emitClassSignal 은 연결 시 class:signal 로 payload 를 보낸다', () => {
    const { socket, emit } = fakeSocket(true);
    const ok = emitClassSignal(socket, {
      session_id: 's1',
      participant_id: 'p1',
      signal_type: 'following',
    });

    expect(ok).toBe(true);
    expect(emit).toHaveBeenCalledWith('class:signal', {
      session_id: 's1',
      participant_id: 'p1',
      signal_type: 'following',
    });
  });

  it('미연결이면 전송하지 않고 false 를 돌려준다', () => {
    const { socket, emit } = fakeSocket(false);
    expect(
      emitClassSignal(socket, { session_id: 's1', signal_type: 'resting' }),
    ).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('subscribeClassSignal 은 구독/해제를 같은 핸들러로 위임한다', () => {
    const { socket, on, off } = fakeSocket(true);
    const handler = vi.fn();

    const unsubscribe = subscribeClassSignal(socket, handler);
    expect(on).toHaveBeenCalledWith('class:signal', handler);

    unsubscribe();
    expect(off).toHaveBeenCalledWith('class:signal', handler);
  });
});
