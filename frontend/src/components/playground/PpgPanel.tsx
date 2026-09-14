/** P6 — PPG 파형 + HRV 패널. */

import { useCallback, useState } from 'react';
import type { BandPpgWaveform } from '../../types/playground';
import { StrokeIcon } from '../layout/SidebarNav';
import { CHART_COLORS } from './chart-theme';
import { ValueCard } from './MetricGauge';
import { PanelShell } from './PanelShell';
import { WaveformCanvas, type WaveformSeries } from './WaveformCanvas';

const SERIES: WaveformSeries[] = [{ id: 'ir', color: CHART_COLORS.pink, label: 'PPG IR' }];
const ICON_PLAY = ['M5 3l14 9-14 9V3z'];
const ICON_PAUSE = ['M6 4h4v16H6z', 'M14 4h4v16h-4z'];

interface Props {
  connected: boolean;
  ppgWaveform: BandPpgWaveform;
  getSamples: () => BandPpgWaveform;
  heartRate: number | null;
  sdnn: number | null;
  rmssd: number | null;
}

export function PpgPanel({
  connected,
  ppgWaveform,
  getSamples,
  heartRate,
  sdnn,
  rmssd,
}: Props) {
  const [paused, setPaused] = useState(false);
  const supplier = useCallback(() => {
    const s = getSamples();
    return { ir: s.ir };
  }, [getSamples]);

  const sampleCount = ppgWaveform.ir.length;
  const pending = !connected || sampleCount < 50;
  const panelState = !connected ? 'disconnected' : pending ? 'waiting' : 'ready';
  const bufferPct = Math.min(100, Math.round((sampleCount / 50) * 100));

  return (
    <PanelShell
      title="P6 · PPG 파형 + HRV"
      subtitle={`최근 ${sampleCount}샘플 ≈ 4초 @50Hz`}
      state={panelState}
      actions={
        <button
          type="button"
          onClick={() => setPaused((v) => !v)}
          aria-label={paused ? '재개' : '일시정지'}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-100"
        >
          <StrokeIcon d={paused ? ICON_PLAY : ICON_PAUSE} size={14} />
        </button>
      }
    >
      <WaveformCanvas series={SERIES} supplier={supplier} size="md" paused={paused} stacked={false} />

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
        <div
          className={[
            'h-full rounded-full bg-emerald-400 transition-all',
            bufferPct >= 100
              ? 'w-full'
              : bufferPct >= 75
                ? 'w-3/4'
                : bufferPct >= 50
                  ? 'w-1/2'
                  : bufferPct >= 25
                    ? 'w-1/4'
                    : 'w-0',
          ].join(' ')}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ValueCard label="심박수" value={heartRate ?? 0} unit="BPM" pending={pending || heartRate == null} />
        <ValueCard label="SDNN" value={sdnn ?? 0} unit="ms" pending={pending || !(sdnn && sdnn > 0)} />
        <ValueCard label="RMSSD" value={rmssd ?? 0} unit="ms" pending={pending || !(rmssd && rmssd > 0)} />
      </div>
    </PanelShell>
  );
}
