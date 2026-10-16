// SDD-208 H1 — 지표 띠: "지금 보는 지표"를 지표명 큰 글자·지표 고유색으로 보여 준다. 그룹 평균은 띠 안에 둔다(상담사 화면만 허용, 결정 #3).
import type { CSSProperties } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import type { PlayerMetric } from '../../../../lib/class/player-case';
import './host-player.css';

interface HostMetricStripProps {
  metric: PlayerMetric;
  /** 그룹 평균 — 1:1 이면 표시하지 않는다(null) */
  average: number | null;
  showAverage: boolean;
  solo: boolean;
  rotating: boolean;
  /** 전원 미착용이면 띠를 비활성 안내로 바꾼다(C13) */
  allOff: boolean;
  onOpen: () => void;
}

const mcol = (colorVar: string): CSSProperties => ({ ['--mcol' as string]: `var(${colorVar})` });

export function HostMetricStrip({ metric, average, showAverage, solo, rotating, allOff, onOpen }: HostMetricStripProps) {
  if (allOff) {
    return (
      <button
        type="button"
        className="hp-mstrip"
        data-pz="mstrip"
        data-disabled="true"
        disabled
        aria-label="이번 수업은 밴드 없이 진행 중이에요"
        style={{ ['--mcol' as string]: 'var(--tx-mid)' } as CSSProperties}
      >
        <span className="hp-mstrip__mg" aria-hidden="true">
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 7" />
          </svg>
        </span>
        <span className="hp-mstrip__tx">
          <b className="hp-mstrip__note">이번 수업은 밴드 없이 진행 중이에요</b>
          <span className="hp-mstrip__sub">측정 없이도 수업은 그대로 진행돼요</span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="hp-mstrip"
      data-pz="mstrip"
      data-metric={metric.key}
      aria-label="지금 보는 지표 바꾸기"
      style={mcol(metric.colorVar)}
      onClick={onOpen}
    >
      <span className="hp-mstrip__mg" aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="5" />
          <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="70 100" transform="rotate(-90 20 20)" />
        </svg>
      </span>
      <span className="hp-mstrip__tx">
        <span className="hp-mstrip__top">
          <span className="hp-mstrip__lb">{solo ? '강조해서 보는 지표' : '지금 보는 지표'}</span>
          {rotating ? (
            <span className="hp-mstrip__rot">
              <RefreshCw aria-hidden="true" strokeWidth={2} />
              <span><span className="hp-mstrip__long">10초마다 </span>순환 중</span>
            </span>
          ) : null}
        </span>
        <b className="hp-mstrip__nm">
          <i />
          {metric.label}
          <small>{metric.unit}</small>
        </b>
      </span>
      {showAverage ? (
        <span className="hp-mstrip__avg">
          <small>그룹 평균</small>
          <b>{average === null ? '—' : average}</b>
        </span>
      ) : null}
      <ChevronRight className="hp-mstrip__chev" aria-hidden="true" strokeWidth={2} />
    </button>
  );
}
