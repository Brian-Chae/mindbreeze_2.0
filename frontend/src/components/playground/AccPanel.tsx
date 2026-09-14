/** P7 — ACC 패널. */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BandAccSnapshot } from '../../types/playground';
import { AXIS_TICK, CHART_COLORS, TOOLTIP_STYLE } from './chart-theme';
import { ValueCard } from './MetricGauge';
import { PanelEmpty, PanelShell } from './PanelShell';

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

const ACTIVITY_CLASS: Record<string, string> = {
  stationary: 'text-emerald-300',
  sitting: 'text-emerald-300',
  rest: 'text-emerald-300',
  light: 'text-sky-300',
  walking: 'text-sky-300',
  moderate: 'text-amber-300',
  vigorous: 'text-red-300',
  running: 'text-red-300',
};

interface Props {
  connected: boolean;
  acc: BandAccSnapshot;
}

export function AccPanel({ connected, acc }: Props) {
  const waveform = acc.magnitudeWaveform;
  const panelState = !connected ? 'disconnected' : waveform.length === 0 ? 'waiting' : 'ready';
  const chartData = waveform.map((p, i) => ({ i, magnitude: p.value }));

  return (
    <PanelShell
      title="P7 · ACC"
      subtitle={`최근 ${waveform.length}샘플 ≈ 5초 @30Hz · 움직임 artifact 판정용`}
      state={panelState}
    >
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-xs text-gray-500">활동 상태</span>
        <span
          className={`text-lg font-bold ${ACTIVITY_CLASS[acc.activityType] ?? 'text-gray-200'}`}
        >
          {connected ? (ACTIVITY_LABEL[acc.activityType] ?? acc.activityType) : '--'}
        </span>
      </div>

      {chartData.length === 0 ? (
        <PanelEmpty message={connected ? 'ACC 분석 결과 대기 중…' : '밴드를 연결하세요.'} />
      ) : (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
              <XAxis dataKey="i" tick={AXIS_TICK} hide />
              <YAxis tick={AXIS_TICK} unit="g" width={44} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v) => [Number(v ?? 0).toFixed(4), 'magnitude (g)']}
              />
              <Area
                type="monotone"
                dataKey="magnitude"
                stroke={CHART_COLORS.warning}
                fill={CHART_COLORS.warning}
                fillOpacity={0.18}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ValueCard label="강도" value={acc.intensity} pending={!connected} />
        <ValueCard label="안정성" value={acc.stability} pending={!connected} />
        <ValueCard label="평균 움직임" value={acc.avgMovement} unit="g" pending={!connected} />
        <ValueCard label="최대 움직임" value={acc.maxMovement} unit="g" pending={!connected} />
      </div>
    </PanelShell>
  );
}
