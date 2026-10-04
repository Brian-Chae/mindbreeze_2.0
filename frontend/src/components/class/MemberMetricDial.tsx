// SDD-123: 회원용 지표 다이얼 — 상담사 화면(HostMetricDisplay)의 아크 링 + 최근 수신 막대를 이식.
// 값은 snapshot(1Hz)을 그대로 표시(매초 실시간). 25초 스로틀 없음.

import { useId } from 'react';

interface MemberMetricDialProps {
  label: string;
  value: number | null;
  unit: string;
  /** 0~100 스케일 상한 — % 지표는 100, 비율 지표는 METRICS[].chartMax */
  maxValue: number;
  /** 선택 지표 — 히어로(큰 다이얼) + 증감 표시 */
  hero: boolean;
  selected: boolean;
  /** 직전 1초 대비 변화량 (hero에서만 표시) */
  delta: number | null;
  /** 최근 수신값 시계열(1Hz 링버퍼) — 막대 그래프 표시용 */
  series: readonly (number | null)[];
  onClick: () => void;
}

const BAR_COUNT = 12;
const BAR_W = 100;
const BAR_H = 30;

export function MemberMetricDial({
  label,
  value,
  unit,
  maxValue,
  hero,
  selected,
  delta,
  series,
  onClick,
}: MemberMetricDialProps) {
  const uid = useId();
  const dialGradientId = `${uid}-dial`;
  const barsGradientId = `${uid}-bars`;
  const gauge = value === null ? null : Math.max(0, Math.min(100, (value / maxValue) * 100));

  const samples = series.slice(-BAR_COUNT);
  const hasSeries = samples.some((v) => v !== null);
  const slot = BAR_W / BAR_COUNT;
  const barW = slot * 0.55;

  return (
    <button
      type="button"
      className={`player-metric${selected ? ' is-selected' : ''}`}
      data-hero={hero || undefined}
      aria-pressed={selected}
      aria-label={`${label} ${value === null ? '미측정' : `${Math.round(value)} ${unit}`}`}
      onClick={onClick}
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
      {hero && delta !== null && (
        <span className="player-delta">
          {delta === 0 ? '변화 없음 · 직전 1초' : `${delta > 0 ? '+' : ''}${delta} · 직전 1초`}
        </span>
      )}
    </button>
  );
}
