// SDD-208 H1 → SDD-299 — "분석" 시트(실시간 표시 방식): 보는 지표(MIND·BODY) + 10초 순환 + 회원 정렬 + 손든 회원 우선(온라인 그룹) + 표로 보기.
import type { CSSProperties } from 'react';
import { Hand, Table2 } from 'lucide-react';
import type { HostSort } from '../../../../../lib/class/host-player-case';
import { PLAYER_METRICS, type PlayerMetricKey } from '../../../../../lib/class/player-case';
import { HostRow, HostSection, HostSwitch } from '../HostAtoms';
import '../host-player.css';

interface MetricSheetProps {
  metric: PlayerMetricKey;
  rotate: boolean;
  onMetric: (key: PlayerMetricKey) => void;
  onRotate: (on: boolean) => void;
  sort: HostSort;
  onSort: (sort: HostSort) => void;
  /** 온라인 그룹에서만 손든 회원 우선 정렬을 둔다 */
  showHandsFirst: boolean;
  handsFirst: boolean;
  onHandsFirst: (on: boolean) => void;
  table: boolean;
  onTable: (on: boolean) => void;
}

const SORTS: readonly { key: HostSort; label: string }[] = [
  { key: 'join', label: '입장순' },
  { key: 'low', label: '낮은 순' },
  { key: 'high', label: '높은 순' },
];

const GROUP_LABEL = { MIND: 'MIND', BODY: 'BODY' } as const;

export function MetricSheet({ metric, rotate, onMetric, onRotate, sort, onSort, showHandsFirst, handsFirst, onHandsFirst, table, onTable }: MetricSheetProps) {
  const current = PLAYER_METRICS.find((m) => m.key === metric) ?? PLAYER_METRICS[1];
  return (
    <div className="hp-sheet">
      {(['MIND', 'BODY'] as const).map((group) => (
        <HostSection key={group} label={`보는 지표 · ${GROUP_LABEL[group]}`}>
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
      <HostSection label="회원 정렬">
        <div className="hp-segs" role="radiogroup" aria-label="정렬">
          {SORTS.map((s) => (
            <button key={s.key} type="button" role="radio" className="hp-seg" aria-checked={sort === s.key} onClick={() => onSort(s.key)}>{s.label}</button>
          ))}
        </div>
        {showHandsFirst ? (
          <HostRow
            lead={<span className="hp-row__lead"><Hand aria-hidden="true" strokeWidth={2} /></span>}
            title="손든 회원 우선"
            sub="손든·말하는 회원을 맨 위에"
            trailing={<HostSwitch checked={handsFirst} label="손든 회원 우선" onChange={onHandsFirst} />}
          />
        ) : null}
      </HostSection>
      <HostSection label="표시 방식">
        <HostRow
          lead={<span className="hp-row__lead"><Table2 aria-hidden="true" strokeWidth={2} /></span>}
          title="표로 보기"
          sub="6개 지표를 한눈에 비교"
          trailing={<HostSwitch checked={table} label="표로 보기" onChange={onTable} />}
        />
      </HostSection>
    </div>
  );
}
