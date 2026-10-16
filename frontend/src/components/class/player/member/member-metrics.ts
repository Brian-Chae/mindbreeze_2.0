// SDD-208 M1 — 회원 지표 표시 헬퍼. 지표 정의(라벨·단위·스케일)는 공용 PLAYER_METRICS 를 쓰고 복제하지 않는다.
// 회원 화면에는 다른 참가자와 견주는 수치(평균·순위·델타)를 두지 않으므로 여기에는 "내 값"의 호 길이·5분 변화·스파크라인만 있다.
import { PLAYER_METRICS, type PlayerMetric, type PlayerMetricKey } from '../../../../lib/class/player-case';

export type MetricSnapshot = Record<PlayerMetricKey, number | null>;
export type MetricSeries = Record<PlayerMetricKey, readonly number[]>;

/** 1Hz 링버퍼 길이 = 5분 */
export const MEMBER_SERIES_MAX = 300;
/** 이보다 짧으면 변화 문구를 만들지 않는다(초) */
const MIN_TREND_SEC = 30;
const SPARK_POINTS = 31;
const SPARK_W = 200;
const SPARK_H = 48;
const SPARK_PAD = 8;

export const METRIC_GUIDE: Record<PlayerMetricKey, string> = {
  focus: '집중도는 최근 5분간 차분하게 이어졌어요',
  relaxation: '이완도는 최근 5분간 부드럽게 이어졌어요',
  emotional: '감정균형도는 최근 5분간 고르게 이어졌어요',
  bpm: 'BPM은 최근 5분간 안정적으로 이어졌어요',
  respiration: '호흡은 최근 5분간 고르게 이어졌어요',
  hrv: 'HRV는 최근 5분간 꾸준히 이어졌어요',
};

export function metricDef(key: PlayerMetricKey): PlayerMetric {
  const def = PLAYER_METRICS.find((m) => m.key === key);
  if (!def) throw new Error(`알 수 없는 지표: ${key}`);
  return def;
}

/** 링 호 길이(0~1). 값이 없으면 null */
export function metricFraction(key: PlayerMetricKey, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const [min, max] = metricDef(key).scale.member;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function emptySeries(): Record<PlayerMetricKey, number[]> {
  return { focus: [], relaxation: [], emotional: [], bpm: [], respiration: [], hrv: [] };
}

/** 불변 갱신 — MEMBER_SERIES_MAX 초과 시 가장 오래된 값부터 제거 */
export function pushRingPoint(buf: readonly number[], value: number): number[] {
  const next = [...buf, value];
  return next.length > MEMBER_SERIES_MAX ? next.slice(next.length - MEMBER_SERIES_MAX) : next;
}

/** 초 → mm:ss */
export function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** "5분간 +8" — 내 값의 처음과 끝의 차(D12: 본인 변화만 허용). 5분이 안 찼으면 쌓인 분 수로 표시 */
export function formatTrendChange(series: readonly number[]): string {
  if (series.length < MIN_TREND_SEC) return '측정 중';
  const minutes = Math.min(5, Math.max(1, Math.round(series.length / 60)));
  const delta = Math.round(series[series.length - 1]) - Math.round(series[0]);
  const sign = delta > 0 ? `+${delta}` : delta < 0 ? `-${Math.abs(delta)}` : '0';
  return `${minutes}분간 ${sign}`;
}

/** 표시용으로 점 수를 줄인다(처음·끝 유지, 균등 추출). Float32Array 같은 ArrayLike 도 받는다 */
export function downsample(values: ArrayLike<number>, count: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n <= count) return Array.from(values);
  if (count < 2) return [values[n - 1]];
  const last = n - 1;
  return Array.from({ length: count }, (_, i) => values[Math.round((i * last) / (count - 1))]);
}

function resample(series: readonly number[], count: number): number[] {
  if (series.length <= count) return [...series];
  const last = series.length - 1;
  return Array.from({ length: count }, (_, i) => series[Math.round((i * last) / (count - 1))]);
}

export interface SparkGeometry {
  line: string;
  area: string;
  /** 끝점의 세로 위치(0~100%) */
  endY: number;
}

/** viewBox 200×48 기준 부드러운 선·면 경로. 점이 2개 미만이면 null */
export function sparkGeometry(series: readonly number[], key: PlayerMetricKey): SparkGeometry | null {
  const values = resample(series, SPARK_POINTS).filter((v) => Number.isFinite(v));
  if (values.length < 2) return null;
  const [min, max] = metricDef(key).scale.member;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const minRange = (max - min) * 0.12;
  if (hi - lo < minRange) {
    const mid = (hi + lo) / 2;
    lo = mid - minRange / 2;
    hi = mid + minRange / 2;
  }
  const span = hi - lo;
  const pts = values.map((v, i): [number, number] => [(i / (values.length - 1)) * SPARK_W, SPARK_H - SPARK_PAD - ((v - lo) / span) * (SPARK_H - SPARK_PAD * 2)]);
  const f = (n: number): string => n.toFixed(1);
  let line = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    line += ` Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
  }
  const end = pts[pts.length - 1];
  line += ` L${f(end[0])} ${f(end[1])}`;
  return { line, area: `${line} L${SPARK_W} ${SPARK_H} L0 ${SPARK_H} Z`, endY: (end[1] / SPARK_H) * 100 };
}
