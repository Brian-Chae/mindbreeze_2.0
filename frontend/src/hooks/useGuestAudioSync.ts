// 개선 10: 회원(수신 단) 동기 재생 훅 — 상담사가 트는 가이드·BGM 을 같은 위치로 재생한다.
//
// 서버가 브로드캐스트한 재생 타임코드(class:audio_sync)를 적용해
//   현재 위치 = position_sec + (서버 현재 시각 - server_ts)
// 로 정렬한다. 서버·로컬 시계가 다르므로 server_ts_ms 와 수신 시각의 차이를 표본으로 모아
// 시계 오차를 추정한다(지연 최소 표본 = 실제 오차에 가장 가까운 값).
//
// 볼륨은 회원이 각자 조절한다(개별 설정 + localStorage 유지). 스피커 뮤트/헤드셋과 무관하게
// 엔진에 직접 적용되므로, 오프라인 방송형(스피커 기본 뮤트)에서도 가이드·BGM 은 들린다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findTrack, getClassAudioTracks, readStoredVolume, writeStoredVolume } from '../lib/api/class-audio';
import { createAudioEngine, type AudioEngine } from '../lib/class/audio-engine';
import {
  DRIFT_TOLERANCE_SEC,
  clockOffsetMs,
  emptyClockSamples,
  needsResync,
  recordClockSample,
  targetPositionSec,
  type AudioSyncEvent,
  type ClockSamples,
  type MeditationTrack,
} from '../lib/class/audio-sync';

interface UseGuestAudioSyncOptions {
  sessionId: string | null | undefined;
  /** 회원 화면이 살아 있을 때만(몰입 모드에서도 마운트 유지 → 재생 지속) */
  enabled: boolean;
  /** 마지막으로 수신한 재생 타임코드(없으면 null) */
  event: AudioSyncEvent | null;
}

export interface GuestAudioSyncState {
  track: MeditationTrack | null;
  playing: boolean;
  positionSec: number;
  durationSec: number | null;
  volume: number;
  /** 브라우저 자동재생 정책으로 무음 — "소리 켜기" 안내가 필요하다 */
  blocked: boolean;
  /** 서버 재생 상태를 한 번이라도 적용했는가 */
  synced: boolean;
  /** 마지막으로 측정한 상담사 재생과의 편차(초) */
  drift: number;
}

export function useGuestAudioSync({
  sessionId,
  enabled,
  event,
}: UseGuestAudioSyncOptions): {
  state: GuestAudioSyncState;
  setVolume: (value: number) => void;
  /** 자동재생 차단 해제 — 사용자 제스처(탭/클릭)에서 호출 */
  resume: () => void;
} {
  const [tracks, setTracks] = useState<MeditationTrack[]>([]);
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [volume, setVolumeState] = useState(() => readStoredVolume());
  const [blocked, setBlocked] = useState(false);
  const [synced, setSynced] = useState(false);
  const [drift, setDrift] = useState(0);

  const engineRef = useRef<AudioEngine | null>(null);
  const clockRef = useRef<ClockSamples>(emptyClockSamples());
  /** 역순 도착 방어 — 더 큰 revision 만 적용한다 */
  const lastRevisionRef = useRef(-1);
  /** 같은 명령(revision·트랙) 재적용 방지 키 */
  const appliedKeyRef = useRef<string | null>(null);
  /** 마지막으로 적용한 명령(정기 재동기 기준) */
  const lastEventRef = useRef<AudioSyncEvent | null>(null);

  // ── 트랙 카탈로그(무인증) — 상담사와 같은 소스를 받는다 ───────────
  useEffect(() => {
    if (!enabled || !sessionId) return undefined;
    let cancelled = false;
    void getClassAudioTracks().then((list) => {
      if (!cancelled) setTracks(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, sessionId]);

  const track = useMemo(() => findTrack(tracks, event?.track_id ?? null), [tracks, event]);

  // ── 엔진 수명: 트랙이 정해지면 생성, 바뀌면 교체 ─────────────────
  useEffect(() => {
    engineRef.current?.dispose();
    engineRef.current = track ? createAudioEngine(track) : null;
    setPlaying(false);
    setPositionSec(0);
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [track]);

  // 볼륨은 엔진과 분리해 반영한다 — 볼륨 변경이 엔진을 다시 만들지 않게 한다
  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume, track]);

  /** 수신한 타임코드를 현재 시점 기준 위치로 환산한다(시계 오차 표본 누적 포함) */
  const applyEvent = useCallback((next: AudioSyncEvent): number => {
    clockRef.current = recordClockSample(clockRef.current, next, Date.now());
    const offset = clockOffsetMs(clockRef.current);
    return targetPositionSec(next, Date.now(), offset);
  }, []);

  // ── 재생 상태 적용 ───────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !event) return;
    // 역순 도착(네트워크 재정렬)은 무시 — 최신 명령만 반영한다
    if (event.revision > 0 && event.revision < lastRevisionRef.current) return;
    const engine = engineRef.current;
    if (!engine) return; // 트랙 미해석(카탈로그 로드 전) — track 확정 후 이 effect 가 다시 실행된다

    // 같은 명령(같은 revision·트랙)을 두 번 적용하지 않는다 — 불필요한 재시킹 방지
    const applyKey = `${event.revision}:${event.track_id ?? ''}:${engine.track.track_id}`;
    if (appliedKeyRef.current === applyKey) return;
    appliedKeyRef.current = applyKey;
    if (event.revision > 0) lastRevisionRef.current = event.revision;
    lastEventRef.current = event;

    const target = applyEvent(event);
    switch (event.action) {
      case 'play': {
        // 이미 같은 위치로 재생 중이면 재시작하지 않는다(불필요한 끊김 방지)
        if (!(engine.isPlaying() && !needsResync(engine.positionSec(), target))) {
          engine.play(target);
        }
        setPlaying(true);
        break;
      }
      case 'seek': {
        // 정지 상태면 위치만 맞춘다(상담사가 멈춘 채 이동한 경우 그대로 멈춰 있는다)
        engine.seek(target);
        setPlaying(engine.isPlaying());
        break;
      }
      case 'pause': {
        engine.pause();
        engine.seek(target);
        setPlaying(false);
        break;
      }
      case 'stop': {
        engine.stop();
        setPlaying(false);
        break;
      }
      default: {
        break;
      }
    }
    setSynced(true);
    setPositionSec(engine.positionSec());
    setBlocked(engine.isBlocked());
  }, [event, enabled, track, applyEvent]);

  // ── 1초 표시 + 정기 재동기(임계 초과 시에만 재시킹) ──────────────
  useEffect(() => {
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const current = engine.positionSec();
      const reference = lastEventRef.current;
      if (reference && engine.isPlaying()) {
        const offset = clockOffsetMs(clockRef.current);
        const target = targetPositionSec(reference, Date.now(), offset);
        const gap = Math.abs(current - target);
        setDrift(gap);
        if (gap > DRIFT_TOLERANCE_SEC) {
          engine.seek(target);
        }
      }
      setPlaying(engine.isPlaying());
      setPositionSec(engine.positionSec());
      setBlocked(engine.isBlocked());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const setVolume = useCallback((value: number): void => {
    engineRef.current?.setVolume(value);
    const applied = engineRef.current?.volume() ?? value;
    setVolumeState(applied);
    writeStoredVolume(applied);
  }, []);

  const resume = useCallback((): void => {
    engineRef.current?.resume();
    // 재생이 막혀 있었다면 위치 기준을 다시 계산해 따라잡는다
    const engine = engineRef.current;
    const reference = lastEventRef.current;
    if (engine && reference && reference.action === 'play') {
      const offset = clockOffsetMs(clockRef.current);
      const target = targetPositionSec(reference, Date.now(), offset);
      engine.play(target);
      setPlaying(true);
    }
    setBlocked(engineRef.current?.isBlocked() ?? false);
  }, []);

  return {
    state: {
      track,
      playing,
      positionSec,
      durationSec: track?.duration_sec ?? null,
      volume,
      blocked,
      synced,
      drift,
    },
    setVolume,
    resume,
  };
}
