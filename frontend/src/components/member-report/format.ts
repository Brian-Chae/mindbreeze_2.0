// 회원 리포트 화면 공용 포맷·차트 계산 유틸 (SDD-327 T7)
import type { Direction, MemberReport, MetricKey, MetricSection } from '../../lib/member-report/types';

/** 숫자를 지정 소수 자리로 표기. null 이면 대시 */
export function fmt(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return value.toFixed(decimals);
}

/** 부호를 붙인 차이값 */
export function fmtSigned(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  const s = value.toFixed(decimals);
  return value > 0 ? `+${s}` : s;
}

export function directionArrow(d: Direction): string {
  return d === 'up' ? '↑' : d === 'down' ? '↓' : '→';
}

/** 연속된 non-null 구간(run)으로 쪼갠다 — 결측 분에서 선을 끊기 위함 */
export function splitRuns(values: (number | null)[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  values.forEach((v, i) => {
    if (v !== null && v !== undefined) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ start, end: i - 1 });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ start, end: values.length - 1 });
  return runs;
}

/** 두 배열이 모두 값이 있는 구간의 run */
export function splitRunsPair(a: (number | null)[], b: (number | null)[]): { start: number; end: number }[] {
  const merged = a.map((v, i) => (v !== null && b[i] !== null && b[i] !== undefined ? 1 : null));
  return splitRuns(merged);
}

export interface ChartBox { w: number; h: number; l: number; r: number; t: number; b: number }

export function scaleLinear(v: number, d0: number, d1: number, r0: number, r1: number): number {
  if (d1 === d0) return (r0 + r1) / 2;
  return r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/** 보이는 지표 섹션(ok 만) */
export function visibleSections(report: MemberReport, chapter: 'body' | 'mind'): MetricSection[] {
  const bodyOrder: MetricKey[] = ['motion', 'heart_rate', 'rmssd', 'lf_hf'];
  const mindOrder: MetricKey[] = ['focus', 'relaxation', 'emotional_balance', 'aperiodic'];
  const order = chapter === 'body' ? bodyOrder : mindOrder;
  const out: MetricSection[] = [];
  for (const k of order) {
    const sec = report.metrics[k];
    if (sec && sec.state === 'ok' && sec.body) out.push(sec);
  }
  return out;
}
