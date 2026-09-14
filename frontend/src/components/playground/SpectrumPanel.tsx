/** P4 — EEG 스펙트럼 패널. */

import { memo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BandPowers } from '../../lib/eeg/types/eeg';
import type { BandPowerView, BandSpectrum } from '../../types/playground';
import { AXIS_TICK, CHART_COLORS, TOOLTIP_STYLE } from './chart-theme';
import { PanelEmpty, PanelShell } from './PanelShell';

const BAND_LABELS: Record<BandPowerView['band'], string> = {
  delta: '델타 1–4Hz',
  theta: '세타 4–8Hz',
  alpha: '알파 8–13Hz',
  beta: '베타 13–30Hz',
  gamma: '감마 30–45Hz',
};

function toBandViews(bp: BandPowers): BandPowerView[] {
  const bands: BandPowerView['band'][] = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
  const total = bands.reduce((acc, b) => acc + Math.abs(bp[b]), 0);
  return bands.map((band) => ({
    band,
    label: BAND_LABELS[band],
    power: bp[band],
    domain: 'linear-uv2',
    ratio: total > 0 ? Math.abs(bp[band]) / total : 0,
  }));
}

interface Props {
  connected: boolean;
  bandPowers: BandPowers | null;
  spectrum: BandSpectrum | null;
}

export const SpectrumPanel = memo(function SpectrumPanel({
  connected,
  bandPowers,
  spectrum,
}: Props) {
  const panelState = !connected ? 'disconnected' : bandPowers ? 'ready' : 'waiting';

  const barData = bandPowers
    ? toBandViews(bandPowers).map((v) => ({
        name: v.label,
        power: v.power,
      }))
    : [];

  const areaData = spectrum
    ? spectrum.frequencies
        .map((f, i) => ({
          freq: Number(f.toFixed(1)),
          power: ((spectrum.ch1Power[i] ?? 0) + (spectrum.ch2Power[i] ?? 0)) / 2,
        }))
        .filter((d) => d.freq >= 0.5 && d.freq <= 50)
    : [];

  return (
    <PanelShell
      title="P4 · EEG 스펙트럼"
      subtitle={
        spectrum
          ? `우세 주파수 ${spectrum.dominantFrequency.toFixed(1)}Hz · 밴드파워 도메인: 선형 μV²`
          : '밴드파워 도메인: 선형 μV²'
      }
      state={panelState}
    >
      {barData.length === 0 ? (
        <PanelEmpty message={connected ? '분석 결과 대기 중…' : '밴드를 연결하세요.'} />
      ) : (
        <>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                <XAxis dataKey="name" tick={AXIS_TICK} interval={0} />
                <YAxis tick={AXIS_TICK} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v) => [Number(v ?? 0).toFixed(3), 'μV²']}
                />
                <Bar
                  dataKey="power"
                  fill={CHART_COLORS.primary}
                  isAnimationActive={false}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {areaData.length > 0 && (
            <div className="mt-4 h-40">
              <p className="mb-1 text-xs text-[#6F6F6F]">주파수 스펙트럼 (FP1/FP2 평균)</p>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={areaData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                  <XAxis dataKey="freq" tick={AXIS_TICK} unit="Hz" />
                  <YAxis tick={AXIS_TICK} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="power"
                    stroke={CHART_COLORS.accent}
                    fill={CHART_COLORS.accent}
                    fillOpacity={0.2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </PanelShell>
  );
});
