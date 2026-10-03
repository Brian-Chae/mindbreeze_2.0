import { averageMetricBuckets } from '../../lib/class/metric-buckets';

interface MetricBarChartProps {
  values: readonly number[];
  label: string;
  unit: string;
  maxValue: number;
  /** 낮을수록 좋은 지표(BPM·호흡) — 차트 방향 코멘트에 사용 */
  lowerIsBetter?: boolean;
  /** 차트 노트에 붙는 스케일 안내 (예: "0–60ms 기준") */
  scaleNote?: string;
}

/** 5분간 추세 — 첫 유효 구간 대비 마지막 유효 구간의 증감 */
function computeTrend(averages: readonly (number | null)[]): number | null {
  const nums = averages.filter((value): value is number => value !== null);
  if (nums.length < 2) return null;
  const delta = Math.round(nums[nums.length - 1] - nums[0]);
  return delta === 0 ? null : delta;
}

/** 차트 노트 — 스케일 안내 + (낮을수록 좋은 지표의) 방향 코멘트 */
function buildNote(
  lowerIsBetter: boolean,
  scaleNote: string | undefined,
  trend: number | null,
  hasData: boolean,
): string {
  const parts = ['최근 5분 · 25초 구간 평균'];
  if (scaleNote) parts.push(scaleNote);
  if (hasData && lowerIsBetter && trend !== null) {
    parts.push(trend < 0 ? '천천히 낮아지는 중 · 안정' : '다소 높아지는 중');
  }
  return parts.join(' · ');
}

export function MetricBarChart({ values, label, unit, maxValue, lowerIsBetter = false, scaleNote }: MetricBarChartProps) {
  const averages = averageMetricBuckets(values);
  const hasData = averages.some((value) => value !== null);
  const trend = computeTrend(averages);
  const note = buildNote(lowerIsBetter, scaleNote, trend, hasData);

  return (
    <section className="player-chart" aria-label={`${label} 최근 5분 구간 평균`}>
      <div className="player-chart-head">
        <span><strong>{label}</strong> · 시간 변화</span>
        <span>
          {trend !== null ? (
            <>{trend > 0 ? '▲' : '▼'} 5분간 <b>{trend > 0 ? `+${trend}` : trend}</b></>
          ) : (
            <b>—</b>
          )}
        </span>
      </div>
      <p className="player-chart-note">{note}</p>
      {hasData ? (
        <div className="player-bars" role="img" aria-label={`${label} 12구간 평균: ${averages.map((value) => (value === null ? '미측정' : Math.round(value))).join(', ')} ${unit}`}>
          {averages.map((value, index) => (
            <div
              key={index}
              className={index === 11 ? 'player-bar player-bar-now' : 'player-bar'}
              data-empty={value === null}
              style={{ height: value === null ? 0 : `${Math.max(0, Math.min(100, (value / maxValue) * 100))}%` }}
              title={value === null ? '미측정' : `${Math.round(value)} ${unit}`}
            />
          ))}
        </div>
      ) : (
        <div className="player-chart-empty">지표 차트는 LINK BAND 연결 후 표시됩니다</div>
      )}
      <div className="player-axis"><span>5분 전</span><span>지금</span></div>
    </section>
  );
}
