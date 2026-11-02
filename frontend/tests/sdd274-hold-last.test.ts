// SDD-274 — 비회원 자기 화면 직전 유효값 유지 규칙 경계.
import { describe, expect, it } from 'vitest';
import { HOLD_MIND_MS, holdMindMetrics, type HeldMind } from '../src/lib/session-live/hold-last-snapshot';
import type { MetricSnapshot } from '../src/components/class/player/member/member-metrics';

const snap = (p: Partial<MetricSnapshot> = {}): MetricSnapshot => ({ focus: null, relaxation: null, emotional: null, bpm: null, respiration: null, hrv: null, ...p });
const on = { enabled: true, blocked: false } as const;
const T0 = 1_000_000;

describe('holdMindMetrics', () => {
  it('V1 직전 유효 → null 1~14초 유지(지표별 독립)', () => {
    const a = holdMindMetrics(snap({ focus: 60, relaxation: 50, emotional: 40 }), {}, T0, on);
    const b = holdMindMetrics(snap({ focus: null, relaxation: 51, emotional: null }), a.held, T0 + 7_000, on);
    expect(b.snapshot.focus).toBe(60);
    expect(b.snapshot.relaxation).toBe(51);
    expect(b.snapshot.emotional).toBe(40);
  });
  it('V2 15초 경계: 15000ms 유지, 15001ms "-"', () => {
    const a = holdMindMetrics(snap({ focus: 60 }), {}, T0, on);
    expect(HOLD_MIND_MS).toBe(15_000);
    expect(holdMindMetrics(snap(), a.held, T0 + 15_000, on).snapshot.focus).toBe(60);
    expect(holdMindMetrics(snap(), a.held, T0 + 15_001, on).snapshot.focus).toBeNull();
  });
  it('V3 blocked(lead_off/해제/stale) 즉시 null, 보관분 폐기', () => {
    const a = holdMindMetrics(snap({ focus: 60 }), {}, T0, on);
    const b = holdMindMetrics(snap(), a.held, T0 + 1_000, { enabled: true, blocked: true });
    expect(b.snapshot.focus).toBeNull();
    const c = holdMindMetrics(snap(), b.held, T0 + 2_000, on);
    expect(c.snapshot.focus).toBeNull(); // 복귀 후 옛 값 부활 금지
  });
  it('V4 새 유효값은 즉시 교체되고 새 값 기준으로 15초', () => {
    const a = holdMindMetrics(snap({ focus: 60 }), {}, T0, on);
    const b = holdMindMetrics(snap({ focus: 70 }), a.held, T0 + 10_000, on);
    expect(b.snapshot.focus).toBe(70);
    expect(holdMindMetrics(snap(), b.held, T0 + 24_000, on).snapshot.focus).toBe(70);
    expect(holdMindMetrics(snap(), b.held, T0 + 25_001, on).snapshot.focus).toBeNull();
  });
  it('V5 유효값이 없었으면 null 유지(0 위장 금지)', () => {
    expect(holdMindMetrics(snap(), {}, T0, on).snapshot.focus).toBeNull();
  });
  it('V6 비활성은 입력 그대로, 호흡·HRV·BPM 은 유지하지 않는다', () => {
    const input = snap({ focus: null });
    expect(holdMindMetrics(input, { focus: { value: 9, at: T0 } }, T0 + 1, { enabled: false, blocked: false }).snapshot).toBe(input);
    const a = holdMindMetrics(snap({ bpm: 70, respiration: 15, hrv: 40 }), {}, T0, on);
    const b = holdMindMetrics(snap(), a.held, T0 + 1_000, on);
    expect(b.snapshot.bpm).toBeNull();
    expect(b.snapshot.respiration).toBeNull();
    expect(b.snapshot.hrv).toBeNull();
  });
  it('V7 입력·이전 보관분을 변경하지 않는다', () => {
    const prev: HeldMind = { focus: { value: 60, at: T0 } };
    const frozen = JSON.stringify(prev);
    const input = Object.freeze(snap());
    const out = holdMindMetrics(input, Object.freeze(prev), T0 + 1_000, on);
    expect(out.snapshot).not.toBe(input);
    expect(JSON.stringify(prev)).toBe(frozen);
    expect(input.focus).toBeNull();
  });
  it('비유한 값(NaN)은 무효로 본다', () => {
    const a = holdMindMetrics(snap({ focus: 60 }), {}, T0, on);
    expect(holdMindMetrics(snap({ focus: Number.NaN }), a.held, T0 + 1_000, on).snapshot.focus).toBe(60);
  });
});
