import { describe, expect, it } from 'vitest';
import { barPercent, participantProgressKind, summarizeProgress, type ParticipantQuantities } from '../../src/lib/upload-status/progress';

const q = (expected: number | null, received: number) => ({ expected, received });
const p = (f: [number | null, number], e: [number | null, number], pp: [number | null, number], a: [number | null, number], excluded = false): ParticipantQuantities => ({
  excluded, feature: q(...f), raw: { eeg: q(...e), ppg: q(...pp), acc: q(...a) },
});

describe('SDD-264 진행률 수식', () => {
  it('전부 수신 → all_received', () => {
    expect(participantProgressKind(p([10, 10], [5, 5], [5, 5], [5, 5]))).toBe('all_received');
  });
  it('일부 미수신 → in_progress', () => {
    expect(participantProgressKind(p([10, 9], [5, 5], [5, 5], [5, 5]))).toBe('in_progress');
  });
  it('기대 하나라도 미보고 → expected_unknown (분모에서 빼지 않고 따로 센다)', () => {
    const rows = [p([10, 10], [5, 5], [5, 5], [5, 5]), p([null, 3], [null, 1], [null, 1], [null, 1])];
    const s = summarizeProgress(rows);
    expect(s.participantsTotal).toBe(2);
    expect(s.participantsAllReceived).toBe(1);
    expect(s.expectedUnknown).toBe(1);
    expect(s.feature).toEqual({ received: 10, expected: 10 });
  });
  it('수집 제외는 분모에서 제외, 기대 0·수신 0 도 0% 가 아닌 null', () => {
    const s = summarizeProgress([p([0, 0], [0, 0], [0, 0], [0, 0], true)]);
    expect(s.excluded).toBe(1);
    expect(s.participantsTotal).toBe(0);
    expect(s.overall).toBeNull();
    expect(barPercent(s.overall)).toBeNull();
  });
  it('초과 수신은 기대까지만 센다', () => {
    const s = summarizeProgress([p([10, 15], [5, 5], [5, 5], [5, 5])]);
    expect(s.feature).toEqual({ received: 10, expected: 10 });
    expect(s.overall).toBe(1);
  });
  it('전체 진행률 = (feature+원시 수신)/(feature+원시 기대), 신호별 합계 분리', () => {
    const s = summarizeProgress([p([10, 5], [10, 5], [4, 4], [6, 0])]);
    expect(s.rawBySignal.eeg).toEqual({ received: 5, expected: 10 });
    expect(s.raw).toEqual({ received: 9, expected: 20 });
    expect(s.overall).toBeCloseTo(14 / 30, 10);
  });
  it('막대는 내림: 99.9% 는 99', () => {
    expect(barPercent(0.999)).toBe(99);
    expect(barPercent(1)).toBe(100);
    expect(barPercent(-1)).toBe(0);
  });
});
