// SDD-209 T2b — 전극 LED. 같은 매핑(deriveElectrodes)을 큰 카드(FM06c·내 밴드 시트)와 소형(FH06 회원 행)이 공유한다.
import type { LeadOffStatus } from '../../../../lib/eeg/types/eeg';
import { DEFAULT_ELECTRODE_COLORS, deriveElectrodes, type ElectrodeColors, type ElectrodeState } from '../../../../lib/class/band-step';
import { SensorTracker } from '../../SensorTracker';
import './flow-shared.css';

interface ElectrodeLedsProps {
  leadOff: LeadOffStatus | null;
  /** card = 큰 카드(SensorTracker), mini = 행 안의 작은 점 3개 */
  size?: 'card' | 'mini';
  colors?: ElectrodeColors;
}

const WORD: Record<ElectrodeState, string> = { good: '양호', bad: '실패', unknown: '미확인' };

export function ElectrodeLeds({ leadOff, size = 'card', colors = DEFAULT_ELECTRODE_COLORS }: ElectrodeLedsProps) {
  if (size === 'card') return <SensorTracker leadOff={leadOff} colors={colors} />;
  const e = deriveElectrodes(leadOff);
  const items: ReadonlyArray<readonly [string, string, ElectrodeState]> = [
    ['L', '왼쪽', e.left],
    ['기준', '기준', e.ref],
    ['R', '오른쪽', e.right],
  ];
  return (
    <span
      className="eled-mini"
      data-pz="flow-electrode-mini"
      role="img"
      aria-label={`전극 접촉: 왼쪽 ${WORD[e.left]}, 기준 ${WORD[e.ref]}, 오른쪽 ${WORD[e.right]}`}
    >
      {items.map(([short, name, state]) => (
        <span key={short} className="eled-mini__item" data-state={state} title={`${name} ${WORD[state]}`}>
          <i style={{ background: colors[state] }} aria-hidden="true" />
          <b aria-hidden="true">{short}</b>
        </span>
      ))}
    </span>
  );
}
