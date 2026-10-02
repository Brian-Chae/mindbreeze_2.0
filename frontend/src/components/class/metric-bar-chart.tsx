import { averageMetricBuckets } from '../../lib/class/metric-buckets';

interface MetricBarChartProps {
  values: readonly number[];
  label: string;
  unit: string;
  maxValue: number;
}

export function MetricBarChart({ values, label, unit, maxValue }: MetricBarChartProps) {
  const averages = averageMetricBuckets(values);
  const current = averages.at(-1);
  const hasData = averages.some((value) => value !== null);
  return (
    <section className="player-chart" aria-label={`${label} 최근 5분 구간 평균`}>
      <div className="player-chart-head">
        <span><strong>{label}</strong> · 시간 변화</span>
        <span><b>{current == null ? '—' : Math.round(current)}</b> {unit}</span>
      </div>
      <p className="player-chart-note">최근 5분 · 25초 구간 평균</p>
      {hasData ? (
        <div className="player-bars" role="img" aria-label={`${label} 12구간 평균: ${averages.map((value) => value === null ? '미측정' : Math.round(value)).join(', ')} ${unit}`}>
          {averages.map((value, index) => (
            <div
              key={index}
              className={index === 11 ? 'player-bar player-bar-now' : 'player-bar'}
              data-empty={value === null}
              style={{ height: value === null ? 0 : `${Math.max(0, Math.min(100, value / maxValue * 100))}%` }}
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
