// 대기 화면 환영 2단계 페이드 — 1.0 WelcomeText 패리티
// 4초 대기 → 문구1(2초) → 문구2(2초) → 3초 후 onFinish
// prefers-reduced-motion 시 즉시 표시 후 짧게 대기

import { useEffect, useState } from 'react';

interface WelcomeTextProps {
  onFinish: () => void;
}

type WelcomePhase = 'idle' | 'line1' | 'line2' | 'done';

export function WelcomeText({ onFinish }: WelcomeTextProps) {
  const [phase, setPhase] = useState<WelcomePhase>('idle');

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      setPhase('line2');
      const doneId = window.setTimeout(() => {
        setPhase('done');
        onFinish();
      }, 800);
      return () => window.clearTimeout(doneId);
    }

    const timers: number[] = [];
    // 진입 4초 후 문구1 페이드인
    timers.push(
      window.setTimeout(() => {
        setPhase('line1');
        // 문구1 2초 후 문구2
        timers.push(
          window.setTimeout(() => {
            setPhase('line2');
            // 문구2 2초 + 3초 대기 후 완료
            timers.push(
              window.setTimeout(() => {
                setPhase('done');
                onFinish();
              }, 2000 + 3000),
            );
          }, 2000),
        );
      }, 4000),
    );

    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [onFinish]);

  const line1Visible = phase === 'line1' || phase === 'line2' || phase === 'done';
  const line2Visible = phase === 'line2' || phase === 'done';

  return (
    <div className="mx-auto max-w-2xl px-6 text-center">
      <p
        className="text-[clamp(18px,3.5vw,28px)] font-semibold leading-snug text-white transition-opacity duration-[2000ms] ease-in-out motion-reduce:transition-none"
        style={{ opacity: line1Visible ? 1 : 0 }}
      >
        마인드브리즈 명상 프로그램에 오신것을 환영합니다.
      </p>
      <p
        className="mt-3 text-[clamp(18px,3.5vw,28px)] font-semibold leading-snug text-white transition-opacity duration-[2000ms] ease-in-out motion-reduce:transition-none"
        style={{ opacity: line2Visible ? 1 : 0 }}
      >
        시작 전 LINK BAND 착용법을 안내해드릴게요.
      </p>
    </div>
  );
}
