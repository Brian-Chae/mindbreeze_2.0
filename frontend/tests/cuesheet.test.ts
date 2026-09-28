// 개선 7: 진행 큐시트(타임라인 대본) 순수 로직 테스트
import { describe, expect, it } from 'vitest';
import type { CuesheetStep } from '../src/lib/api/session';
import {
  CUESHEET_MAX_STEPS,
  buildCueTimeline,
  computeCueProgress,
  cuesheetTotalMin,
  formatCueClock,
  normalizeCuesheet,
} from '../src/lib/class/cuesheet';

const FLOW: CuesheetStep[] = [
  { label: '도입 호흡', duration_min: 5, note: '4-7-8 호흡' },
  { label: '바디스캔', duration_min: 20, note: null },
  { label: '마무리', duration_min: 5, note: '심호흡' },
];

describe('normalizeCuesheet', () => {
  it('라벨이 빈 단계는 버리고 라벨/메모를 trim 한다', () => {
    const out = normalizeCuesheet([
      { label: '  도입 호흡  ', duration_min: 5, note: '  편안히  ' },
      { label: '   ', duration_min: 5 },
    ]);
    expect(out).toEqual([{ label: '도입 호흡', duration_min: 5, note: '편안히' }]);
  });

  it('목표 시간은 1~600분 정수로 클램프한다', () => {
    expect(normalizeCuesheet([{ label: 'A', duration_min: 0 }])[0].duration_min).toBe(1);
    expect(normalizeCuesheet([{ label: 'A', duration_min: -9 }])[0].duration_min).toBe(1);
    expect(normalizeCuesheet([{ label: 'A', duration_min: 9999 }])[0].duration_min).toBe(600);
    expect(normalizeCuesheet([{ label: 'A', duration_min: 7.4 }])[0].duration_min).toBe(7);
  });

  it('빈 메모는 null 로 정규화한다', () => {
    expect(normalizeCuesheet([{ label: 'A', duration_min: 3, note: '   ' }])[0].note).toBeNull();
  });

  it('null/undefined 입력은 빈 배열', () => {
    expect(normalizeCuesheet(null)).toEqual([]);
    expect(normalizeCuesheet(undefined)).toEqual([]);
  });

  it('최대 단계 수를 넘으면 뒤에서 자른다', () => {
    const many = Array.from({ length: CUESHEET_MAX_STEPS + 5 }, (_, i) => ({
      label: `단계 ${i}`,
      duration_min: 1,
    }));
    expect(normalizeCuesheet(many)).toHaveLength(CUESHEET_MAX_STEPS);
  });
});

describe('buildCueTimeline / cuesheetTotalMin', () => {
  it('누적 오프셋(초)을 붙인다', () => {
    const timeline = buildCueTimeline(FLOW);
    expect(timeline.map((e) => [e.startSec, e.endSec])).toEqual([
      [0, 300],
      [300, 1500],
      [1500, 1800],
    ]);
    expect(timeline[1].durationMin).toBe(20);
  });

  it('총 길이(분)는 단계 합계', () => {
    expect(cuesheetTotalMin(FLOW)).toBe(30);
    expect(cuesheetTotalMin([])).toBe(0);
  });
});

describe('computeCueProgress', () => {
  it('큐시트가 없으면 index -1 · remaining null', () => {
    const p = computeCueProgress([], 120);
    expect(p.index).toBe(-1);
    expect(p.current).toBeNull();
    expect(p.remainingSec).toBeNull();
    expect(p.totalSec).toBe(0);
  });

  it('시작 직후(0초)에는 첫 단계가 활성', () => {
    const p = computeCueProgress(FLOW, 0);
    expect(p.index).toBe(0);
    expect(p.current?.label).toBe('도입 호흡');
    expect(p.remainingSec).toBe(300);
    expect(p.ratio).toBe(0);
    expect(p.next?.label).toBe('바디스캔');
  });

  it('2단계 중간이면 남은 시간·진행률이 단계 기준으로 계산된다', () => {
    // 1단계(300초) 종료 후 2단계 600초 경과 → 2단계(1200초)의 절반
    const p = computeCueProgress(FLOW, 300 + 600);
    expect(p.index).toBe(1);
    expect(p.current?.label).toBe('바디스캔');
    expect(p.elapsedInStepSec).toBe(600);
    expect(p.remainingSec).toBe(600);
    expect(p.ratio).toBeCloseTo(0.5, 5);
    expect(p.finished).toBe(false);
  });

  it('경계 시각은 다음 단계로 넘어간다', () => {
    expect(computeCueProgress(FLOW, 299).index).toBe(0);
    expect(computeCueProgress(FLOW, 300).index).toBe(1);
  });

  it('모든 단계를 지나면 finished 이고 남은 시간은 0', () => {
    const p = computeCueProgress(FLOW, 1800);
    expect(p.finished).toBe(true);
    expect(p.index).toBe(2);
    expect(p.remainingSec).toBe(0);
    expect(p.ratio).toBe(1);
  });

  it('음수·비정상 경과 초는 0으로 취급한다', () => {
    expect(computeCueProgress(FLOW, -50).index).toBe(0);
    expect(computeCueProgress(FLOW, Number.NaN).index).toBe(0);
  });
});

describe('formatCueClock', () => {
  it('플레이어 타이머와 같은 00분 00초 형식', () => {
    expect(formatCueClock(0)).toBe('00분 00초');
    expect(formatCueClock(65)).toBe('01분 05초');
    expect(formatCueClock(-3)).toBe('00분 00초');
    expect(formatCueClock(Number.NaN)).toBe('00분 00초');
  });
});
