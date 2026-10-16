import { describe, expect, it } from 'vitest';
import { formatEndDuration } from '../src/lib/class/member-end';

const NOW = Date.parse('2026-10-16T11:00:00Z');

describe('formatEndDuration — 종료 카드의 "함께한 시간"', () => {
  it('시작 시각부터 지금까지를 분 단위로 반올림한다', () => {
    expect(formatEndDuration({ startedAt: '2026-10-16T10:29:00Z', durationMin: 50, nowMs: NOW })).toBe('31분');
  });
  it('1분 미만이어도 최소 1분으로 표시한다', () => {
    expect(formatEndDuration({ startedAt: '2026-10-16T10:59:50Z', durationMin: 50, nowMs: NOW })).toBe('1분');
  });
  it('시작 시각이 없거나 읽을 수 없으면 계획 시간을 쓴다', () => {
    expect(formatEndDuration({ startedAt: null, durationMin: 50, nowMs: NOW })).toBe('50분');
    expect(formatEndDuration({ startedAt: '잘못된 값', durationMin: 40, nowMs: NOW })).toBe('40분');
  });
  it('시작 시각이 미래이면(시계 오차) 최소 1분이다', () => {
    expect(formatEndDuration({ startedAt: '2026-10-16T11:10:00Z', durationMin: 50, nowMs: NOW })).toBe('1분');
  });
});
