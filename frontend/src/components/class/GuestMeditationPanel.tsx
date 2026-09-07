// 게스트 명상 화면 — 타이머 + useBand 실데이터(미연결 시 대기 placeholder 유지)
// SDD-024: WS eeg_feature 구독으로 본인 지표 실시간 보강 (REST EEG 폴링 없음)

import { useCallback, useEffect, useState } from 'react';
import { useBand } from '../../hooks/useBand';
import { useSessionLiveSocket } from '../../hooks/useSessionLiveSocket';
import type { SessionLiveEegFeatureEvent } from '../../lib/socket';

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

  // room join + eeg_feature 구독 (WS 미연결이어도 밴드 로컬 표시 유지)
  useSessionLiveSocket({
    sessionId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: true,
    onEegFeature: handleEegFeature,
  });

  const isLive = band.connectionState === 'connected';
  const displayEfficiency = isLive
    ? (band.currentEfficiency ?? remoteEfficiency)
    : remoteEfficiency;

  useEffect(() => {
    const startedMs = startedAt ? new Date(startedAt).getTime() : Date.now();

    const tick = (): void => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div className="min-h-[70vh] rounded-3xl bg-gradient-to-b from-[#2D1045] to-[#5F0080] p-6 text-white sm:p-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-purple-200">명상 진행 중</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
            {title ?? '클래스'}
          </h1>
        </div>
        <div className="font-mono text-lg tabular-nums text-purple-100 sm:text-xl">
          {formatClock(elapsedSec)} / {formatClock(targetSec)}
        </div>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl bg-white/10 p-6 backdrop-blur-sm sm:p-8">
          <p className="text-sm font-medium text-purple-200">두뇌휴식도</p>
          <p className="mt-4 text-6xl font-bold tracking-tight text-white sm:text-7xl">
            {displayEfficiency !== null ? formatEfficiency(displayEfficiency) : '—'}
          </p>
          <p className="mt-4 text-sm leading-6 text-purple-100">
            {isLive
              ? 'LINK BAND에서 실시간으로 측정 중입니다'
              : remoteEfficiency !== null
                ? 'WebSocket으로 실시간 지표를 수신 중입니다'
                : 'LINK BAND 연결 시 표시됩니다'}
          </p>

          {/* 뇌파 차트 — 연결 시 SVG sparkline, 미연결 시 대기 shell */}
          <div className="mt-8 flex h-40 items-center justify-center rounded-xl border border-dashed border-white/25 bg-white/5 px-4 py-3">
            {isLive && band.chartPoints.length > 0 ? (
              <svg
                className="h-full w-full text-cyan-300/80"
                viewBox={`0 0 ${Math.max(band.chartPoints.length, 1)} 100`}
                preserveAspectRatio="none"
                role="img"
                aria-label="실시간 두뇌휴식도 추이"
              >
                {band.chartPoints.map((pt, index) => {
                  const h = Math.max(4, Math.min(100, pt.relaxation));
                  return (
                    <rect
                      key={pt.t}
                      x={index}
                      y={100 - h}
                      width={0.7}
                      height={h}
                      className="fill-current"
                    />
                  );
                })}
              </svg>
            ) : (
              <p className="px-4 text-center text-sm text-purple-200">
                뇌파 차트는 LINK BAND 연결 후 표시됩니다
              </p>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-white/10 p-5 backdrop-blur-sm">
            <p className="text-sm font-medium text-purple-200">밴드 상태</p>
            <ul className="mt-3 space-y-2 text-sm text-purple-50">
              <li>
                연결 ·{' '}
                {band.connectionState === 'connected'
                  ? '연결됨'
                  : band.connectionState === 'unsupported'
                    ? '브라우저 미지원'
                    : band.connectionState === 'connecting'
                      ? '연결 중'
                      : '미연결'}
              </li>
              <li>
                배터리 ·{' '}
                {band.battery !== null ? `${Math.round(band.battery)}%` : '—'}
              </li>
              <li>
                접촉 ·{' '}
                {band.deviceStatus === 'ok'
                  ? '정상'
                  : band.deviceStatus === 'lead_off'
                    ? '불량'
                    : '—'}
              </li>
            </ul>

            {!band.isSupported && (
              <p className="mt-3 text-xs leading-5 text-amber-200">
                Web Bluetooth는 Chrome/Edge에서만 지원됩니다.
              </p>
            )}

            {band.error && (
              <p role="alert" className="mt-3 text-xs leading-5 text-red-200">
                {band.error}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {band.connectionState !== 'connected' ? (
                <button
                  type="button"
                  onClick={() => void band.connect()}
                  disabled={!band.isSupported || band.connectionState === 'connecting'}
                  className="rounded-lg bg-white/20 px-3 py-2 text-sm font-semibold text-white hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-purple-100 hover:bg-white/20"
                >
                  연결 해제
                </button>
              )}
            </div>
          </div>
          <div className="rounded-2xl bg-white/10 p-5 backdrop-blur-sm">
            <p className="text-sm font-medium text-purple-200">안내</p>
            <p className="mt-2 text-sm leading-6 text-purple-100">
              호스트가 클래스를 종료할 때까지 편안하게 호흡해 주세요.
            </p>
          </div>
        </aside>
      </div>

      <button
        type="button"
        onClick={onLeave}
        className="mt-8 text-sm font-semibold text-purple-200 underline-offset-4 hover:text-white hover:underline"
      >
        나가기
      </button>
    </div>
  );
}
