// 게스트 명상 화면 — 1.0 디자인 패리티 (SDD-029 P0)
// 검정 풀블리드 + FadingImageBackground + clamp 초대형 수치 + BlinkingText + BrainChart
// 데이터 계약(useBand/WS)은 SDD-024/026 유지 — 표현층만 교체

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBand } from '../../hooks/useBand';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import {
  contactStatusLabel,
  resolveBandLinkState,
  signalQualityLevelLabel,
} from '../../lib/session-live/signal-status';
import type { SessionLiveEegFeatureEvent } from '../../lib/socket';
import { FadingImageBackground } from './FadingImageBackground';
import { BlinkingText } from './BlinkingText';
import { BrainChart } from './BrainChart';

interface GuestMeditationPanelProps {
  title: string | null;
  startedAt: string | null;
  durationMin: number;
  onLeave: () => void;
  sessionId: string;
  participantId: string | null;
}

/** 초 → mm:ss */
function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatEfficiency(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${Math.round(value)}`;
}

const AI_ANALYZING_MS = 15_000;

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
  const wasLeadOffRef = useRef(false);
  const analyzingTimerRef = useRef<number | null>(null);
  const targetSec = Math.max(1, durationMin) * 60;

  const band = useBand({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: true,
  });

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
        setRemoteEfficiency(efficiency);
      }
    },
    [participantId, sessionId],
  );

  useSessionLiveSocket({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: true,
    onEegFeature: handleEegFeature,
  });

  const isLive = band.connectionState === 'connected';
  const linkState = resolveBandLinkState({
    bleConnected: isLive,
    lastEegAt: band.lastEegAt,
  });
  const displayEfficiency = isLive
    ? (band.currentEfficiency ?? remoteEfficiency)
    : remoteEfficiency;
  const showEfficiency =
    band.deviceStatus !== 'lead_off' && linkState !== 'stale'
      ? displayEfficiency
      : null;

  // LeadOff 해소 → 15초 AI 분석중
  useEffect(() => {
    const isLeadOff = band.deviceStatus === 'lead_off';
    if (isLeadOff) {
      wasLeadOffRef.current = true;
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

  const chartValues = band.chartPoints.map((pt) => pt.relaxation);
  const heroNumberClass =
    'text-[clamp(64px,10vw,130px)] font-semibold leading-none text-white tabular-nums';
  const heroLabelClass =
    'text-[clamp(18px,3vw,38px)] font-semibold leading-tight text-white/60';

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

          {/* 두뇌휴식도 or AI 분석중 */}
          <div className="flex flex-col items-center text-center">
            <p className={heroLabelClass}>두뇌휴식도</p>
            {isAnalyzing ? (
              <BlinkingText className="mt-2 text-[clamp(40px,6vw,70px)] font-medium leading-none text-white">
                AI 분석중
              </BlinkingText>
            ) : (
              <p className={`mt-2 ${heroNumberClass}`}>
                {showEfficiency !== null ? (
                  <>
                    {formatEfficiency(showEfficiency)}
                    <span className="text-[0.45em]">%</span>
                  </>
                ) : (
                  '—'
                )}
              </p>
            )}
            <p className="mt-3 max-w-sm text-sm leading-6 text-white/70">
              {band.deviceStatus === 'lead_off'
                ? '접촉 불량 — LINK BAND 위치를 조정해 주세요'
                : linkState === 'stale'
                  ? '최근 뇌파 수신이 없습니다 — 연결을 확인해 주세요'
                  : isLive
                    ? 'LINK BAND에서 실시간으로 측정 중입니다'
                    : remoteEfficiency !== null
                      ? 'WebSocket으로 실시간 지표를 수신 중입니다'
                      : 'LINK BAND 연결 시 표시됩니다'}
            </p>
          </div>
        </div>

        {/* BrainChart */}
        <div className="mt-8 flex min-h-[160px] items-end justify-center md:mt-4 md:min-h-[248px]">
          {isLive && chartValues.length > 0 ? (
            <BrainChart values={chartValues} className="w-full max-w-3xl" height={200} />
          ) : (
            <p className="pb-8 text-center text-sm text-white/50">
              뇌파 차트는 LINK BAND 연결 후 표시됩니다
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
    </div>
  );
}
