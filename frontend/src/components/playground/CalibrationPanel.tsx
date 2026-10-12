/**
 * P1.5 — 캘리브레이션 패널 (간소화).
 * haru 전체 정규화 UI 대신 rawIndices 스냅샷 표시.
 */

import type { BandRawIndices } from '../../types/playground';
import { ValueCard } from './MetricGauge';
import { PanelShell } from './PanelShell';

interface Props {
  connected: boolean;
  rawIndices: BandRawIndices | null;
}

const KEYS: Array<{ key: keyof BandRawIndices; label: string }> = [
  { key: 'focusIndex', label: '집중도' },
  { key: 'relaxationIndex', label: '이완도' },
  { key: 'stressIndex', label: '스트레스' },
  { key: 'cognitiveLoad', label: '인지 부하' },
  { key: 'emotionalStability', label: '정서 안정도' },
  { key: 'hemisphericBalance', label: '좌우뇌 균형' },
  { key: 'totalNeuralActivity', label: '신경 활동' },
];

export function CalibrationPanel({ connected, rawIndices }: Props) {
  const panelState = !connected ? 'disconnected' : rawIndices ? 'ready' : 'waiting';

  return (
    <PanelShell
      title="P1.5 · 캘리브레이션"
      subtitle="정규화 전 raw indices 스냅샷"
      state={panelState}
    >
      <p className="mb-3 text-[11px] text-[#6F6F6F]">
        아래는 정규화 전 raw 지표입니다. platform_admin은 표준 모델 관리 패널에서 baseline을 수집할 수
        있습니다.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {KEYS.map(({ key, label }) => (
          <ValueCard
            key={key}
            label={label}
            value={rawIndices?.[key] ?? 0}
            pending={!connected || !rawIndices}
          />
        ))}
      </div>
    </PanelShell>
  );
}
