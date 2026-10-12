/** P5 — 지표 트렌드 패널. */

import { useEffect, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BandRawIndices, TrendPoint } from '../../types/playground';
import { StrokeIcon } from '../layout/SidebarNav';
import { AXIS_TICK, CATEGORY_PALETTE, CHART_COLORS, TOOLTIP_STYLE } from './chart-theme';
import { PanelEmpty, PanelShell } from './PanelShell';
import { trendAxisOf } from './trend-metric-keys';

const METRIC_LABEL: Record<string, string> = {
  focusIndex: '집중도',
  relaxationIndex: '이완도',
  stressIndex: '스트레스',
  cognitiveLoad: '인지 부하',
  totalPower: '총 파워',
  hemisphericBalance: '좌우뇌 균형',
  emotionalStability: '정서 안정성',
  bpm: '심박수',
  rmssd: 'RMSSD',
  sdnn: 'SDNN',
};

const RANGES = [
  { label: '30초', sec: 30 },
  { label: '2분', sec: 120 },
  { label: '5분', sec: 300 },
];

const ICON_PLAY = ['M5 3l14 9-14 9V3z'];
const ICON_PAUSE = ['M6 4h4v16H6z', 'M14 4h4v16h-4z'];
const ICON_RESET = ['M1 4v6h6', 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10'];
const MAX_POINTS = 300;

interface Props {
  connected: boolean;
  selectedMetrics: string[];
  rawIndices: BandRawIndices | null;
  heartRate: number | null;
  sdnn: number | null;
  rmssd: number | null;
}

export function TrendPanel({
  connected,
  selectedMetrics,
  rawIndices,
  heartRate,
  sdnn,
  rmssd,
}: Props) {
  const [paused, setPaused] = useState(false);
  const [rangeSec, setRangeSec] = useState(120);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const startedAtRef = useRef<number | null>(null);

  // setInterval 클로저가 stale 값을 읽지 않도록 최신 prop을 ref로 유지한다.
  // (의존성 배열에 rawIndices 등을 넣으면 지표 갱신마다 interval이 재생성되어 점이 안 쌓임)
  const rawIndicesRef = useRef(rawIndices);
  const heartRateRef = useRef(heartRate);
  const sdnnRef = useRef(sdnn);
  const rmssdRef = useRef(rmssd);
  rawIndicesRef.current = rawIndices;
  heartRateRef.current = heartRate;
  sdnnRef.current = sdnn;
  rmssdRef.current = rmssd;

  useEffect(() => {
    if (!connected) {
      startedAtRef.current = null;
      return undefined;
    }
    if (!startedAtRef.current) startedAtRef.current = Date.now();

    const id = setInterval(() => {
      if (paused || !startedAtRef.current) return;
      const t = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const next: TrendPoint = {
        t,
        focusIndex: rawIndicesRef.current?.focusIndex ?? 0,
        relaxationIndex: rawIndicesRef.current?.relaxationIndex ?? 0,
        stressIndex: rawIndicesRef.current?.stressIndex ?? 0,
        cognitiveLoad: rawIndicesRef.current?.cognitiveLoad ?? 0,
        totalPower: rawIndicesRef.current?.totalNeuralActivity ?? 0,
        hemisphericBalance: rawIndicesRef.current?.hemisphericBalance ?? 0,
        emotionalStability: rawIndicesRef.current?.emotionalStability ?? 0,
        bpm: heartRateRef.current ?? 0,
        sdnn: sdnnRef.current ?? 0,
        rmssd: rmssdRef.current ?? 0,
      };
      setPoints((prev) => {
        const merged = [...prev, next];
        return merged.length > MAX_POINTS ? merged.slice(merged.length - MAX_POINTS) : merged;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [connected, paused]);

  const reset = () => {
    setPoints([]);
    startedAtRef.current = connected ? Date.now() : null;
  };

  const visible = points.slice(-rangeSec);
  const hasPpg = selectedMetrics.some((k) => trendAxisOf(k) === 'ppg');
  const panelState = !connected ? 'disconnected' : visible.length === 0 ? 'waiting' : 'ready';

  return (
    <PanelShell
      title="P5 · 지표 트렌드"
      subtitle={`좌축 EEG · 우축 PPG · 1Hz 누적 · ${points.length}포인트 (최대 ${MAX_POINTS})`}
      state={panelState}
      actions={
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.sec}
              type="button"
              onClick={() => setRangeSec(r.sec)}
              aria-pressed={rangeSec === r.sec}
              className={[
                'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                rangeSec === r.sec
                  ? 'bg-[#5F0080] text-white'
                  : 'bg-[#F5EDFC] text-[#6F6F6F] hover:bg-[#EBDEF7] hover:text-[#5F0080]',
              ].join(' ')}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? '재개' : '일시정지'}
            className="flex h-6 w-6 items-center justify-center rounded text-[#6F6F6F] hover:text-[#5F0080]"
          >
            <StrokeIcon d={paused ? ICON_PLAY : ICON_PAUSE} size={14} />
          </button>
          <button
            type="button"
            onClick={reset}
            aria-label="트렌드 초기화"
            className="flex h-6 w-6 items-center justify-center rounded text-[#6F6F6F] hover:text-[#5F0080]"
          >
            <StrokeIcon d={ICON_RESET} size={14} />
          </button>
        </div>
      }
    >
      {selectedMetrics.length === 0 ? (
        <PanelEmpty message="P2에서 지표 카드를 클릭해 트렌드에 추가하세요." />
      ) : visible.length === 0 ? (
        <PanelEmpty message={connected ? '데이터 누적 중…' : '밴드를 연결하세요.'} />
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visible} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
              <XAxis dataKey="t" tick={AXIS_TICK} unit="s" />
              <YAxis yAxisId="eeg" domain={[0, 100]} tick={AXIS_TICK} />
              <YAxis
                yAxisId="ppg"
                orientation="right"
                domain={['auto', 'auto']}
                tick={AXIS_TICK}
                hide={!hasPpg}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {selectedMetrics.map((key, i) => (
                <Line
                  key={key}
                  yAxisId={trendAxisOf(key)}
                  type="monotone"
                  dataKey={key}
                  name={METRIC_LABEL[key] ?? key}
                  stroke={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]}
                  dot={false}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </PanelShell>
  );
}
