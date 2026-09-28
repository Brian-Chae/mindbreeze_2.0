// 게스트 명상 화면 — 1.0 디자인 패리티 (SDD-029 P0) + SDD-040 6지표
// 검정 풀블리드 + FadingImageBackground + 상담사 라이브(상단) + 진행시간·6지표(하단)
// 데이터 계약(useBand/WS)은 SDD-024/026 유지 — 표현층만 교체
// 오프라인 수업은 스피커 기본 뮤트(하울링 방지), 온라인은 기본 ON + 스피커 온오프 토글

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
import { CounselorLiveTile } from './CounselorLiveTile';

interface GuestMeditationPanelProps {
  title: string | null;
  startedAt: string | null;
  durationMin: number;
  onLeave: () => void;
  sessionId: string;
  participantId: string | null;
  /** 클래스 코드 — 상담사 라이브 영상 구독 토큰 요청용 */
  classCode: string | null;
  /** 게스트 소유 증명 토큰 (로그인 회원은 생략) */
  participantToken?: string | null;
  /** 클래스 장소 유형 — 오프라인은 스피커 기본 뮤트(하울링 방지) */
  locationType?: 'online' | 'offline';
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

/** 스피커 아이콘 (음소거 시 X) */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" fill={muted ? 'none' : 'currentColor'} stroke="currentColor" />
      {muted ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      )}
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
  classCode,
  participantToken,
  locationType,
}: GuestMeditationPanelProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  /** 화면 끄기(몰입) 모드 — 1.0 절전 모드 패리티 */
  const [screenOff, setScreenOff] = useState(false);
  /** WS로 수신한 본인 두뇌휴식도 — 밴드 로컬값 폴백 */
  const [remoteEfficiency, setRemoteEfficiency] = useState<number | null>(null);
  /** LeadOff 해소 후 15초 "AI 분석중" */
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  /** 접촉불량 모달 — 사용자가 「무시하기」하면 닫힘 */
  const [leadOffDismissed, setLeadOffDismissed] = useState(false);
  /** 스피커 온오프 — 오프라인 기본 뮤트(하울링 방지), 온라인 기본 ON */
  const [speakerOn, setSpeakerOn] = useState(locationType === 'online');
  /** 시계열 차트로 볼 지표 */
  const [selectedKey, setSelectedKey] = useState<MetricKey>('focus');
  const wasLeadOffRef = useRef(false);
  const analyzingTimerRef = useRef<number | null>(null);
  /** 링버퍼 갱신 시 차트 리렌더 */
  const [seriesTick, setSeriesTick] = useState(0);
  const seriesRef = useRef<MetricSeries>(emptySeries());
  const bandRef = useRef<ReturnType<typeof useBand> | null>(null);
  const targetSec = Math.max(1, durationMin) * 60;

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
  const activeMetric =
    METRICS.find((m) => m.key === selectedKey) ?? METRICS[0];

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
    return [...seriesRef.current[selectedKey]];
  }, [selectedKey, seriesTick]);

  const timerNumberClass =
    'text-[clamp(40px,6vw,72px)] font-semibold leading-none text-white tabular-nums';

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
      <header className="relative z-10 flex items-center justify-between gap-2 px-4 py-4 sm:px-8">
        <button
          type="button"
          onClick={onLeave}
          className="rounded-xl bg-white/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/30"
        >
          종료
        </button>
        <h1 className="truncate px-3 text-center text-base font-medium text-[#F2F3F8] sm:text-lg">
          {title ?? '클래스'}
        </h1>
        {/* 스피커 온오프 토글 */}
        <button
          type="button"
          onClick={() => setSpeakerOn((v) => !v)}
          aria-pressed={speakerOn}
          aria-label={speakerOn ? '스피커 음소거' : '스피커 켜기'}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/20 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/30"
        >
          <SpeakerIcon muted={!speakerOn} />
          <span>{speakerOn ? '스피커' : '음소거'}</span>
        </button>
      </header>

      {/* 본문: 가운데 상단 상담사 스크린 / 하단 진행시간·지표 */}
      <div className="relative z-10 flex flex-1 flex-col items-center px-4 pb-8 sm:px-8">
        {/* 상담사 스크린 */}
        <div className="w-full max-w-4xl">
          <CounselorLiveTile
            code={classCode}
            participantId={participantId}
            participantToken={participantToken}
            speakerOn={speakerOn}
            className="aspect-video w-full"
          />
        </div>

        {/* 진행시간 */}
        <div className="mt-6 flex flex-col items-center text-center">
          <p className="text-sm font-medium text-white/60">진행시간</p>
          <p className={`mt-1 ${timerNumberClass}`} aria-live="off">
            {formatClock(elapsedSec)}
          </p>
          <p className="mt-1 text-sm text-white/50 tabular-nums">
            / {formatClock(targetSec)}
          </p>
        </div>

        {/* 6지표 실시간 그리드 */}
        <div className="mt-6 grid w-full max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {METRICS.map((m) => {
            const v = snapshot[m.key];
            const selected = selectedKey === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => setSelectedKey(m.key)}
                aria-pressed={selected}
                aria-label={`${m.label} 차트 보기`}
                className={`rounded-xl px-3 py-4 text-center transition-colors ${
                  selected
                    ? 'bg-white/20 ring-1 ring-white/40'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <p className="text-xs font-medium text-white/60">{m.label}</p>
                <p className="mt-1.5 text-2xl font-semibold leading-none tabular-nums text-white">
                  {v !== null ? (
                    <>
                      {formatMetricValue(v)}
                      <span className="ml-0.5 text-xs font-normal text-white/60">
                        {m.unit}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </p>
              </button>
            );
          })}
        </div>

        {/* 상태 힌트 / AI 분석중 */}
        <div className="mt-4 text-center">
          {isAnalyzing ? (
            <BlinkingText className="text-sm font-medium text-white">
              AI 분석중
            </BlinkingText>
          ) : (
            <p className="max-w-sm text-sm leading-6 text-white/70">{statusHint}</p>
          )}
        </div>

        {/* 선택 지표 시계열 그래프 */}
        <div className="mt-6 flex min-h-[160px] w-full max-w-3xl items-end justify-center">
          {chartValues.length > 0 ? (
            <BrainChart
              values={chartValues}
              maxValue={activeMetric.chartMax}
              className="w-full"
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

      {/* 화면 끄기(몰입) 토글 — 우하단 FAB (1.0 절전 모드 패리티) */}
      {!screenOff && (
        <button
          type="button"
          onClick={() => setScreenOff(true)}
          aria-label="화면 끄기"
          className="fixed bottom-6 right-6 z-40 rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
        >
          화면 끄기
        </button>
      )}

      {/* 화면 끄기 오버레이 — 검정 + 타이머 + 가운데 켜기 (1500ms crossfade) */}
      <div
        className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-black transition-opacity duration-[1500ms] ${
          screenOff ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!screenOff}
      >
        <p className="text-sm text-white/60 tabular-nums">{formatClock(elapsedSec)}</p>
        <button
          type="button"
          onClick={() => setScreenOff(false)}
          className="mt-6 rounded-full border border-white/30 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10"
        >
          화면 켜기
        </button>
      </div>
    </div>
  );
}
