// 녹음 제어 UI

import type { RecorderState } from '../../hooks/useAudioRecorder';

interface Props {
  state: RecorderState;
  uploadedChunks: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const STATE_LABELS: Record<RecorderState, string> = {
  idle: '대기 중',
  recording: '녹음 중',
  paused: '일시정지',
  stopped: '종료됨',
  error: '오류',
};

export function RecordingControls({ state, uploadedChunks, onStart, onPause, onResume, onStop }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-3 w-3 rounded-full ${
            state === 'recording' ? 'animate-pulse bg-red-500' : state === 'paused' ? 'bg-amber-500' : 'bg-neutral-400'
          }`}
        />
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{STATE_LABELS[state]}</span>
      </div>
      <span className="text-xs text-neutral-500 dark:text-neutral-400">청크 업로드: {uploadedChunks}</span>
      <div className="ml-auto flex gap-2">
        {state === 'idle' && (
          <button
            type="button"
            onClick={onStart}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            녹음 시작
          </button>
        )}
        {state === 'recording' && (
          <>
            <button
              type="button"
              onClick={onPause}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
            >
              일시정지
            </button>
            <button
              type="button"
              onClick={onStop}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900"
            >
              녹음 종료
            </button>
          </>
        )}
        {state === 'paused' && (
          <>
            <button
              type="button"
              onClick={onResume}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              재개
            </button>
            <button
              type="button"
              onClick={onStop}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900"
            >
              녹음 종료
            </button>
          </>
        )}
      </div>
    </div>
  );
}
