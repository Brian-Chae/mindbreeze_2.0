// 대기실 BGM 미니바 — 트랙명 + 볼륨/음소거.
// 회원에게는 재생 제어가 없다(트랙·재생은 플랫폼이 정하고, 회원은 볼륨만 조절).

import type { LobbyBgmState } from '../../hooks/useLobbyBgm';

interface LobbyBgmBarProps {
  state: LobbyBgmState;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  onResume: () => void;
}

export function LobbyBgmBar({
  state,
  onVolumeChange,
  onToggleMute,
  onResume,
}: LobbyBgmBarProps) {
  const percent = Math.round(state.volume * 100);

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
      aria-label="대기실 BGM"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-mono uppercase tracking-wider text-white/50">
            대기실 BGM
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-white">
            {state.track?.title ?? '배경음 준비 중'}
          </p>
        </div>
        {state.blocked ? (
          <button
            type="button"
            onClick={onResume}
            className="rounded-lg bg-amber-100/20 px-3 py-1.5 text-xs font-semibold text-amber-200"
          >
            소리 켜기
          </button>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#59CE9026] px-2.5 py-1 text-[12px] font-semibold text-[#2F9E68]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2F9E68]" />
            재생 중
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={state.muted ? '음소거 해제' : '음소거'}
          aria-pressed={state.muted}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3A3A3A] text-base text-white/70 transition hover:bg-white/10"
        >
          {state.muted ? '🔇' : '🔊'}
        </button>
        <input
          type="range"
          aria-label="BGM 볼륨"
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-[#5F0080]"
        />
        <span className="w-12 text-right font-mono text-xs tabular-nums text-white/60">
          {state.muted ? '음소거' : `${percent}%`}
        </span>
      </div>
    </section>
  );
}
