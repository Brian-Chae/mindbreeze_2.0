// 개선 10: 회원(수신 단) 재생 패널 — 상담사가 트는 가이드·BGM 을 같은 위치로 재생한다.
//
// · 재생 여부·트랙·위치는 상담사(서버 타임코드)가 정한다 — 회원 화면에는 재생 버튼이 없다.
// · 볼륨만 회원별 개별 설정(개인 청취 환경). 스피커 뮤트/헤드셋과 무관하게 엔진에 적용되므로
//   오프라인 방송형(기본 뮤트)에서도 가이드·BGM 은 들린다 — 화면 끄기(몰입) 중에도 재생 유지.

import { useId, useState } from 'react';
import { formatClock, formatTrackDuration } from '../../lib/class/audio-sync';

interface GuestAudioPanelProps {
  /** 명상 1화면 전용 미니바 — 기존 패널 사용처는 유지 */
  compact?: boolean;
  /** 상담사가 선택한 트랙 제목(없으면 대기 안내) */
  trackTitle: string | null;
  playing: boolean;
  positionSec: number;
  durationSec: number | null;
  volume: number;
  onVolumeChange: (value: number) => void;
  /** 브라우저 자동재생 정책으로 무음 */
  blocked: boolean;
  onResume: () => void;
  /** 서버 재생 상태를 한 번이라도 받았는가 */
  synced: boolean;
}

export function GuestAudioPanel({
  compact = false,
  trackTitle,
  playing,
  positionSec,
  durationSec,
  volume,
  onVolumeChange,
  blocked,
  onResume,
  synced,
}: GuestAudioPanelProps) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const popupId = useId();
  const percent = Math.round(volume * 100);
  const muted = percent === 0;

  if (compact) {
    return (
      <section className="player-bgm" aria-label="가이드·BGM">
        <div className="player-bgm-title">
          <p>가이드 · BGM</p>
          <span title={trackTitle ?? undefined}>{trackTitle ?? '상담사의 재생을 기다리고 있어요'}</span>
        </div>
        {blocked ? (
          <button type="button" className="player-audio-resume" onClick={onResume}>소리 켜기</button>
        ) : (
          <span className="player-bgm-state" data-playing={playing}>
            <span aria-hidden="true" />{playing ? '동기 재생 중' : synced ? '일시정지' : '대기'}
          </span>
        )}
        <button type="button" className="player-volume-toggle" aria-label="BGM 볼륨"
          aria-expanded={volumeOpen} aria-controls={popupId} onClick={() => setVolumeOpen((open) => !open)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M11 5 6 9H2v6h4l5 4V5zM16 8a6 6 0 0 1 0 8" />
          </svg>
        </button>
        {volumeOpen && (
          <div id={popupId} className="player-volume-popup" role="group" aria-label="BGM 볼륨 조절"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setVolumeOpen(false);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.player-volume-toggle')?.focus();
              }
            }}>
            <div><span>나의 볼륨 · {muted ? '음소거' : `${percent}%`}</span>
              <button type="button" onClick={() => setVolumeOpen(false)} aria-label="볼륨 닫기">닫기</button>
            </div>
            <input type="range" aria-label="볼륨" min={0} max={100} step={5} value={percent}
              onChange={(event) => onVolumeChange(Number(event.target.value) / 100)} />
            <p>{formatClock(positionSec)}{durationSec !== null && ` / ${formatTrackDuration(durationSec)}`} · 화면을 꺼도 재생은 계속됩니다</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="w-full max-w-3xl rounded-2xl bg-white/5 px-4 py-3"
      aria-label="가이드·BGM"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-mono uppercase tracking-wider text-white/50">
            가이드 · BGM
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-white">
            {trackTitle ?? '상담사가 재생을 시작하면 함께 재생됩니다'}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
            playing ? 'bg-[#59CE9026] text-[#2F9E68]' : 'bg-white/10 text-white/60'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              playing ? 'animate-pulse bg-[#2F9E68]' : 'bg-white/40'
            }`}
          />
          {playing ? '상담사와 동기 재생 중' : synced ? '일시정지' : '대기'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs tabular-nums text-white/70">
          {formatClock(positionSec)}
          {durationSec !== null && ` / ${formatTrackDuration(durationSec)}`}
        </span>

        <label htmlFor="guest-audio-volume" className="text-xs text-white/60">
          볼륨
        </label>
        {/* 터치영역 확장 — 감싼 요소 py-3 + 슬라이더 박스 자체를 44px(h-11) 로 만든다 */}
        <div className="-my-3 flex min-w-0 flex-1 items-center py-3">
          <input
            id="guest-audio-volume"
            type="range"
            aria-label="볼륨"
            min={0}
            max={100}
            step={5}
            value={percent}
            onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
            className="mb-range h-11 min-w-0 w-full cursor-pointer"
          />
        </div>
        <span className="w-9 text-right font-mono text-xs tabular-nums text-white/60">
          {muted ? '음소거' : `${percent}%`}
        </span>
      </div>

      {blocked && (
        <button
          type="button"
          onClick={onResume}
          className="mt-2 rounded-lg bg-amber-100/20 px-3 py-1.5 text-xs font-semibold text-amber-200"
        >
          브라우저가 소리를 막았습니다 · 여기를 눌러 켜기
        </button>
      )}

      <p className="mt-2 text-[12px] leading-5 text-white/40">
        볼륨은 나만 조절됩니다. 이어폰·헤드셋 사용을 권장하며, 화면을 꺼도 재생은 계속됩니다.
      </p>
    </section>
  );
}
