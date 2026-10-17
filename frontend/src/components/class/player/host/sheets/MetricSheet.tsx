// SDD-208 H1 — "지표 기준" 시트: 지금 보는 지표 선택(MIND·BODY) + 10초 순환 토글.
import type { CSSProperties } from 'react';
import { PLAYER_METRICS, type PlayerMetricKey } from '../../../../../lib/class/player-case';
import { HostRow, HostSection, HostSwitch } from '../HostAtoms';
import '../host-player.css';

interface MetricSheetProps {
  metric: PlayerMetricKey;
  rotate: boolean;
  onMetric: (key: PlayerMetricKey) => void;
  onRotate: (on: boolean) => void;
}

const GROUP_LABEL = { MIND: 'MIND', BODY: 'BODY' } as const;

export function MetricSheet({ metric, rotate, onMetric, onRotate }: MetricSheetProps) {
  const current = PLAYER_METRICS.find((m) => m.key === metric) ?? PLAYER_METRICS[1];
  return (
    <div className="hp-sheet">
      {(['MIND', 'BODY'] as const).map((group) => (
        <HostSection key={group} label={GROUP_LABEL[group]}>
          <div className="hp-opts" role="radiogroup" aria-label={`${group} 지표`}>
            {PLAYER_METRICS.filter((m) => m.group === group).map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                className="hp-opt"
                aria-checked={m.key === metric}
                style={{ ['--mcol' as string]: `var(${m.colorVar})` } as CSSProperties}
                onClick={() => onMetric(m.key)}
              >
                <i />
                {m.label}
                <small>{m.unit}</small>
              </button>
            ))}
          </div>
        </HostSection>
      ))}
      <HostRow
        title="10초마다 지표 순환"
        sub={rotate ? `순환 중 · 지금 ${current.label}` : '꺼짐 · 선택한 지표를 고정해요'}
        trailing={<HostSwitch checked={rotate} label="10초 순환" onChange={onRotate} />}
      />
    </div>
  );
}
