// SDD-125: 회원용 지표 다이얼 — 270도 아크 링 + 그룹 평균 틱 마커(라벤더) + 최근 수신 막대.
// 값은 snapshot(1Hz)을 그대로 표시(매초 실시간). 캡션은 "그룹 평균 N"(절대값) + "추이 대기"(중립).
// 델타("±N") 경쟁 표기는 금지 — 절대 그룹 평균만 노출한다.

import { useId } from 'react';

interface MemberMetricDialProps {
  label: string;
  value: number | null;
  unit: string;
  /** 표시 스케일 하한 — 게이지·틱·막대 비율 계산 (목업 정본 기준) */
  min: number;
  /** 표시 스케일 상한 */
  max: number;
  /** 최근 수신값 시계열(1Hz 링버퍼) — 막대 그래프 표시용 */
  series: readonly (number | null)[];
  /** SDD-124: 그룹 평균(표시 스케일). null = 표본 부족/미수신 */
  average?: number | null;
}

const BAR_COUNT = 12;
const BAR_W = 100;
const BAR_H = 30;

/** 270도 아크 기하학 상수 (viewBox 0 0 100 100, r=38) */
const ARC_START_DEG = 135; // 시작 각도(하단 좌)
const ARC_SPAN_DEG = 270; // 270도 스팬
const ARC_PCT = ARC_SPAN_DEG / 360; // pathLength=100 기준 아크 비율

const ratio = (v: number, min: number, max: number): number =>
  max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;

export function MemberMetricDial({
  label,
  value,
  unit,
  min,
  max,
  series,
  average = null,
}: MemberMetricDialProps) {
  const uid = useId();
  const dialGradientId = `${uid}-dial`;
  const barsGradientId = `${uid}-bars`;
  const gauge = value === null ? null : ratio(value, min, max) * 100;
  const averageGauge = average === null ? null : ratio(average, min, max) * 100;

  // 그룹 평균 틱 마커 좌표 (아크 r=38, 안팎 ±8 돌출)
  const tickAngle =
    averageGauge === null
      ? null
      : ((ARC_START_DEG + (averageGauge / 100) * ARC_SPAN_DEG) * Math.PI) / 180;

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
      <span className="player-metric-name">{label}</span>
      <span className="player-dial" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <defs>
            <linearGradient id={dialGradientId} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop stopColor="#5F0080" />
              <stop offset=".5" stopColor="#A16BBC" />
              <stop offset="1" stopColor="#D4B5E3" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="38"
            className="player-dial-track"
            pathLength={100}
            strokeDasharray={`${ARC_PCT * 100} 100`}
            transform={`rotate(${ARC_START_DEG} 50 50)`}
          />
          {gauge !== null && (
            <circle
              cx="50"
              cy="50"
              r="38"
              className="player-dial-arc"
              style={{ stroke: `url(#${dialGradientId})` }}
              pathLength={100}
              strokeDasharray={`${(gauge / 100) * ARC_PCT * 100} 100`}
              transform={`rotate(${ARC_START_DEG} 50 50)`}
            />
          )}
          {tickAngle !== null && (
            <line
              className="player-dial-average"
              x1={50 + 30 * Math.cos(tickAngle)}
              y1={50 + 30 * Math.sin(tickAngle)}
              x2={50 + 46 * Math.cos(tickAngle)}
              y2={50 + 46 * Math.sin(tickAngle)}
            />
          )}
        </svg>
        <span className="player-dial-num">
          <b>{value === null ? '—' : Math.round(value)}</b>
          {value !== null && <small>{unit}</small>}
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
              <stop stopColor="#5F0080" stopOpacity=".7" />
              <stop offset=".5" stopColor="#A16BBC" stopOpacity=".85" />
              <stop offset="1" stopColor="#D4B5E3" />
            </linearGradient>
          </defs>
          <g style={{ fill: `url(#${barsGradientId})` }}>
            {samples.map((v, i) => {
              if (v === null) return null;
              const h = Math.max(2, ratio(v, min, max) * BAR_H);
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

      <span className={`metric-caption${average === null ? ' is-empty' : ''}`}>
        <span className="caption-avg">
          그룹 평균 <b>{average === null ? '표본 부족' : Math.round(average)}</b>
        </span>
        <span className="caption-trend">추이 대기</span>
      </span>
    </article>
  );
}
