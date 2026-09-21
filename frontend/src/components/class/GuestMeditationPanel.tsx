// 게스트 명상 화면 — 1.0 디자인 패리티 (SDD-029 P0) + SDD-040 6지표 순환
// 검정 풀블리드 + FadingImageBackground + clamp 초대형 수치 + BlinkingText + BrainChart
// 데이터 계약(useBand/WS)은 SDD-024/026 유지 — 표현층만 교체

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBand } from '../../hooks/useBand';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import { useAuthStore } from '../../stores/authStore';
import {
  contactStatusLabel,
  resolveBandLinkState,
  signalQualityLevelLabel,
} from '../../lib/session-live/signal-status';
import { scoreIndices } from '../../lib/eeg/eegPersonalScore';
import type { SessionLiveEegFeatureEvent } from '../../lib/socket';
import { FadingImageBackground } from './FadingImageBackground';
import { BlinkingText } from './BlinkingText';
import { BrainChart } from './BrainChart';
import { LeadOffModal } from './LeadOffModal';

interface GuestMeditationPanelProps {
  title: string | null;
  startedAt: string | null;
  durationMin: number;
  onLeave: () => void;
  sessionId: string;
  participantId: string | null;
}

type MetricKey =
  | 'focus'
  | 'relaxation'
  | 'emotional'
  | 'bpm'
  | 'respiration'
  | 'hrv';

interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  /** BrainChart 스케일 상한 */
  chartMax: number;
}

const METRICS: readonly MetricDef[] = [
  { key: 'focus', label: '집중도', unit: '%', chartMax: 100 },
  { key: 'relaxation', label: '이완도', unit: '%', chartMax: 100 },
  { key: 'emotional', label: '정서안정도', unit: '%', chartMax: 100 },
  { key: 'bpm', label: 'BPM', unit: 'bpm', chartMax: 150 },
  { key: 'respiration', label: '호흡', unit: '회/분', chartMax: 40 },
  { key: 'hrv', label: 'HRV', unit: 'ms', chartMax: 200 },
] as const;

const ROTATE_MS = 10_000;
const MAX_POINTS = 300;
const AI_ANALYZING_MS = 15_000;

type MetricSeries = Record<MetricKey, number[]>;

function emptySeries(): MetricSeries {
  return {
    focus: [],
    relaxation: [],
    emotional: [],
    bpm: [],
    respiration: [],
    hrv: [],
  };
}

/** 초 → mm:ss */
function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** 지표 수치 표시 — null은 대시 (0 치환 금지) */
function formatMetricValue(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return '—';
  return digits > 0 ? value.toFixed(digits) : `${Math.round(value)}`;
}

function pushRingPoint(buf: number[], value: number): void {
  buf.push(value);
  if (buf.length > MAX_POINTS) {
    buf.splice(0, buf.length - MAX_POINTS);
  }
}

/** 핀 아이콘 (고정 ON = filled) */
function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={pinned ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z" />
    </svg>
  );
}

export function GuestMeditationPanel({
  title,
  startedAt,
  durationMin,
  onLeave,
  sessionId,
  participantId,
}: GuestMeditationPanelProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  /** WS로 수신한 본인 두뇌휴식도 — 밴드 로컬값 폴백 */
  const [remoteEfficiency, setRemoteEfficiency] = useState<number | null>(null);
  /** LeadOff 해소 후 15초 "AI 분석중" */
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  /** 접촉불량 모달 — 사용자가 「무시하기」하면 닫힘 */
  const [leadOffDismissed, setLeadOffDismissed] = useState(false);
  const wasLeadOffRef = useRef(false);
  const analyzingTimerRef = useRef<number | null>(null);
  const targetSec = Math.max(1, durationMin) * 60;

  /** SDD-040: 6지표 순환 index / pin */
  const [metricIndex, setMetricIndex] = useState(0);
  const [pinnedKey, setPinnedKey] = useState<MetricKey | null>(null);
  /** 링버퍼 갱신 시 차트 리렌더 */
  const [seriesTick, setSeriesTick] = useState(0);
  const seriesRef = useRef<MetricSeries>(emptySeries());
  const bandRef = useRef<ReturnType<typeof useBand> | null>(null);

  // 로그인 회원의 참가자 행은 user_id가 있어 무토큰 업로드가 403(사칭 차단)으로 거부된다.
  // 회원은 반드시 토큰으로, 비로그인 게스트만 skipAuth로 연결한다.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const band = useBand({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: !isAuthenticated,
  });
  bandRef.current = band;

  const handleEegFeature = useCallback(
    (event: SessionLiveEegFeatureEvent) => {
      if (!participantId || event.participant_id !== participantId) return;
      if (event.session_id && event.session_id !== sessionId) return;
      const efficiency =
        event.current_efficiency ??
        event.relaxation_index ??
        event.feature?.relaxation_index ??
        null;
      if (typeof efficiency === 'number') {
        // feature 계약은 raw 비율(0~1) — 표시 전 표준모델/코호트 정규화(0~100)
        setRemoteEfficiency(scoreIndices({ relaxationIndex: efficiency }).relaxationIndex);
      }
    },
    [participantId, sessionId],
  );

  useSessionLiveSocket({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: !isAuthenticated,
    onEegFeature: handleEegFeature,
  });

  const isLive = band.connectionState === 'connected';
  const linkState = resolveBandLinkState({
    bleConnected: isLive,
    lastEegAt: band.lastEegAt,
  });
  const metricsBlocked =
    band.deviceStatus === 'lead_off' || linkState === 'stale';

  /** 현재 시점 6지표 스냅샷 (null 보존) */
  const readSnapshot = useCallback((): Record<MetricKey, number | null> => {
    const b = bandRef.current;
    if (!b || metricsBlocked) {
      return {
        focus: null,
        relaxation: remoteEfficiency,
        emotional: null,
        bpm: null,
        respiration: null,
        hrv: null,
      };
    }
    const live = b.connectionState === 'connected';
    return {
      focus: live ? (b.scoredIndices?.focusIndex ?? null) : null,
      relaxation: live
        ? (b.scoredIndices?.relaxationIndex ?? remoteEfficiency)
        : remoteEfficiency,
      emotional: live ? (b.scoredIndices?.emotionalStability ?? null) : null,
      bpm: live ? b.heartRate : null,
      respiration: live ? b.respiratoryRate : null,
      hrv: live ? b.sdnn : null,
    };
  }, [metricsBlocked, remoteEfficiency]);

  const snapshot = readSnapshot();
  const activeMetric = pinnedKey
    ? (METRICS.find((m) => m.key === pinnedKey) ?? METRICS[metricIndex])
    : METRICS[metricIndex];
  const activeValue = snapshot[activeMetric.key];
  const isPinned = pinnedKey !== null;

  // 10초 자동 순환 — pin OFF일 때만
  useEffect(() => {
    if (pinnedKey !== null) return;
    const id = window.setInterval(() => {
      setMetricIndex((prev) => (prev + 1) % METRICS.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [pinnedKey]);

  // 1Hz 링버퍼 — 6지표 시계열
  useEffect(() => {
    const id = window.setInterval(() => {
      const sample = readSnapshot();
      const series = seriesRef.current;
      for (const def of METRICS) {
        const v = sample[def.key];
        if (v !== null && Number.isFinite(v)) {
          pushRingPoint(series[def.key], v);
        }
      }
      setSeriesTick((t) => t + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [readSnapshot]);

  // LeadOff 해소 → 15초 AI 분석중 + 모달 재표시 준비
  useEffect(() => {
    const isLeadOff = band.deviceStatus === 'lead_off';
    if (isLeadOff) {
      wasLeadOffRef.current = true;
      setLeadOffDismissed(false);
      setIsAnalyzing(false);
      if (analyzingTimerRef.current != null) {
        window.clearTimeout(analyzingTimerRef.current);
        analyzingTimerRef.current = null;
      }
      return;
    }
    if (wasLeadOffRef.current) {
      wasLeadOffRef.current = false;
      setIsAnalyzing(true);
      if (analyzingTimerRef.current != null) {
        window.clearTimeout(analyzingTimerRef.current);
      }
      analyzingTimerRef.current = window.setTimeout(() => {
        setIsAnalyzing(false);
        analyzingTimerRef.current = null;
      }, AI_ANALYZING_MS);
    }
  }, [band.deviceStatus]);

  const showLeadOffModal = band.deviceStatus === 'lead_off' && !leadOffDismissed;

  useEffect(() => {
    return () => {
      if (analyzingTimerRef.current != null) {
        window.clearTimeout(analyzingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const startedMs = startedAt ? new Date(startedAt).getTime() : Date.now();

    const tick = (): void => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const chartValues = useMemo(() => {
    void seriesTick;
    return [...seriesRef.current[activeMetric.key]];
  }, [activeMetric.key, seriesTick]);

  const togglePin = (): void => {
    if (pinnedKey !== null) {
      setPinnedKey(null);
      return;
    }
    setPinnedKey(activeMetric.key);
    setMetricIndex(METRICS.findIndex((m) => m.key === activeMetric.key));
  };

  const selectMetric = (index: number): void => {
    setMetricIndex(index);
    if (pinnedKey !== null) {
      setPinnedKey(METRICS[index].key);
    }
  };

  const heroNumberClass =
    'text-[clamp(64px,10vw,130px)] font-semibold leading-none text-white tabular-nums';
  const heroLabelClass =
    'text-[clamp(18px,3vw,38px)] font-semibold leading-tight text-white/60';

  const statusHint =
    band.deviceStatus === 'lead_off'
      ? leadOffDismissed
        ? '접촉 불량 — 위치를 조정하거나 연결을 확인해 주세요'
        : '접촉 불량 감지'
      : linkState === 'stale'
        ? '최근 뇌파 수신이 없습니다 — 연결을 확인해 주세요'
        : isLive
          ? 'LINK BAND에서 실시간으로 측정 중입니다'
          : remoteEfficiency !== null
            ? 'WebSocket으로 실시간 지표를 수신 중입니다'
            : 'LINK BAND 연결 시 표시됩니다';

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-black text-white">
      <FadingImageBackground />

      {/* 헤더 */}
      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <button
          type="button"
          onClick={onLeave}
          className="rounded-xl bg-white/20 px-4 py-2 text-sm font-medium text-white"
        >
          종료
        </button>
        <h1 className="truncate px-3 text-center text-base font-medium text-[#F2F3F8] sm:text-lg">
          {title ?? '클래스'}
        </h1>
        <div className="w-[4.5rem]" aria-hidden="true" />
      </header>

      {/* 본문: 모바일 세로 스택 / 데스크톱 2컬럼 */}
      <div className="relative z-10 flex flex-1 flex-col px-4 pb-8 sm:px-8">
        <div className="flex flex-1 flex-col justify-center gap-10 md:grid md:grid-cols-2 md:items-center md:gap-8">
          {/* 진행시간 */}
          <div className="flex flex-col items-center text-center">
            <p className={heroLabelClass}>진행시간</p>
            <p className={`mt-2 ${heroNumberClass}`} aria-live="off">
              {formatClock(elapsedSec)}
            </p>
            <p className="mt-2 text-sm text-white/50 tabular-nums">
              / {formatClock(targetSec)}
            </p>
          </div>

          {/* SDD-040: 6지표 순환 대형 수치 */}
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-2">
              <p className={heroLabelClass}>{activeMetric.label}</p>
              <button
                type="button"
                onClick={togglePin}
                aria-pressed={isPinned}
                aria-label={isPinned ? '지표 고정 해제' : '현재 지표 고정'}
                className={`rounded-lg p-1.5 transition-colors ${
                  isPinned
                    ? 'bg-white/25 text-white'
                    : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                }`}
              >
                <PinIcon pinned={isPinned} />
              </button>
            </div>
            {isAnalyzing ? (
              <BlinkingText className="mt-2 text-[clamp(40px,6vw,70px)] font-medium leading-none text-white">
                AI 분석중
              </BlinkingText>
            ) : (
              <p className={`mt-2 ${heroNumberClass}`} aria-live="polite">
                {activeValue !== null ? (
                  <>
                    {formatMetricValue(activeValue)}
                    <span className="text-[0.45em]">{activeMetric.unit}</span>
                  </>
                ) : (
                  '—'
                )}
              </p>
            )}

            {/* 6개 dot 인디케이터 */}
            <div
              className="mt-4 flex items-center gap-2"
              role="tablist"
              aria-label="지표 선택"
            >
              {METRICS.map((m, index) => {
                const selected = activeMetric.key === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-label={m.label}
                    onClick={() => selectMetric(index)}
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      selected
                        ? 'bg-white'
                        : 'bg-white/30 hover:bg-white/50'
                    }`}
                  />
                );
              })}
            </div>

            <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">
              {statusHint}
            </p>
          </div>
        </div>

        {/* 선택 지표 시계열 그래프 */}
        <div className="mt-8 flex min-h-[160px] items-end justify-center md:mt-4 md:min-h-[248px]">
          {chartValues.length > 0 ? (
            <BrainChart
              values={chartValues}
              maxValue={activeMetric.chartMax}
              className="w-full max-w-3xl"
              height={200}
              ariaLabel={`${activeMetric.label} 실시간 차트`}
            />
          ) : (
            <p className="pb-8 text-center text-sm text-white/50">
              지표 차트는 LINK BAND 연결 후 표시됩니다
            </p>
          )}
        </div>

        {/* 밴드 연결 보조 (최소화) */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-white/60">
          <span>
            연결 ·{' '}
            {band.connectionState === 'connected'
              ? linkState === 'stale'
                ? '전송 중단'
                : '연결됨'
              : band.connectionState === 'unsupported'
                ? '브라우저 미지원'
                : band.connectionState === 'connecting'
                  ? '연결 중'
                  : '미연결'}
          </span>
          <span>
            배터리 ·{' '}
            {band.battery !== null ? `${Math.round(band.battery)}%` : '—'}
          </span>
          <span>접촉 · {contactStatusLabel(band.deviceStatus)}</span>
          <span>신호 · {signalQualityLevelLabel(band.signalQualityLevel)}</span>
          {band.connectionState !== 'connected' ? (
            <button
              type="button"
              onClick={() => void band.connect()}
              disabled={!band.isSupported || band.connectionState === 'connecting'}
              className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {band.connectionState === 'connecting'
                ? '연결 중...'
                : band.isMock
                  ? '시뮬레이션 시작'
                  : 'LINK BAND 연결'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void band.disconnect()}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/20"
            >
              연결 해제
            </button>
          )}
        </div>
        {band.error && (
          <p role="alert" className="mt-2 text-center text-xs text-red-300">
            {band.error}
          </p>
        )}
      </div>

      <LeadOffModal
        isVisible={showLeadOffModal}
        leadOff={band.leadOff}
        onDismiss={() => setLeadOffDismissed(true)}
      />
    </div>
  );
}
