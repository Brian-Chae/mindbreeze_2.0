// SDD-260 W1 — summary 대조. contract.md §2: min_index 이전/max_index 이후 누락은 서버가 모른다 → 로컬 집합 − 서버 보유 집합으로 판정(빈 배열=완료 금지).
import { describe, expect, it } from 'vitest';
import { diffAgainstSummary, type FeatureSummary } from '../../src/lib/measurement-web/feature-reconcile';

const S = 'stream-1';
const summary = (streams: FeatureSummary['streams']): FeatureSummary => ({ session_id: 's', participant_id: 'p', total_count: 0, streams, updated_at: null });
const stream = (o: Partial<FeatureSummary['streams'][number]>): FeatureSummary['streams'][number] => ({
  stream_id: S, count: 0, min_index: 0, max_index: 0, contiguous_through: -1, missing_ranges: [], truncated: false, ...o,
});
const seqs = (a: number, b: number): string[] => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

describe('diffAgainstSummary', () => {
  it('서버가 0..599 전부 보유 + 로컬 0..599 → 결측 없음', () => {
    const d = diffAgainstSummary({ [S]: seqs(0, 599) }, summary([stream({ count: 600, min_index: 0, max_index: 599, contiguous_through: 599 })]));
    expect(d.missing[S] ?? []).toEqual([]);
    expect(d.complete).toBe(true);
  });

  it('missing_ranges 가 빈 배열이어도 max_index 이후 로컬 창은 결측 (빈 배열=완료 금지)', () => {
    const d = diffAgainstSummary({ [S]: seqs(0, 599) }, summary([stream({ count: 500, min_index: 0, max_index: 499, contiguous_through: 499 })]));
    expect(d.missing[S]).toEqual(seqs(500, 599));
    expect(d.complete).toBe(false);
  });

  it('min_index 이전 누락과 내부 구간 결측을 모두 찾는다', () => {
    const d = diffAgainstSummary({ [S]: seqs(0, 29) }, summary([stream({ count: 15, min_index: 10, max_index: 29, contiguous_through: -1, missing_ranges: [[15, 24]] })]));
    expect(d.missing[S]).toEqual([...seqs(0, 9), ...seqs(15, 24)]);
  });

  it('서버에 없는 stream 은 전부 결측', () => {
    const d = diffAgainstSummary({ [S]: seqs(0, 4), other: ['0'] }, summary([]));
    expect(d.missing[S]).toEqual(seqs(0, 4));
    expect(d.missing.other).toEqual(['0']);
  });

  it('truncated 면 마지막 range 이후를 결측으로 간주해 재전송 후 재조회로 수렴', () => {
    const d = diffAgainstSummary({ [S]: seqs(0, 999) }, summary([stream({ count: 400, min_index: 0, max_index: 999, missing_ranges: [[100, 199]], truncated: true })]));
    expect(d.missing[S]).toEqual(seqs(100, 999));
    expect(d.complete).toBe(false);
  });

  it('u64 문자열 sequence 를 Number 로 깎지 않는다', () => {
    const big = '18446744073709551610';
    const d = diffAgainstSummary({ [S]: [big] }, summary([stream({ min_index: 0, max_index: 5 })]));
    expect(d.missing[S]).toEqual([big]);
  });

  it('로컬이 비어 있으면 완료', () => {
    expect(diffAgainstSummary({}, summary([])).complete).toBe(true);
  });
});
