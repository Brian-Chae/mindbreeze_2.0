// 게스트 명상 화면 — 타이머 + 두뇌휴식도 placeholder + 차트 shell

import { useEffect, useState } from 'react';

interface GuestMeditationPanelProps {
  title: string | null;
  startedAt: string | null;
  durationMin: number;
  onLeave: () => void;
}

/** 초 → mm:ss */
function formatClock(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function GuestMeditationPanel({
  title,
  startedAt,
  durationMin,
  onLeave,
}: GuestMeditationPanelProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const targetSec = Math.max(1, durationMin) * 60;

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
          <p className="mt-4 text-6xl font-bold tracking-tight text-white sm:text-7xl">—</p>
          <p className="mt-4 text-sm leading-6 text-purple-100">
            LINK BAND 연결 시 표시됩니다
          </p>

          {/* 차트 placeholder — EEG 미연동 */}
          <div className="mt-8 flex h-40 items-center justify-center rounded-xl border border-dashed border-white/25 bg-white/5">
            <p className="px-4 text-center text-sm text-purple-200">
              뇌파 차트는 LINK BAND 연결 후 표시됩니다
            </p>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-white/10 p-5 backdrop-blur-sm">
            <p className="text-sm font-medium text-purple-200">밴드 상태</p>
            <ul className="mt-3 space-y-2 text-sm text-purple-50">
              <li>연결 · 미연결</li>
              <li>배터리 · —</li>
              <li>접촉 · —</li>
            </ul>
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
