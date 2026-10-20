// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBleGapLog, BLE_GAP_STORAGE_KEY } from '../src/lib/eeg/ble-gap-log';

describe('ble-gap-log', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('V5 끊김 시작 후 복구 전에는 미종료 상태, 복구 시 구간이 기록된다', () => {
    let now = 1000;
    const log = createBleGapLog({ now: () => now });
    log.open('connection-lost');
    expect(log.getOpenGap()).toMatchObject({ startedAt: 1000, reason: 'connection-lost', attempts: 0 });
    expect(log.getClosedGaps()).toHaveLength(0);

    log.recordAttempt();
    log.recordAttempt();
    now = 6500;
    const closed = log.close();
    expect(closed).toEqual({
      startedAt: 1000,
      endedAt: 6500,
      durationMs: 5500,
      reason: 'connection-lost',
      attempts: 2,
    });
    expect(log.getOpenGap()).toBeNull();
    expect(log.getClosedGaps()).toEqual([closed]);
  });

  it('이미 열린 구간에서 open 을 다시 호출해도 시작 시각을 유지한다', () => {
    let now = 10;
    const log = createBleGapLog({ now: () => now });
    log.open('a');
    now = 50;
    log.open('b');
    expect(log.getOpenGap()?.startedAt).toBe(10);
    expect(log.getOpenGap()?.reason).toBe('a');
  });

  it('열린 구간이 없을 때 close/recordAttempt 는 무시된다', () => {
    const log = createBleGapLog();
    expect(log.close()).toBeNull();
    expect(() => log.recordAttempt()).not.toThrow();
  });

  it('V6 링버퍼 상한을 넘으면 오래된 것부터 삭제한다', () => {
    let now = 0;
    const log = createBleGapLog({ now: () => now, maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      now = i * 100;
      log.open(`r${i}`);
      now += 10;
      log.close();
    }
    expect(log.getClosedGaps().map((g) => g.reason)).toEqual(['r2', 'r3', 'r4']);
    const stored = JSON.parse(localStorage.getItem(BLE_GAP_STORAGE_KEY) ?? '[]') as { reason: string }[];
    expect(stored.map((g) => g.reason)).toEqual(['r2', 'r3', 'r4']);
  });

  it('V6 localStorage 접근 실패에도 예외 없이 메모리에는 기록한다', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const log = createBleGapLog();
    log.open('x');
    expect(() => log.close()).not.toThrow();
    expect(log.getClosedGaps()).toHaveLength(1);
    spy.mockRestore();
  });
});
