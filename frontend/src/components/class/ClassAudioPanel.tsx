// 개선 10: 상담사 재생 패널 — 명상 가이드·BGM 선택 + 재생/일시정지/정지/이동.
//
// 상담사가 이 패널에서 트는 소리가 기준(source of truth)이고, 모든 제어는
// `class:audio_sync` 로 서버를 거쳐 회원 화면에 같은 위치로 배포된다.
// 회원 볼륨은 서버 payload 에 없다 — 회원이 각자 조절한다(여기 볼륨은 상담사 모니터링용).

import { formatClock, formatTrackDuration } from '../../lib/class/audio-sync';
import type {
  ClassAudioPlayerActions as ClassAudioActions,
  ClassAudioPlayerState as ClassAudioPanelState,
} from '../../hooks/useClassAudioPlayer';

interface ClassAudioPanelProps {
  state: ClassAudioPanelState;
  actions: ClassAudioActions;
  /** 재생 제어 가능 상태(클래스 진행 단계) */
  enabled: boolean;
  /** 서버(WebSocket) 연결 여부 — 끊기면 회원 화면이 따라오지 못한다 */
  connected: boolean;
}

const playIcon = (playing: boolean) => (playing ? '⏸' : '▶');

export function ClassAudioPanel({ state, actions, enabled, connected }: ClassAudioPanelProps) {
  const selected = state.tracks.find((track) => track.track_id === state.selectedTrackId) ?? null;
  const hasTrack = Boolean(selected);
  const showSlider = enabled && selected !== null && selected.duration_sec !== null;
  const broadcastOk = connected && state.broadcastOk;

  return (
    <section className="rounded-2xl bg-white/5 p-4" aria-label="명상 가이드·BGM">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-mono uppercase tracking-wider text-white/50">
          대기실 BGM
        </p>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
            state.playing && broadcastOk
              ? 'bg-[#59CE9026] text-[#2F9E68]'
              : 'bg-white/10 text-white/60'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              state.playing && broadcastOk ? 'animate-pulse bg-[#2F9E68]' : 'bg-white/40'
            }`}
          />
          {state.playing
            ? broadcastOk
              ? '재생 중 · 회원 동시 재생'
              : '재생 중 · 서버 연결 끊김'
            : '정지'}
        </span>
      </div>

      {/* 트랙 선택 — 배경음/호흡 가이드 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="class-audio-track">
          가이드·BGM 트랙
        </label>
        <select
          id="class-audio-track"
          aria-label="가이드·BGM 트랙"
          value={state.selectedTrackId ?? ''}
          onChange={(event) => actions.selectTrack(event.target.value)}
          disabled={!enabled || state.tracksLoading || state.tracks.length === 0}
          className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.tracks.length === 0 && <option value="">트랙 없음</option>}
          {state.tracks.map((track) => (
            <option key={track.track_id} value={track.track_id}>
              {track.kind === 'guide' ? '가이드' : 'BGM'} · {track.title}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={actions.toggle}
          disabled={!enabled || !hasTrack}
          aria-label={state.playing ? '가이드·BGM 일시정지' : '가이드·BGM 재생'}
          className="mb-btn disabled:cursor-not-allowed"
        >
          {playIcon(state.playing)} {state.playing ? '일시정지' : '재생'}
        </button>
        <button
          type="button"
          onClick={actions.stop}
          disabled={!enabled || !hasTrack}
          className="mb-btn mb-btn--ghost !text-white/80 hover:!text-white disabled:cursor-not-allowed"
        >
          ⏹ 정지
        </button>
      </div>

      {/* 위치 표기 — 내장 톤(길이 없음)은 경과 시간만 보여 준다 */}
      <div className="mt-3 flex items-center gap-3">
        <span className="font-mono text-sm tabular-nums text-white">
          {formatClock(state.positionSec)}
        </span>
        {showSlider && selected ? (
          <input
            type="range"
            aria-label="재생 위치"
            min={0}
            max={Math.max(1, Math.floor(selected.duration_sec ?? 0))}
            step={1}
            value={Math.min(state.positionSec, Math.floor(selected.duration_sec ?? 0))}
            onChange={(event) => actions.seekTo(Number(event.target.value))}
            disabled={!enabled}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-[#5F0080] disabled:cursor-not-allowed"
          />
        ) : (
          <span className="flex-1 text-xs text-white/50">
            {hasTrack ? `길이 ${formatTrackDuration(state.durationSec)}` : '트랙을 선택하세요'}
          </span>
        )}
        {showSlider && (
          <span className="font-mono text-xs tabular-nums text-white/50">
            {formatClock(selected?.duration_sec ?? 0)}
          </span>
        )}
      </div>

      {/* 상담사 본인 모니터링 볼륨 (회원 볼륨과 별개) */}
      <div className="mt-3 flex items-center gap-3">
        <label htmlFor="class-audio-host-volume" className="text-xs text-white/60">
          모니터 볼륨
        </label>
        <input
          id="class-audio-host-volume"
          type="range"
          aria-label="모니터 볼륨"
          min={0}
          max={100}
          step={5}
          value={Math.round(state.volume * 100)}
          onChange={(event) => actions.setVolume(Number(event.target.value) / 100)}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-[#5F0080]"
        />
        <span className="w-9 text-right font-mono text-xs tabular-nums text-white/60">
          {Math.round(state.volume * 100)}%
        </span>
      </div>

      {state.blocked && (
        <button
          type="button"
          onClick={actions.resume}
          className="mt-3 rounded-lg bg-amber-100/20 px-3 py-1.5 text-xs font-semibold text-amber-200"
        >
          브라우저가 소리를 막았습니다 · 여기를 눌러 켜기
        </button>
      )}

      <p className="mt-3 text-xs leading-5 text-white/50">
        대기실에서 배경음이 자동 재생됩니다. 클래스를 시작하면 자동으로 페이드아웃되며,
        진행 중에는 플랫폼이 배경음을 재생하지 않습니다(명상 전문가 자체 사운드).
      </p>
    </section>
  );
}
