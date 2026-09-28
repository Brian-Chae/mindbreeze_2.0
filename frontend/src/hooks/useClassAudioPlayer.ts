// 개선 10: 상담사(호스트) 재생 플레이어 훅 — 명상 가이드·BGM 을 트는 원본.
//
// 역할
// 1) 트랙 카탈로그(GET /class/audio-tracks)에서 가이드·BGM 선택.
// 2) 로컬 재생(엔진) + 재생/일시정지/정지/이동 컨트롤.
// 3) 모든 제어를 `class:audio_sync` 로 서버에 올려 회원 화면이 같은 소스·같은 위치로 재생.
// 4) 재생 중에는 AUDIO_SYNC_HEARTBEAT_MS 주기로 현재 위치를 다시 배포(seek)한다 —
//    늦게 입장한 회원·드리프트를 계속 수렴시킨다(근사 동기).
//
// 회원 볼륨은 서버로 보내지 않는다(개별 설정). 상담사 볼륨은 본인 모니터링용 로컬 값이다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getClassAudioTracks } from '../lib/api/class-audio';
import { createAudioEngine, type AudioEngine } from '../lib/class/audio-engine';
import {
  AUDIO_SYNC_HEARTBEAT_MS,
  DEFAULT_AUDIO_VOLUME,
  buildAudioSyncEmit,
  clampPosition,
  type AudioSyncAction,
  type AudioSyncEmit,
  type MeditationTrack,
} from '../lib/class/audio-sync';

interface UseClassAudioPlayerOptions {
  sessionId: string | null | undefined;
  /** 재생 제어 가능 상태(클래스 진행 단계)일 때만 true — 아니면 UI 만 비활성 */
  enabled: boolean;
  /** `class:audio_sync` 전송 — 미연결이면 false */
  publish: (payload: Omit<AudioSyncEmit, 'session_id'>) => boolean;
}

export interface ClassAudioPlayerState {
  tracks: MeditationTrack[];
  tracksLoading: boolean;
  selectedTrackId: string | null;
  playing: boolean;
  positionSec: number;
  durationSec: number | null;
  volume: number;
  /** 마지막 제어가 서버로 전달됐는가 — false 면 회원 화면이 못 따라온다 */
  broadcastOk: boolean;
  /** 브라우저 자동재생 정책으로 무음 상태 */
  blocked: boolean;
}

export interface ClassAudioPlayerActions {
  selectTrack: (trackId: string) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  seekTo: (sec: number) => void;
  setVolume: (value: number) => void;
  resume: () => void;
}

export function useClassAudioPlayer({
  sessionId,
  enabled,
  publish,
}: UseClassAudioPlayerOptions): {
  state: ClassAudioPlayerState;
  actions: ClassAudioPlayerActions;
} {
  const [tracks, setTracks] = useState<MeditationTrack[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [volume, setVolumeState] = useState(DEFAULT_AUDIO_VOLUME);
  const [broadcastOk, setBroadcastOk] = useState(true);
  const [blocked, setBlocked] = useState(false);

  const engineRef = useRef<AudioEngine | null>(null);

  // ── 트랙 카탈로그 ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !sessionId) return undefined;
    let cancelled = false;
    setTracksLoading(true);
    void getClassAudioTracks()
      .then((list) => {
        if (cancelled) return;
        setTracks(list);
        // 기본 트랙: 배경음을 우선 선택(가이드가 있으면 사용자가 직접 고른다)
        setSelectedTrackId((prev) => prev ?? list.find((t) => t.kind === 'bgm')?.track_id ?? list[0]?.track_id ?? null);
      })
      .finally(() => {
        if (!cancelled) setTracksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, sessionId]);

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.track_id === selectedTrackId) ?? null,
    [tracks, selectedTrackId],
  );

  // ── 엔진 수명: 선택 트랙이 바뀌면 이전 엔진을 정리한다 ────────────
  useEffect(() => {
    engineRef.current?.dispose();
    engineRef.current = selectedTrack ? createAudioEngine(selectedTrack) : null;
    engineRef.current?.setVolume(volume);
    setPlaying(false);
    setPositionSec(0);
    setBlocked(false);
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // volume 은 setVolume 액션으로 반영하므로 의존성에서 제외(엔진 재생성을 막는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrack]);

  // ── 위치 표시(1초) — 회원 패널과 같은 표기로 보여 준다 ───────────
  useEffect(() => {
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setPlaying(engine.isPlaying());
      setPositionSec(engine.positionSec());
      setBlocked(engine.isBlocked());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  /** 재생 제어를 서버에 배포하고 전달 성공 여부를 상태로 남긴다 */
  const send = useCallback(
    (action: AudioSyncAction, trackId: string | null, position: number): void => {
      if (!sessionId) return;
      const ok = publish(buildAudioSyncEmit(sessionId, action, trackId, position));
      setBroadcastOk(ok);
    },
    [sessionId, publish],
  );

  const play = useCallback((): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const startAt = engine.positionSec();
    engine.play(startAt);
    setPlaying(true);
    setPositionSec(startAt);
    setBlocked(engine.isBlocked());
    send('play', engine.track.track_id, startAt);
  }, [send]);

  const pause = useCallback((): void => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.pause();
    const at = engine.positionSec();
    setPlaying(false);
    setPositionSec(at);
    send('pause', engine.track.track_id, at);
  }, [send]);

  const stop = useCallback((): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const trackId = engine.track.track_id;
    engine.stop();
    setPlaying(false);
    setPositionSec(0);
    send('stop', trackId, 0);
  }, [send]);

  const toggle = useCallback((): void => {
    if (engineRef.current?.isPlaying()) {
      pause();
      return;
    }
    play();
  }, [pause, play]);

  const seekTo = useCallback(
    (sec: number): void => {
      const engine = engineRef.current;
      if (!engine) return;
      const next = clampPosition(sec, engine.track.duration_sec);
      engine.seek(next);
      setPositionSec(next);
      // 재생 중이면 seek, 정지 상태면 위치만 배포(회원도 멈춘 채 위치만 맞춘다)
      send('seek', engine.track.track_id, next);
    },
    [send],
  );

  const setVolume = useCallback((value: number): void => {
    engineRef.current?.setVolume(value);
    setVolumeState(engineRef.current?.volume() ?? value);
  }, []);

  const resume = useCallback((): void => {
    engineRef.current?.resume();
    setBlocked(engineRef.current?.isBlocked() ?? false);
  }, []);

  const selectTrack = useCallback((trackId: string): void => {
    setSelectedTrackId(trackId);
  }, []);

  // ── 정기 재동기(heartbeat): 재생 중에 현재 위치를 다시 배포 ───────
  useEffect(() => {
    if (!playing || !enabled) return undefined;
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine || !engine.isPlaying()) return;
      const at = engine.positionSec();
      setPositionSec(at);
      send('seek', engine.track.track_id, at);
    }, AUDIO_SYNC_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [playing, enabled, send]);

  return {
    state: {
      tracks,
      tracksLoading,
      selectedTrackId,
      playing,
      positionSec,
      durationSec: selectedTrack?.duration_sec ?? null,
      volume,
      broadcastOk,
      blocked,
    },
    actions: { selectTrack, play, pause, toggle, stop, seekTo, setVolume, resume },
  };
}
