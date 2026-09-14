/** P2 — 실시간 지표 패널. */

import type { BandAccSnapshot, BandRawIndices } from '../../types/playground';
import { MetricGauge, ValueCard } from './MetricGauge';
import { PanelShell } from './PanelShell';

interface Props {
  connected: boolean;
  rawIndices: BandRawIndices | null;
  heartRate: number | null;
  sdnn: number | null;
  rmssd: number | null;
  acc: BandAccSnapshot;
  selectedMetrics: string[];
  onToggleMetric: (key: string) => void;
}

const EEG_DEFS = [
  { key: 'focusIndex', label: '집중도', unit: '' as const, range: [0, 100] as [number, number] },
  { key: 'relaxationIndex', label: '이완도', unit: '' as const, range: [0, 100] as [number, number] },
  { key: 'stressIndex', label: '스트레스', unit: '' as const, range: [0, 100] as [number, number] },
  { key: 'totalPower', label: '총 파워', unit: '' as const, range: [0, 100] as [number, number] },
  { key: 'hemisphericBalance', label: '좌우뇌 균형', unit: '' as const, range: [0, 100] as [number, number] },
  { key: 'cognitiveLoad', label: '인지 부하', unit: '' as const, range: [0, 100] as [number, number] },
  { key: 'emotionalStability', label: '정서 안정성', unit: '' as const, range: [0, 100] as [number, number] },
];

const ACTIVITY_LABEL: Record<string, string> = {
  stationary: '정지',
  sitting: '앉음',
  rest: '휴식',
  light: '가벼운 움직임',
  walking: '걷기',
  moderate: '보통 움직임',
  vigorous: '격렬한 움직임',
  running: '달리기',
};

function eegValue(raw: BandRawIndices | null, key: string): number {
  if (!raw) return 0;
  if (key === 'totalPower') return raw.totalNeuralActivity;
  return Number(raw[key as keyof BandRawIndices] ?? 0);
}

export function MetricsPanel({
  connected,
  rawIndices,
  heartRate,
  sdnn,
  rmssd,
  acc,
  selectedMetrics,
  onToggleMetric,
}: Props) {
  const eegPending = !connected || !rawIndices;
  const panelState = !connected ? 'disconnected' : eegPending ? 'waiting' : 'ready';

  return (
    <PanelShell
      title="P2 · 실시간 지표"
      subtitle="지표 카드를 클릭하면 P5 트렌드에 추가/제거됩니다 (EEG 최대 3 · PPG 최대 2)"
      state={panelState}
    >
      <h3 className="mb-2 text-xs font-semibold text-[#5F0080]">EEG</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {EEG_DEFS.map((def) => (
          <MetricGauge
            key={def.key}
            metric={{
              key: def.key,
              label: def.label,
              unit: def.unit,
              range: def.range,
              value: eegValue(rawIndices, def.key),
            }}
            selected={selectedMetrics.includes(def.key)}
            onToggle={onToggleMetric}
            bidirectional={false}
            pending={eegPending}
          />
        ))}
      </div>

      <h3 className="mt-5 mb-2 text-xs font-semibold text-[#5F0080]">PPG</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MetricGauge
          metric={{
            key: 'bpm',
            label: '심박수',
            unit: 'BPM',
            range: [40, 180],
            value: heartRate ?? 0,
          }}
          selected={selectedMetrics.includes('bpm')}
          onToggle={onToggleMetric}
          pending={!connected || heartRate == null}
        />
        <MetricGauge
          metric={{
            key: 'sdnn',
            label: 'SDNN',
            unit: 'ms',
            range: [0, 200],
            value: sdnn ?? 0,
          }}
          selected={selectedMetrics.includes('sdnn')}
          onToggle={onToggleMetric}
          pending={!connected || !(sdnn && sdnn > 0)}
        />
        <MetricGauge
          metric={{
            key: 'rmssd',
            label: 'RMSSD',
            unit: 'ms',
            range: [0, 200],
            value: rmssd ?? 0,
          }}
          selected={selectedMetrics.includes('rmssd')}
          onToggle={onToggleMetric}
          pending={!connected || !(rmssd && rmssd > 0)}
        />
      </div>

      <h3 className="mt-5 mb-2 text-xs font-semibold text-[#5F0080]">ACC</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <ValueCard
          label="활동 상태"
          value={ACTIVITY_LABEL[acc.activityType] ?? acc.activityType}
          pending={!connected}
        />
        <ValueCard label="강도" value={acc.intensity} pending={!connected} />
        <ValueCard label="안정성" value={acc.stability} pending={!connected} />
        <ValueCard label="평균 움직임" value={acc.avgMovement} unit="g" pending={!connected} />
        <ValueCard label="최대 움직임" value={acc.maxMovement} unit="g" pending={!connected} />
      </div>
    </PanelShell>
  );
}
