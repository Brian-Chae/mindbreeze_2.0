// LINK BAND 착용 가이드 + 대기 Outro — 1.0 VideoViewModal/OutroText 패리티 (SDD-029)
// useBand는 guide↔wait 동안 동일 인스턴스로 유지 (부모에서 phase만 전환, unmount 금지)

import { useEffect, useRef, useState } from 'react';
import { useBand } from '../../hooks/useBand';
import { SensorTracker } from './SensorTracker';

export type BandGuidePhase = 'guide' | 'wait';

interface BandGuidePanelProps {
  sessionId: string;
  participantId: string | null;
  /** guide: 착용 가이드 / wait: 시작 대기(Outro) — 마운트 유지로 연결 보존 */
  phase: BandGuidePhase;
  onConfirm: () => void;
  /** wait 단계 표시용 */
  displayName?: string | null;
  classCode?: string;
  statusLabel?: string;
}

/** 센서 접촉 양호 — ch1/ch2 모두 분리(false)일 때 */
function isContactGood(leadOff: { ch1: boolean; ch2: boolean } | null): boolean {
  if (!leadOff) return false;
  return !leadOff.ch1 && !leadOff.ch2;
}

export function BandGuidePanel({
  sessionId,
  participantId,
  phase,
  onConfirm,
  displayName = null,
  classCode = '',
  statusLabel = '',
}: BandGuidePanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // GuestMeditationPanel과 동일 시그니처 — guide/wait 공용
  const band = useBand({
    sessionId,
    participantId,
    enabled: Boolean(sessionId && participantId),
    skipAuth: true,
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || phase !== 'guide') return;
    if (reducedMotion) {
      el.pause();
      el.currentTime = 0;
      return;
    }
    void el.play().catch(() => {
      // 자동재생 실패 시 정적 첫 프레임 유지
    });
  }, [reducedMotion, phase]);

  const isConnected = band.connectionState === 'connected';
  const isUnsupported = band.connectionState === 'unsupported' || !band.isSupported;
  const contactGood = isConnected && isContactGood(band.leadOff);
  // 미지원 브라우저는 밴드를 연결할 수 없으므로 가이드만 보고 진행 가능 (opt-in)
  const canConfirm = isUnsupported || contactGood;

  // —— wait(OutroText) 단계 ——
  if (phase === 'wait') {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 text-center">
        <p className="text-[clamp(18px,3.5vw,28px)] font-semibold leading-snug text-white/90">
          잠시 후 클래스가 시작되오니
          <br />
          잠시 눈을 감고 휴식을 취해보세요.
        </p>
        <p className="mt-4 text-sm leading-6 text-white/70">
          호스트가 시작할 때까지 잠시 쉬어가세요.
          현재 상태: {statusLabel}.
        </p>

        <div className="mt-10">
          <SensorTracker leadOff={band.leadOff} />
        </div>

        <div className="mt-6">
          {isUnsupported ? (
            <p className="text-sm text-white/60">
              LINK BAND 연결은 Chrome/Edge에서 접속해 주세요.
            </p>
          ) : isConnected ? (
            <p className="text-sm text-white/70">
              LINK BAND 연결됨
              {band.battery !== null ? ` · 배터리 ${Math.round(band.battery)}%` : ''}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void band.connect()}
              disabled={band.connectionState === 'connecting'}
              className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/30 disabled:opacity-50"
            >
              {band.connectionState === 'connecting'
                ? '연결 중...'
                : band.isMock
                  ? '시뮬레이션 시작'
                  : 'LINK BAND 연결'}
            </button>
          )}
        </div>

        {displayName && (
          <div className="mt-10">
            <p className="text-xl font-bold text-white/90">{displayName}</p>
          </div>
        )}

        <p className="mt-10 text-xs font-medium tracking-wide text-white/40">클래스 코드</p>
        <p className="mt-2 font-mono text-3xl font-bold tracking-[0.22em] text-white/70 sm:text-4xl">
          {classCode}
        </p>
      </div>
    );
  }

  // —— guide(VideoViewModal) 단계 ——
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 px-2 md:flex-row md:items-stretch md:gap-8">
      <div className="relative min-h-[220px] flex-[2] overflow-hidden rounded-[30px] bg-black/40 md:min-h-0">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src="/videos/band_guide.mp4"
          muted
          loop={!reducedMotion}
          playsInline
          autoPlay={!reducedMotion}
          preload="metadata"
          aria-label={
            reducedMotion
              ? 'LINK BAND 착용법 안내 (정지)'
              : 'LINK BAND 착용법 안내 영상'
          }
        />
      </div>

      <div className="flex flex-1 flex-col">
        <h2 className="text-2xl font-bold text-white">LINK BAND 착용 가이드</h2>
        <p className="mt-3 text-base leading-7 text-white/90">
          마인드브리즈의 효과와 더불어 LINK BAND 올바른 착용 방법을 안내해드려요. 동영상을 보면서
          LINK BAND를 착용해주세요.
        </p>
        <p className="mt-6 text-base leading-7 text-white/90">
          올바르게 LINK BAND를 착용했다면 모든 센서가 접촉 양호로 표시됩니다. 조정을 해도 계속
          접촉 실패로 표시된다면 조용히 손을 들어주세요.
        </p>

        <div className="mt-8">
          <SensorTracker leadOff={band.leadOff} />
        </div>

        <div className="mt-6">
          {isUnsupported ? (
            <p className="rounded-xl bg-white/10 px-4 py-3 text-sm leading-6 text-white/85">
              LINK BAND 연결은 Web Bluetooth를 지원하는 Chrome/Edge에서 접속해 주세요.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {isConnected ? (
                <>
                  <span className="rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold text-white">
                    연결됨
                    {band.battery !== null ? ` · 배터리 ${Math.round(band.battery)}%` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => void band.disconnect()}
                    className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/20"
                  >
                    연결 해제
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void band.connect()}
                  disabled={band.connectionState === 'connecting'}
                  className="rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {band.connectionState === 'connecting'
                    ? '연결 중...'
                    : band.isMock
                      ? '시뮬레이션 시작'
                      : 'LINK BAND 연결'}
                </button>
              )}
            </div>
          )}
          {band.error && (
            <p role="alert" className="mt-2 text-sm text-red-300">
              {band.error}
            </p>
          )}
        </div>

        <div className="mt-auto pt-10">
          {!canConfirm && !isUnsupported && (
            <p className="mb-3 text-center text-sm text-white/60">
              {isConnected
                ? '센서가 모두 접촉 양호일 때 확인할 수 있습니다.'
                : 'LINK BAND를 연결하고 착용한 뒤 확인해 주세요.'}
            </p>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed"
            style={canConfirm ? { background: '#5F0080' } : undefined}
          >
            LINK BAND를 착용했어요
          </button>
        </div>
      </div>
    </div>
  );
}
