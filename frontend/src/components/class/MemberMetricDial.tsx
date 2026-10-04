// SDD-123 + SDD-124: 회원용 지표 다이얼 — 아크 링 + 그룹 평균 틱 마커 + 최근 수신 막대.
// 값은 snapshot(1Hz)을 그대로 표시(매초 실시간). 하단 배지는 "그룹 평균보다 ±N"(그룹 평균 대비 위치).

import { useId } from 'react';

interface MemberMetricDialProps {
  label: string;
  value: number | null;
  unit: string;
  /** 스케일 상한 — % 지표는 100, 비율 지표는 METRICS[].chartMax */
  maxValue: number;
  /** 최근 수신값 시계열(1Hz 링버퍼) — 막대 그래프 표시용 */
  series: readonly (number | null)[];
  /** SDD-124: 그룹 평균(표시 스케일). null = 표본 부족/미수신 */
  average?: number | null;
}

const BAR_COUNT = 12;
const BAR_W = 100;
const BAR_H = 30;

export function MemberMetricDial({
  label,
  value,
  unit,
  maxValue,
  series,
  average = null,
}: MemberMetricDialProps) {
  const uid = useId();
  const dialGradientId = `${uid}-dial`;
  const barsGradientId = `${uid}-bars`;
  const gauge = value === null ? null : Math.max(0, Math.min(100, (value / maxValue) * 100));
  const averageGauge =
    average === null ? null : Math.max(0, Math.min(100, (average / maxValue) * 100));
  const tickAngle =
    averageGauge === null ? null : ((averageGauge / 100) * 360 - 90) * (Math.PI / 180);
  const groupDelta = value !== null && average !== null ? Math.round(value - average) : null;

  const samples = series.slice(-BAR_COUNT);
  const hasSeries = samples.some((v) => v !== null);
  const slot = BAR_W / BAR_COUNT;
  const barW = slot * 0.55;

  return (
    <article
      className="player-metric"
      aria-label={`${label} ${value === null ? '미측정' : `${Math.round(value)} ${unit}`}${
        average !== null ? `, 그룹 평균 ${Math.round(average)}` : ''
      }`}
    >
      <span className="player-dial" aria-hidden="true">
        <svg viewBox="0 0 120 120">
          <defs>
            <linearGradient id={dialGradientId} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop stopColor="#5F0080" />
              <stop offset=".45" stopColor="#A16BBC" />
              <stop offset="1" stopColor="#D4B5E3" />
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="51" className="player-dial-track" />
          {gauge !== null && (
            <circle
              cx="60"
              cy="60"
              r="51"
              className="player-dial-arc"
              style={{ stroke: `url(#${dialGradientId})` }}
              pathLength="100"
              strokeDasharray={`${gauge} 100`}
              transform="rotate(-90 60 60)"
            />
          )}
          {tickAngle !== null && (
            <line
              className="player-dial-average"
              x1={60 + 43 * Math.cos(tickAngle)}
              y1={60 + 43 * Math.sin(tickAngle)}
              x2={60 + 56 * Math.cos(tickAngle)}
              y2={60 + 56 * Math.sin(tickAngle)}
            />
          )}
        </svg>
        <span className="player-dial-num">
          <b>{value === null ? '—' : Math.round(value)}</b>
          {value !== null && <small>{unit}</small>}
          {average !== null && <em className="player-dial-avg">그룹 {Math.round(average)}</em>}
        </span>
      </span>

      {hasSeries && (
        <svg
          className="player-mini-bars"
          viewBox={`0 0 ${BAR_W} ${BAR_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={barsGradientId} gradientUnits="userSpaceOnUse" x1="0" y1={BAR_H} x2="0" y2="0">
              <stop stopColor="#5F0080" stopOpacity=".55" />
              <stop offset=".5" stopColor="#A16BBC" stopOpacity=".8" />
              <stop offset="1" stopColor="#D4B5E3" />
            </linearGradient>
          </defs>
          <g style={{ fill: `url(#${barsGradientId})` }}>
            {samples.map((v, i) => {
              if (v === null) return null;
              const h = Math.max(2, (Math.min(v, maxValue) / maxValue) * BAR_H);
              return (
                <rect
                  key={i}
                  x={i * slot + (slot - barW) / 2}
                  y={BAR_H - h}
                  width={barW}
                  height={h}
                  rx={2}
                />
              );
            })}
          </g>
        </svg>
      )}

      <span className="player-metric-name">{label}</span>
      <span className={`player-average${groupDelta === null ? ' is-empty' : ''}`}>
        {groupDelta === null
          ? '그룹 평균 표본 부족'
          : groupDelta === 0
            ? '그룹 평균과 같음'
            : `그룹 평균보다 ${groupDelta > 0 ? '+' : ''}${groupDelta}`}
      </span>
    </article>
  );
}
