/**
 * SDD-034 — 명상 시뮬레이터 컨테이너.
 * 시작/중지/리셋 세션 제어 + 명상 지표 패널.
 */

import { StrokeIcon } from '../layout/SidebarNav';
import { useMeditationSessionStore } from '../../stores/useMeditationSessionStore';
import { PlaygroundMeditationPanel } from './PlaygroundMeditationPanel';

function formatMmSs(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const STATUS_LABEL = {
  idle: '대기',
  running: '진행 중',
  stopped: '종료',
} as const;

const ICON_PLAY = ['M5 3l14 9-14 9V3z'];
const ICON_PAUSE = ['M6 4h4v16H6z', 'M14 4h4v16h-4z'];
const ICON_RESET = ['M1 4v6h6', 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10'];

export function PlaygroundMeditationSimulator() {
  const status = useMeditationSessionStore((s) => s.status);
  const elapsedSec = useMeditationSessionStore((s) => s.elapsedSec);
  const start = useMeditationSessionStore((s) => s.start);
  const stop = useMeditationSessionStore((s) => s.stop);
  const reset = useMeditationSessionStore((s) => s.reset);

  const canStart = status === 'idle' || status === 'stopped';
  const canStop = status === 'running';

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-100">명상 시뮬레이터</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              시작 → 수집 → 중지(요약) → 리셋 · SDD-034 · LINK BAND 없이 mock
            </p>
          </div>
          <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-[11px] font-medium text-gray-300">
            {STATUS_LABEL[status]}
          </span>
          <p className="tabular-nums text-sm font-semibold text-gray-100">
            {formatMmSs(elapsedSec)}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <StrokeIcon d={ICON_PLAY} size={14} />
              시작
            </button>
            <button
              type="button"
              onClick={stop}
              disabled={!canStop}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <StrokeIcon d={ICON_PAUSE} size={14} />
              중지
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-gray-100"
            >
              <StrokeIcon d={ICON_RESET} size={14} />
              리셋
            </button>
          </div>
        </div>
      </section>

      <PlaygroundMeditationPanel />
    </div>
  );
}
