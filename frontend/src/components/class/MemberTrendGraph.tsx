// SDD-125 후속: 지난 5분 추이 그래프 뷰어 — 6개 지표 중 1개를 선택해 1Hz 링버퍼 시계열을 본다.
// 왼쪽 "나의 상태" 카드 하단에 붙는다. 지표 선택 칩 + SVG 라인 차트(그룹 평균 기준선 포함).

import { useMemo } from 'react';

interface TrendMetric {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
}

interface MemberTrendGraphProps {
  metrics: readonly TrendMetric[];
  selected: string;
  onSelect: (key: string) => void;
  /** 6지표 1Hz 링버퍼(최대 300포인트 = 5분) */
  series: Record<string, number[]>;
  /** 선택 지표의 그룹 평균(절대값). null = 표본 부족 */
  average?: number | null;
}

const WINDOW_POINTS = 300; // 1Hz × 300초 = 5분
const CHART_W = 300;
const CHART_H = 90;
const PAD_X = 2;

export function MemberTrendGraph({
  metrics,
  selected,
  onSelect,
  series,
  average = null,
}: MemberTrendGraphProps) {
  const metric = metrics.find((m) => m.key === selected) ?? metrics[0];
  const data = series[selected] ?? [];

  const points = useMemo(() => {
    if (!metric || data.length < 2) return [];
    const windowData = data.slice(-WINDOW_POINTS);
    const span = metric.max - metric.min || 1;
    const innerW = CHART_W - PAD_X * 2;
    const n = windowData.length;
    const stepX = n > 1 ? innerW / (n - 1) : 0;
    return windowData.map((v, i) => {
      const clamped = Math.min(metric.max, Math.max(metric.min, v));
      const x = PAD_X + i * stepX;
      const y = CHART_H - ((clamped - metric.min) / span) * CHART_H;
      return { x, y };
    });
  }, [data, metric]);

  const last = data.length ? data[data.length - 1] : null;

  const avgY =
    metric && average !== null && Number.isFinite(average)
      ? CHART_H -
        ((Math.min(metric.max, Math.max(metric.min, average)) - metric.min) /
          (metric.max - metric.min || 1)) *
          CHART_H
      : null;

  const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const area =
    points.length >= 2
      ? `M ${points[0].x.toFixed(2)} ${CHART_H} ` +
        points.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') +
        ` L ${points[points.length - 1].x.toFixed(2)} ${CHART_H} Z`
      : '';

  return (
    <div className="member-trend">
      <div className="member-trend-head">
        <span className="member-trend-title">지난 5분 추이</span>
        {metric && last !== null && (
          <span className="member-trend-current">
            지금 <b>{Math.round(last)}</b>
            <small>{metric.unit}</small>
          </span>
        )}
      </div>

      <div className="member-trend-selector" role="tablist" aria-label="추이 지표 선택">
        {metrics.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={m.key === selected}
            className={m.key === selected ? 'is-active' : undefined}
            onClick={() => onSelect(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="member-trend-chart">
        {points.length < 2 ? (
          <p className="member-trend-empty">데이터를 모으는 중입니다 · 잠시 후 표시돼요</p>
        ) : (
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            role="img"
            aria-label={`${metric.label} 지난 5분 추이`}
          >
            <defs>
              <linearGradient id="member-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A16BBC" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#5F0080" stopOpacity="0" />
              </linearGradient>
            </defs>
            {avgY !== null && (
              <line x1="0" x2={CHART_W} y1={avgY} y2={avgY} className="member-trend-average" />
            )}
            {area && <path d={area} fill="url(#member-trend-fill)" />}
            <polyline points={line} className="member-trend-line" />
          </svg>
        )}
        <div className="member-trend-axis" aria-hidden="true">
          <span>5분 전</span>
          <span>지금</span>
        </div>
      </div>
    </div>
  );
}
