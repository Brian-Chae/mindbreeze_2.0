/**
 * SDD-034 — 명상 지표 실시간 뷰.
 * 몸 3개(BPM·호흡수·HRV=SDNN) + 마음 게이지 + 효과적 휴식 + 중지 시 요약.
 * LINK BAND 없이 mockDataGenerator로 1초 tick 지표 변동.
 */

import { useEffect, useRef, useState } from 'react';
import { mockDataGenerator } from '../../lib/eeg/mockDataGenerator';
import { useMeditationSessionStore } from '../../stores/useMeditationSessionStore';
import { MetricGauge, ValueCard } from './MetricGauge';

/** 버퍼 충전 시뮬레이션(초) — 이 전에는 pending('--') */
const BUFFER_WARMUP_SEC = 3;

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

const EMPTY_LIVE: LiveMetrics = {
  heartRate: null,
  respiratoryRate: null,
  sdnn: null,
  relaxation: null,
  focus: null,
  emotional: null,
  stress: null,
};

export function PlaygroundMeditationPanel() {
  const sessionStatus = useMeditationSessionStore((s) => s.status);
  const elapsedSec = useMeditationSessionStore((s) => s.elapsedSec);
  const calmSec = useMeditationSessionStore((s) => s.calmSec);
  const generation = useMeditationSessionStore((s) => s.generation);
  const tick = useMeditationSessionStore((s) => s.tick);

  const sumsRef = useRef<ScoreSums>(emptySums());
  const prevSessionRef = useRef(sessionStatus);
  const [live, setLive] = useState<LiveMetrics>(EMPTY_LIVE);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [bufferReady, setBufferReady] = useState(false);

  useEffect(() => {
    sumsRef.current = emptySums();
    setLive(EMPTY_LIVE);
    setSummary(null);
    setBufferReady(false);
  }, [generation]);

  // running 중 1Hz: mock EEG/PPG → 지표 갱신 + tick
  useEffect(() => {
    if (sessionStatus !== 'running') return;

    const id = window.setInterval(() => {
      if (useMeditationSessionStore.getState().status !== 'running') return;

      const eeg = mockDataGenerator.generateEEGAnalysis();
      const ppg = mockDataGenerator.generatePPGAnalysis();

      const heartRate = ppg.bpm;
      const respiratoryRate = 12 + Math.random() * 8; // 12~20 회/분
      const sdnn = ppg.sdnn;
      const relaxation = eeg.relaxationIndex;
      const focus = eeg.focusIndex;
      const emotional = eeg.emotionalStability;
      const stress = eeg.stressIndex;

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
      if (session.elapsedSec + 1 >= BUFFER_WARMUP_SEC) {
        setBufferReady(true);
      }

      const calm = isCalmState(relaxation, stress);
      tick(calm);

      // 워밍업 이후만 평균 누적
      if (session.elapsedSec + 1 >= BUFFER_WARMUP_SEC) {
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

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-100">명상 지표</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          몸(PPG) · 마음(EEG) · 효과적 휴식 — mock 시뮬레이션
        </p>
      </div>

      {sessionStatus === 'idle' && (
        <p className="rounded-lg border border-dashed border-gray-700 px-4 py-8 text-center text-sm text-gray-500">
          시작 버튼을 눌러 명상 세션을 시작하세요.
        </p>
      )}

      {sessionStatus === 'stopped' && summary && (
        <div className="mb-5 rounded-lg border border-indigo-900/60 bg-indigo-950/40 px-4 py-3">
          <p className="text-xs font-medium text-indigo-300">세션 요약</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[11px] text-gray-500">평균 BPM</p>
              <p className="text-lg font-semibold tabular-nums text-gray-100">
                {formatAvg(summary.avgHeartRate)}
                <span className="ml-1 text-xs font-normal text-gray-500">bpm</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-500">평균 호흡수</p>
              <p className="text-lg font-semibold tabular-nums text-gray-100">
                {formatAvg(summary.avgRespiratoryRate, 1)}
                <span className="ml-1 text-xs font-normal text-gray-500">회/분</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-500">평균 SDNN</p>
              <p className="text-lg font-semibold tabular-nums text-gray-100">
                {formatAvg(summary.avgSdnn, 1)}
                <span className="ml-1 text-xs font-normal text-gray-500">ms</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] text-gray-500">평균 이완도</p>
              <p className="text-lg font-semibold tabular-nums text-gray-100">
                {formatAvg(summary.avgRelaxation)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            효과적 휴식 {formatMmSs(summary.calmSec)} / 경과{' '}
            {formatMmSs(summary.elapsedSec)}
          </p>
        </div>
      )}

      {showLive && (
        <>
          <div className="mb-5 rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
            <p className="text-xs font-medium text-gray-400">효과적 휴식</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gray-100">
              {formatMmSs(calmSec)}
              <span className="ml-2 text-base font-semibold text-gray-400">
                {elapsedSec > 0 ? `(${calmRatioPct.toFixed(0)}%)` : '(--%)'}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-gray-500">
              고요 구간 누적 / 세션 경과 {formatMmSs(elapsedSec)}
              {sessionStatus === 'stopped' && ' · 수집 중지'}
            </p>
          </div>

          <h4 className="mb-2 text-xs font-semibold text-gray-400">
            몸{' '}
            {bodyPending && <span className="text-amber-400">· 버퍼 충전 중</span>}
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
          <p className="mt-1 text-[10px] text-gray-500">
            호흡수 참고 12~20회/분 · HRV=SDNN(ms)
          </p>

          <h4 className="mb-2 mt-5 text-xs font-semibold text-gray-400">마음</h4>
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
        </>
      )}
    </section>
  );
}
