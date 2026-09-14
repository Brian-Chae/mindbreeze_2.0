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
      subtitle="정규화 전 raw indices 스냅샷 (간소화)"
      state={panelState}
    >
      <p className="mb-3 text-[11px] text-[#6F6F6F]">
        전체 정규화/캘리브레이션 플로우는 추후 이식. 현재는 실시간 raw 7지표만 표시합니다.
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
