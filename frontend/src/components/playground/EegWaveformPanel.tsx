/**
 * P3 — EEG 파형 패널 (Canvas 2D).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BandEegWaveform } from '../../types/playground';
import { StrokeIcon } from '../layout/SidebarNav';
import { CHART_COLORS } from './chart-theme';
import { PanelShell } from './PanelShell';
import { WaveformCanvas, type WaveformSeries } from './WaveformCanvas';

const SERIES: WaveformSeries[] = [
  { id: 'fp1', color: CHART_COLORS.primary, label: 'FP1' },
  { id: 'fp2', color: CHART_COLORS.blue, label: 'FP2' },
];

const FIXED_RANGE: [number, number] = [-200, 200];
const ICON_PLAY = ['M5 3l14 9-14 9V3z'];
const ICON_PAUSE = ['M6 4h4v16H6z', 'M14 4h4v16h-4z'];

interface Props {
  connected: boolean;
  eegWaveform: BandEegWaveform;
  getSamples: () => { fp1: number[]; fp2: number[] };
}

export function EegWaveformPanel({ connected, eegWaveform, getSamples }: Props) {
  const [paused, setPaused] = useState(false);
  const [autoScale, setAutoScale] = useState(true);
  const [stats, setStats] = useState({ samples: 0, sampleRate: 0 });

  const supplier = useCallback(() => getSamples(), [getSamples]);

  useEffect(() => {
    const id = setInterval(() => {
      const fp1 = eegWaveform.fp1;
      let rate = 0;
      if (fp1.length >= 2) {
        const span = fp1[fp1.length - 1].timestamp - fp1[0].timestamp;
        if (span > 0) rate = ((fp1.length - 1) / span) * 1000;
      }
      setStats({ samples: fp1.length, sampleRate: rate });
    }, 1000);
    return () => clearInterval(id);
  }, [eegWaveform]);

  const panelState = !connected ? 'disconnected' : stats.samples === 0 ? 'waiting' : 'ready';
  const yRange = useMemo(() => (autoScale ? undefined : FIXED_RANGE), [autoScale]);

  return (
    <PanelShell
      title="P3 · EEG 파형"
      subtitle={`최근 5초 · ${stats.samples}샘플 · ${stats.sampleRate.toFixed(1)}Hz · FILTERED`}
      state={panelState}
      actions={
        <div className="flex items-center gap-1">
          <ToggleButton active={autoScale} onClick={() => setAutoScale((v) => !v)}>
            자동 스케일
          </ToggleButton>
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? '재개' : '일시정지'}
            className="flex h-6 w-6 items-center justify-center rounded text-[#6F6F6F] hover:text-[#5F0080]"
          >
            <StrokeIcon d={paused ? ICON_PLAY : ICON_PAUSE} size={14} />
          </button>
        </div>
      }
    >
      <WaveformCanvas
        series={SERIES}
        supplier={supplier}
        yRange={yRange}
        size="lg"
        paused={paused}
        stacked
      />
      <p className="mt-2 text-[11px] text-[#6F6F6F]">
        상단 FP1 · 하단 FP2.
        {!autoScale && ` 고정 y축 ±${FIXED_RANGE[1]}μV.`}
      </p>
    </PanelShell>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-[#5F0080] text-white'
          : 'bg-[#F5EDFC] text-[#6F6F6F] hover:bg-[#EBDEF7] hover:text-[#5F0080]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
