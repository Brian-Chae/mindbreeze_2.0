// 대기실 BGM — 대기 중(`open`) 플랫폼이 기본 트랙을 자동 재생한다.
//
// 호스트·회원 대기실 공용. 회원은 볼륨/음소거만 조절하고(개별 설정 + localStorage 유지),
// 재생·정지는 대기실 라이프사이클이 정한다 — 컴포넌트 언마운트 시 자동 정지.
// 진행(in_progress)에서는 이 훅을 쓰지 않는다(명상 전문가가 자체 사운드를 실행).

import { useCallback, useEffect, useRef, useState } from 'react';
import { getClassAudioTracks, readStoredVolume, writeStoredVolume } from '../lib/api/class-audio';
import { createAudioEngine, type AudioEngine } from '../lib/class/audio-engine';
import {
  DEFAULT_AUDIO_VOLUME,
  clampVolume,
  type MeditationTrack,
} from '../lib/class/audio-sync';

export interface LobbyBgmState {
  track: MeditationTrack | null;
  volume: number;
  /** 브라우저 자동재생 정책으로 무음 — "소리 켜기" 안내가 필요하다 */
  blocked: boolean;
  muted: boolean;
}

export function useLobbyBgm(enabled: boolean): {
  state: LobbyBgmState;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  /** 자동재생 차단 해제 — 사용자 제스처(탭/클릭)에서 호출 */
  resume: () => void;
} {
  const [track, setTrack] = useState<MeditationTrack | null>(null);
  const [volume, setVolumeState] = useState(() => readStoredVolume());
  const [blocked, setBlocked] = useState(false);
  const engineRef = useRef<AudioEngine | null>(null);
  const lastVolumeRef = useRef(
    readStoredVolume() > 0 ? readStoredVolume() : DEFAULT_AUDIO_VOLUME,
  );

  // 기본 트랙(첫 BGM) 로드
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void getClassAudioTracks().then((list) => {
      if (cancelled) return;
      setTrack(list.find((t) => t.kind === 'bgm') ?? list[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // 엔진 수명 + 자동 재생 — 트랙이 정해지면 즉시 시작
  useEffect(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    if (!enabled || !track) return undefined;
    const engine = createAudioEngine(track);
    engineRef.current = engine;
    if (engine) {
      engine.setVolume(volume);
      engine.play(0);
      setBlocked(engine.isBlocked());
    }
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // volume 은 setVolume 액션으로 반영 — 엔진 재생성을 막기 위해 의존성 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, track]);

  const setVolume = useCallback((value: number): void => {
    const next = clampVolume(value);
    engineRef.current?.setVolume(next);
    setVolumeState(next);
    writeStoredVolume(next);
    if (next > 0) lastVolumeRef.current = next;
  }, []);

  const toggleMute = useCallback((): void => {
    const current = engineRef.current?.volume() ?? volume;
    const next = current > 0 ? 0 : lastVolumeRef.current;
    engineRef.current?.setVolume(next);
    setVolumeState(next);
    writeStoredVolume(next);
  }, [volume]);

  const resume = useCallback((): void => {
    engineRef.current?.resume();
    setBlocked(engineRef.current?.isBlocked() ?? false);
  }, []);

  return {
    state: { track, volume, blocked, muted: volume === 0 },
    setVolume,
    toggleMute,
    resume,
  };
}
