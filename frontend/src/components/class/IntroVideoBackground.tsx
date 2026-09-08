// waiting intro 영상 배경 — 1.0 background_intro.mp4 패리티 (SDD-029 P2)
// Welcome 페이드 완료 후 자동 재생(loop/muted/playsInline).
// 로드 실패·prefers-reduced-motion 시 렌더하지 않음(검정 폴백).

import { useEffect, useRef, useState } from 'react';

const INTRO_SRC = '/videos/intro.mp4';

interface IntroVideoBackgroundProps {
  /** Welcome 페이드 완료 후 true — 이때부터 재생 시도 */
  active: boolean;
}

export function IntroVideoBackground({ active }: IntroVideoBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = (): void => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!active || failed || reducedMotion) return undefined;
    const el = videoRef.current;
    if (!el) return undefined;

    el.muted = true;
    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // 자동재생 정책 차단 시 폴백 — 영상 없이 진행
        setFailed(true);
      });
    }
    return undefined;
  }, [active, failed, reducedMotion]);

  // Welcome 전·모션 감소·로드 실패 → 영상 미표시 (검정 베이스 유지)
  if (!active || failed || reducedMotion) {
    return null;
  }

  return (
    <video
      ref={videoRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
      src={INTRO_SRC}
      muted
      loop
      playsInline
      autoPlay
      preload="auto"
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}
