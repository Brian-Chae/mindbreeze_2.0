/**
 * SDD-038 — 명상 지표 실시간 뷰.
 * 몸 3개(BPM·호흡수·HRV=SDNN) + 마음 게이지 + 효과적 휴식 + 중지 시 요약.
 * useBand 실제 지표 + 몸/마음 1Hz 시계열 그래프.
 */

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
import type { UseBandResult } from '../../hooks/useBand';
import { useMeditationSessionStore } from '../../stores/useMeditationSessionStore';
import { AXIS_TICK, CATEGORY_PALETTE, CHART_COLORS, TOOLTIP_STYLE } from './chart-theme';
import { MetricGauge, ValueCard } from './MetricGauge';

/** 버퍼 충전 시뮬레이션(초) — 이 전에는 pending('--') */
const BUFFER_WARMUP_SEC = 3;
const MAX_POINTS = 300;

interface MetricAccum {
  sum: number;
  n: number;
}

interface LiveMetrics {
  heartRate: number | null;
  respiratoryRate: number | null;
  sdnn: number | null;
  relaxation: number | null;
  focus: number | null;
  emotional: number | null;
  stress: number | null;
}

interface SessionSummary {
  calmSec: number;
  elapsedSec: number;
  avgHeartRate: number | null;
  avgRespiratoryRate: number | null;
  avgSdnn: number | null;
  avgRelaxation: number | null;
}

interface ScoreSums {
  heartRate: MetricAccum;
  respiratoryRate: MetricAccum;
  sdnn: MetricAccum;
  relaxation: MetricAccum;
}

interface BodyPoint {
  t: number;
  bpm: number;
  respiratoryRate: number;
  sdnn: number;
}

interface MindPoint {
  t: number;
  relaxation: number;
  focus: number;
  emotional: number;
}

interface Props {
  band: UseBandResult;
  connected: boolean;
}

function emptyAccum(): MetricAccum {
  return { sum: 0, n: 0 };
}

function emptySums(): ScoreSums {
  return {
    heartRate: emptyAccum(),
    respiratoryRate: emptyAccum(),
    sdnn: emptyAccum(),
    relaxation: emptyAccum(),
  };
}

function pushMetric(acc: MetricAccum, value: number | null): void {
  if (value === null || !Number.isFinite(value) || value <= 0) return;
  acc.sum += value;
  acc.n += 1;
}

function avgAccum(acc: MetricAccum): number | null {
  return acc.n > 0 ? acc.sum / acc.n : null;
}

function formatMmSs(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatAvg(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return digits > 0 ? value.toFixed(digits) : `${Math.round(value)}`;
}

/** 이완↑ · 스트레스↓ 이면 고요(calm) */
function isCalmState(relaxation: number | null, stress: number | null): boolean {
  if (relaxation === null || stress === null) return false;
  return relaxation >= 55 && stress <= 45;
}

function pushRing<T>(prev: T[], next: T): T[] {
  const merged = [...prev, next];
  return merged.length > MAX_POINTS ? merged.slice(merged.length - MAX_POINTS) : merged;
}

const EMPTY_LIVE: LiveMetrics = {
  heartRate: null,
  respiratoryRate: null,
  sdnn: null,
  relaxation: null,
  focus: null,
  emotional: null,
  stress: null,
};

export function PlaygroundMeditationPanel({ band, connected }: Props) {
  const sessionStatus = useMeditationSessionStore((s) => s.status);
  const elapsedSec = useMeditationSessionStore((s) => s.elapsedSec);
  const calmSec = useMeditationSessionStore((s) => s.calmSec);
  const generation = useMeditationSessionStore((s) => s.generation);
  const tick = useMeditationSessionStore((s) => s.tick);

  const sumsRef = useRef<ScoreSums>(emptySums());
  const prevSessionRef = useRef(sessionStatus);
  const bandRef = useRef(band);
  bandRef.current = band;

  const [live, setLive] = useState<LiveMetrics>(EMPTY_LIVE);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [bufferReady, setBufferReady] = useState(false);
  const [bodySeries, setBodySeries] = useState<BodyPoint[]>([]);
  const [mindSeries, setMindSeries] = useState<MindPoint[]>([]);

  useEffect(() => {
    sumsRef.current = emptySums();
    setLive(EMPTY_LIVE);
    setSummary(null);
    setBufferReady(false);
    setBodySeries([]);
    setMindSeries([]);
  }, [generation]);

  // running 중 1Hz: useBand 실제 지표 → 갱신 + tick + 시계열
  useEffect(() => {
    if (sessionStatus !== 'running') return;

    const id = window.setInterval(() => {
      if (useMeditationSessionStore.getState().status !== 'running') return;

      const b = bandRef.current;
      const heartRate = b.heartRate;
      const respiratoryRate = b.respiratoryRate;
      const sdnn = b.sdnn;
      const relaxation = b.scoredIndices?.relaxationIndex ?? null;
      const focus = b.scoredIndices?.focusIndex ?? null;
      const emotional = b.scoredIndices?.emotionalStability ?? null;
      const stress = b.scoredIndices?.stressIndex ?? null;

      const next: LiveMetrics = {
        heartRate,
        respiratoryRate,
        sdnn,
        relaxation,
        focus,
        emotional,
        stress,
      };
      setLive(next);

      const session = useMeditationSessionStore.getState();
      const t = session.elapsedSec + 1;

      setBodySeries((prev) =>
        pushRing(prev, {
          t,
          bpm: heartRate ?? 0,
          respiratoryRate: respiratoryRate ?? 0,
          sdnn: sdnn ?? 0,
        }),
      );
      setMindSeries((prev) =>
        pushRing(prev, {
          t,
          relaxation: relaxation ?? 0,
          focus: focus ?? 0,
          emotional: emotional ?? 0,
        }),
      );

      if (t >= BUFFER_WARMUP_SEC) {
        setBufferReady(true);
      }

      const calm = isCalmState(relaxation, stress);
      tick(calm);

      // 워밍업 이후만 평균 누적
      if (t >= BUFFER_WARMUP_SEC) {
        const sums = sumsRef.current;
        pushMetric(sums.heartRate, heartRate);
        pushMetric(sums.respiratoryRate, respiratoryRate);
        pushMetric(sums.sdnn, sdnn);
        pushMetric(sums.relaxation, relaxation);
      }
    }, 1000);

    return () => window.clearInterval(id);
  }, [sessionStatus, tick]);

  // running → stopped 전환 시 요약 확정
  useEffect(() => {
    const prev = prevSessionRef.current;
    prevSessionRef.current = sessionStatus;
    if (prev !== 'running' || sessionStatus !== 'stopped') return;

    const sums = sumsRef.current;
    const session = useMeditationSessionStore.getState();
    setSummary({
      calmSec: session.calmSec,
      elapsedSec: session.elapsedSec,
      avgHeartRate: avgAccum(sums.heartRate),
      avgRespiratoryRate: avgAccum(sums.respiratoryRate),
      avgSdnn: avgAccum(sums.sdnn),
      avgRelaxation: avgAccum(sums.relaxation),
    });
  }, [sessionStatus]);

  const calmRatioPct = elapsedSec > 0 ? (calmSec / elapsedSec) * 100 : 0;
  const showLive = sessionStatus === 'running' || sessionStatus === 'stopped';
  const bodyPending = !bufferReady;
  const mindPending = !bufferReady;
  const showCharts = showLive && (bodySeries.length > 0 || mindSeries.length > 0);

  return (
    <section className="rounded-2xl border border-[#EFEFEF] bg-white px-4 py-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[#1F1F1F]">명상 지표</h3>
        <p className="mt-0.5 text-xs text-[#6F6F6F]">
          몸(PPG) · 마음(EEG) · 효과적 휴식 — useBand 실제 지표
          {connected ? '' : ' · 밴드 미연결'}
        </p>
      </div>

      {sessionStatus === 'idle' && (
        <p className="rounded-xl border border-dashed border-[#DDDEE7] px-4 py-8 text-center text-sm text-[#6F6F6F]">
          시작 버튼을 눌러 명상 세션을 시작하세요.
        </p>
      )}

      {sessionStatus === 'stopped' && summary && (
        <div className="mb-5 rounded-xl border border-[#C9B0E8] bg-[#F5EDFC] px-4 py-3">
          <p className="text-xs font-medium text-[#5F0080]">세션 요약</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[11px] text-[#6F6F6F]">평균 BPM</p>
              <p className="text-lg font-semibold tabular-nums text-[#1F1F1F]">
                {formatAvg(summary.avgHeartRate)}
                <span className="ml-1 text-xs font-normal text-[#6F6F6F]">bpm</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#6F6F6F]">평균 호흡수</p>
              <p className="text-lg font-semibold tabular-nums text-[#1F1F1F]">
                {formatAvg(summary.avgRespiratoryRate, 1)}
                <span className="ml-1 text-xs font-normal text-[#6F6F6F]">회/분</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#6F6F6F]">평균 SDNN</p>
              <p className="text-lg font-semibold tabular-nums text-[#1F1F1F]">
                {formatAvg(summary.avgSdnn, 1)}
                <span className="ml-1 text-xs font-normal text-[#6F6F6F]">ms</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[#6F6F6F]">평균 이완도</p>
              <p className="text-lg font-semibold tabular-nums text-[#1F1F1F]">
                {formatAvg(summary.avgRelaxation)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-[#6F6F6F]">
            효과적 휴식 {formatMmSs(summary.calmSec)} / 경과{' '}
            {formatMmSs(summary.elapsedSec)}
          </p>
        </div>
      )}

      {showLive && (
        <>
          <div className="mb-5 rounded-xl border border-[#EFEFEF] bg-[#F8FAFC] px-4 py-3">
            <p className="text-xs font-medium text-[#5F0080]">효과적 휴식</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[#1F1F1F]">
              {formatMmSs(calmSec)}
              <span className="ml-2 text-base font-semibold text-[#6F6F6F]">
                {elapsedSec > 0 ? `(${calmRatioPct.toFixed(0)}%)` : '(--%)'}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-[#6F6F6F]">
              고요 구간 누적 / 세션 경과 {formatMmSs(elapsedSec)}
              {sessionStatus === 'stopped' && ' · 수집 중지'}
            </p>
          </div>

          <h4 className="mb-2 text-xs font-semibold text-[#5F0080]">
            몸{' '}
            {bodyPending && <span className="text-[#8A6B1F]">· 버퍼 충전 중</span>}
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <ValueCard
              label="BPM"
              value={live.heartRate ?? 0}
              unit="bpm"
              pending={bodyPending || live.heartRate === null}
            />
            <ValueCard
              label="호흡수"
              value={live.respiratoryRate ?? 0}
              unit="회/분"
              pending={bodyPending || live.respiratoryRate === null}
            />
            <ValueCard
              label="HRV (SDNN)"
              value={live.sdnn ?? 0}
              unit="ms"
              pending={bodyPending || live.sdnn === null}
            />
          </div>
          <p className="mt-1 text-[10px] text-[#6F6F6F]">
            HRV=SDNN(ms) · useBand PPG 경로
          </p>

          <h4 className="mb-2 mt-5 text-xs font-semibold text-[#5F0080]">마음</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetricGauge
              metric={{
                key: 'relaxation',
                label: '이완도',
                unit: '',
                range: [0, 100],
                value: live.relaxation ?? 0,
              }}
              pending={mindPending || live.relaxation === null}
            />
            <MetricGauge
              metric={{
                key: 'focus',
                label: '집중도',
                unit: '',
                range: [0, 100],
                value: live.focus ?? 0,
              }}
              pending={mindPending || live.focus === null}
            />
            <MetricGauge
              metric={{
                key: 'emotional',
                label: '정서 안정도',
                unit: '',
                range: [0, 100],
                value: live.emotional ?? 0,
              }}
              pending={mindPending || live.emotional === null}
            />
          </div>

          {showCharts && (
            <div className="mt-5 space-y-4">
              <div>
                <h4 className="mb-2 text-xs font-semibold text-[#5F0080]">
                  몸 시계열{' '}
                  <span className="font-normal text-[#6F6F6F]">
                    · 1Hz · {bodySeries.length}pt (최대 {MAX_POINTS})
                  </span>
                </h4>
                <div className="h-48 rounded-xl border border-[#EFEFEF] bg-[#F8FAFC] px-2 py-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={bodySeries} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                      <XAxis dataKey="t" tick={AXIS_TICK} unit="s" />
                      <YAxis tick={AXIS_TICK} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="bpm"
                        name="BPM"
                        stroke={CATEGORY_PALETTE[0]}
                        dot={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="respiratoryRate"
                        name="호흡수"
                        stroke={CATEGORY_PALETTE[1]}
                        dot={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="sdnn"
                        name="SDNN"
                        stroke={CATEGORY_PALETTE[2]}
                        dot={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-xs font-semibold text-[#5F0080]">
                  마음 시계열{' '}
                  <span className="font-normal text-[#6F6F6F]">
                    · 0~100 · {mindSeries.length}pt (최대 {MAX_POINTS})
                  </span>
                </h4>
                <div className="h-48 rounded-xl border border-[#EFEFEF] bg-[#F8FAFC] px-2 py-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mindSeries} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                      <XAxis dataKey="t" tick={AXIS_TICK} unit="s" />
                      <YAxis tick={AXIS_TICK} domain={[0, 100]} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="relaxation"
                        name="이완도"
                        stroke={CATEGORY_PALETTE[0]}
                        dot={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="focus"
                        name="집중도"
                        stroke={CATEGORY_PALETTE[1]}
                        dot={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="emotional"
                        name="정서 안정도"
                        stroke={CATEGORY_PALETTE[2]}
                        dot={false}
                        strokeWidth={1.5}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
