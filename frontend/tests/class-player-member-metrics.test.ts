// SDD-208 M1 — 회원 지표 표시 헬퍼(링 호 길이·5분 변화 문구·스파크라인·링버퍼)
import { describe, expect, it } from 'vitest';
import {
  MEMBER_SERIES_MAX,
  METRIC_GUIDE,
  downsample,
  emptySeries,
  formatClock,
  formatTrendChange,
  metricFraction,
  pushRingPoint,
  sparkGeometry,
} from '../src/components/class/player/member/member-metrics';
import { PLAYER_METRICS } from '../src/lib/class/player-case';

const ramp = (from: number, to: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

describe('metricFraction — 회원 스케일 기준 호 길이', () => {
  it.each([
    ['relaxation', 72, 0.72],
    ['bpm', 90, 0.5],
    ['respiration', 5, 0],
    ['hrv', 100, 1],
  ] as const)('%s=%i → %f', (key, value, expected) => {
    expect(metricFraction(key, value)).toBeCloseTo(expected, 5);
  });
  it('범위를 넘으면 0~1 로 자르고, 값이 없으면 null', () => {
    expect(metricFraction('focus', 130)).toBe(1);
    expect(metricFraction('focus', -5)).toBe(0);
    expect(metricFraction('focus', null)).toBeNull();
  });
});

describe('METRIC_GUIDE — 시안 안내 문구(지표 6개 전부)', () => {
  it('지표마다 문구가 있고 호흡 지시·비교 표현이 없다', () => {
    for (const metric of PLAYER_METRICS) {
      expect(METRIC_GUIDE[metric.key]).toMatch(/최근 5분간/);
      expect(METRIC_GUIDE[metric.key]).not.toMatch(/그룹|평균|순위|점수|호흡에 집중/);
    }
    expect(METRIC_GUIDE.relaxation).toBe('이완도는 최근 5분간 부드럽게 이어졌어요');
    expect(METRIC_GUIDE.respiration).toBe('호흡은 최근 5분간 고르게 이어졌어요');
  });
});

describe('formatTrendChange — 본인 변화만(D12)', () => {
  it('300초(5분) 버퍼: 처음과 끝의 차를 "5분간 +N" 으로', () => {
    expect(formatTrendChange(ramp(64, 72, 300))).toBe('5분간 +8');
    expect(formatTrendChange(ramp(60, 57, 300))).toBe('5분간 -3');
    expect(formatTrendChange(ramp(50, 50, 300))).toBe('5분간 0');
  });
  it('5분이 안 찼으면 쌓인 분 수로 표시한다', () => {
    expect(formatTrendChange(ramp(50, 55, 120))).toBe('2분간 +5');
    expect(formatTrendChange(ramp(50, 55, 60))).toBe('1분간 +5');
  });
  it('30초 미만이면 "측정 중"', () => {
    expect(formatTrendChange([])).toBe('측정 중');
    expect(formatTrendChange(ramp(50, 55, 29))).toBe('측정 중');
  });
});

describe('sparkGeometry', () => {
  it('선·면 경로와 끝점 위치(%)를 만든다', () => {
    const g = sparkGeometry(ramp(64, 72, 300), 'relaxation');
    expect(g).not.toBeNull();
    expect(g?.line.startsWith('M')).toBe(true);
    expect(g?.area.endsWith('Z')).toBe(true);
    expect(g?.endY).toBeGreaterThanOrEqual(0);
    expect(g?.endY).toBeLessThanOrEqual(100);
  });
  it('값이 일정해도 NaN 이 없다', () => {
    const g = sparkGeometry(ramp(50, 50, 300), 'focus');
    expect(g?.line).not.toContain('NaN');
    expect(g?.endY).not.toBeNaN();
  });
  it('점이 2개 미만이면 null', () => {
    expect(sparkGeometry([], 'focus')).toBeNull();
    expect(sparkGeometry([50], 'focus')).toBeNull();
  });
});

describe('링버퍼(1Hz · 5분)', () => {
  it('pushRingPoint 는 새 배열을 돌려주고 MEMBER_SERIES_MAX(300)를 넘기면 오래된 값부터 버린다', () => {
    const base = Array.from({ length: MEMBER_SERIES_MAX }, (_, i) => i);
    const next = pushRingPoint(base, 999);
    expect(next).not.toBe(base);
    expect(next).toHaveLength(MEMBER_SERIES_MAX);
    expect(next[0]).toBe(1);
    expect(next.at(-1)).toBe(999);
    expect(base).toHaveLength(MEMBER_SERIES_MAX);
  });
  it('emptySeries 는 6지표 키를 모두 빈 배열로 만든다', () => {
    expect(Object.keys(emptySeries()).sort()).toEqual(PLAYER_METRICS.map((m) => m.key).sort());
    expect(Object.values(emptySeries()).every((v) => v.length === 0)).toBe(true);
  });
});

describe('formatClock', () => {
  it('초 → mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(754)).toBe('12:34');
    expect(formatClock(1800)).toBe('30:00');
    expect(formatClock(-3)).toBe('00:00');
  });
});

describe('downsample — 기기 시트 원시 파형 표시용', () => {
  const ramp300 = Array.from({ length: 300 }, (_, i) => i);
  it('count 이하면 그대로 복사해 돌려준다(원본 불변)', () => {
    const src = [1, 2, 3];
    const out = downsample(src, 120);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(src);
  });
  it('count 를 넘으면 처음과 끝을 지키며 균등 추출한다', () => {
    const out = downsample(ramp300, 120);
    expect(out).toHaveLength(120);
    expect(out[0]).toBe(0);
    expect(out[119]).toBe(299);
    expect(out.every((v, i) => i === 0 || v >= out[i - 1])).toBe(true);
  });
  it('ArrayLike(Float32Array 등)도 받는다', () => {
    expect(downsample(new Float32Array([1, 2, 3, 4, 5, 6]), 3)).toEqual([1, 4, 6]);
  });
  it('빈 입력은 빈 배열, count<2 는 빈 배열이 아니라 마지막 값 하나', () => {
    expect(downsample([], 10)).toEqual([]);
    expect(downsample([5, 6, 7], 1)).toEqual([7]);
  });
});
