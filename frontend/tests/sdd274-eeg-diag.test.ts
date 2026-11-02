// SDD-274 — EEG 입력 진단(ed). 코어 clock.rs admit 와 같은 gap 식, 코드 형식, 기존 pd/ld 불변.
import { beforeEach, describe, expect, it } from 'vitest';
import { eegDiagCode, eegDiagSnapshot, observeEegPacket, resetEegDiag, setEegStatusTotals } from '../src/lib/measurement-web/eeg-diag';
import { ppgDiagCode, resetPpgDiag } from '../src/lib/measurement-web/ppg-diag';

const TICKS_PER_SAMPLE = 32768 / 250;
const at = (sampleIdx: number) => Math.round(sampleIdx * TICKS_PER_SAMPLE);

describe('EEG 진단', () => {
  beforeEach(() => { resetEegDiag(); });

  it('V8 연속 패킷(5샘플)은 gap 0', () => {
    observeEegPacket(at(0), 5, 0);
    observeEegPacket(at(5), 5, 20_000);
    observeEegPacket(at(10), 5, 40_000);
    const d = eegDiagSnapshot();
    expect(d.gapSum).toBe(0);
    expect(d.refill).toBe(0);
    expect(d.pkts).toBe(3);
  });
  it('V8 2샘플 누락은 재충전 아님, 3샘플 누락(>2)은 재충전 1회', () => {
    observeEegPacket(at(0), 5, 0);
    observeEegPacket(at(7), 5, 20_000);   // 누락 2
    observeEegPacket(at(15), 5, 40_000);  // 누락 3
    const d = eegDiagSnapshot();
    expect(d.gapSum).toBe(5);
    expect(d.gapMax).toBe(3);
    expect(d.refill).toBe(1);
  });
  it('V9 tick 되감김·600초 초과 점프는 reset, 같은 tick 은 gap 에 더하지 않는다', () => {
    observeEegPacket(at(0), 5, 0);
    observeEegPacket(at(0), 5, 1_000);          // 중복(같은 tick)
    observeEegPacket(at(5), 5, 20_000);
    observeEegPacket(at(5) - 100 * 32768, 5, 30_000); // 100초 되감김 → reset
    observeEegPacket(at(5) + 700 * 32768, 5, 40_000); // 700초 점프 → reset
    const d = eegDiagSnapshot();
    expect(d.gapSum).toBe(0);
    expect(d.reset).toBe(2);
  });
  it('u32 wrap 은 정상 전진으로 본다', () => {
    observeEegPacket(0xffffffff - 10, 5, 0);
    observeEegPacket((0xffffffff - 10 + at(5)) >>> 0, 5, 20_000);
    expect(eegDiagSnapshot().gapSum).toBe(0);
    expect(eegDiagSnapshot().reset).toBe(0);
  });
  it('stall(1.5초↑)·burst(5ms 이내) 도착 모양', () => {
    observeEegPacket(at(0), 5, 0);
    observeEegPacket(at(5), 5, 2_000_000);
    observeEegPacket(at(10), 5, 2_001_000);
    const d = eegDiagSnapshot();
    expect(d.stall).toBe(1);
    expect(d.burst).toBe(1);
  });
  it('V10 코드 형식, 코어 판정 누계 반영, pd 형식 불변', () => {
    observeEegPacket(at(0), 5, 0);
    setEegStatusTotals({ acc: 10, dup: 1, ooo: 2, conf: 0, inv: 0 });
    expect(eegDiagCode()).toBe('a10.d1.o2.c0.i0.p1.s0.b0.g0.m0.r0.x0');
    resetPpgDiag();
    expect(ppgDiagCode()).toBe('a0.d0.o0.c0.i0.p0.s0.b0');
  });
});
