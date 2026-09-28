// 개선 10: 재생 엔진 — 상담사·회원이 **같은 소스**를 재생하기 위한 얇은 추상화.
//
// 트랙은 두 종류의 소스를 가진다.
// - url 트랙: HTMLAudioElement 로 재생(공개 오디오·S3 자산).
// - tone 트랙: Web Audio 로 합성(무자산). 모든 클라이언트가 같은 주파수·파형을 만들므로
//   자산 없이도 "동일 소스" 동기 재생이 성립한다. AudioContext 가 없거나 정책상 막혀도
//   위치 추적은 계속되므로(무음) 동기 상태 자체는 유지된다.
//
// 위치는 엔진이 단일 기준으로 들고 있다가(positionSec) 서버 타임코드와 비교해 재시킹한다.
// 볼륨은 회원별 개별 값이며 스피커 뮤트(iOS/브라우저 출력)와 무관하게 엔진에 직접 적용된다.

import {
  DEFAULT_AUDIO_VOLUME,
  clampPosition,
  clampVolume,
  trackSourceOf,
  type AudioToneSpec,
  type MeditationTrack,
} from './audio-sync';

export interface AudioEngine {
  readonly track: MeditationTrack;
  /** 현재 재생 위치(초) */
  positionSec(): number;
  isPlaying(): boolean;
  /** 지정 위치(기본 현재 위치)에서 재생 시작 */
  play(fromSec?: number): void;
  pause(): void;
  /** 재생 중이면 위치만 이동, 정지 상태면 다음 play 위치를 갱신 */
  seek(toSec: number): void;
  stop(): void;
  setVolume(value: number): void;
  volume(): number;
  /** 자동재생 정책으로 막혔을 수 있다 — 사용자 제스처에서 호출하면 재개된다 */
  resume(): void;
  /** 자동재생 차단(무음) 여부 — 회원 패널이 "탭하여 소리 켜기"를 안내한다 */
  isBlocked(): boolean;
  dispose(): void;
}

const TONE_ANCHOR_TICK_MS = 250;

/** AudioContext 생성자 — 브라우저별 접두어(webkit)까지 확인한다 */
function resolveAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** HTMLAudioElement 기반 엔진 — 실제 자산(url) 재생 */
function createElementEngine(track: MeditationTrack, url: string): AudioEngine {
  const element = new Audio(url);
  element.loop = track.loop;
  element.preload = 'auto';
  let volume = DEFAULT_AUDIO_VOLUME;
  element.volume = volume;

  let playing = false;
  let lastPosition = 0;
  let blocked = false;

  const readPosition = (): number => {
    if (!playing) return lastPosition;
    const current = element.currentTime;
    if (Number.isFinite(current)) {
      lastPosition = clampPosition(current, track.duration_sec);
    }
    return lastPosition;
  };

  const seekTo = (sec: number): void => {
    const next = clampPosition(sec, track.duration_sec);
    lastPosition = next;
    try {
      element.currentTime = next;
    } catch {
      // 메타데이터 로드 전 currentTime 설정 실패는 무시 — 다음 재생 시 다시 맞춘다
    }
  };

  return {
    track,
    positionSec: readPosition,
    isPlaying: () => playing,
    play: (fromSec?: number) => {
      seekTo(fromSec ?? lastPosition);
      // jsdom 등 play() 미구현 환경은 undefined 를 돌려준다 — 결과를 신뢰하지 않는다
      const result = element.play() as Promise<void> | undefined;
      playing = true;
      blocked = false;
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          // 자동재생 정책 차단 — 무음이지만 상태(위치)는 유지한다
          blocked = true;
          playing = false;
        });
      }
    },
    pause: () => {
      playing = false;
      element.pause();
    },
    seek: seekTo,
    stop: () => {
      playing = false;
      element.pause();
      seekTo(0);
    },
    setVolume: (value: number) => {
      volume = clampVolume(value);
      element.volume = volume;
    },
    volume: () => volume,
    resume: () => {
      const result = element.play() as Promise<void> | undefined;
      playing = true;
      blocked = false;
      if (result && typeof result.catch === 'function') {
        result.catch(() => {
          blocked = true;
          playing = false;
        });
      }
    },
    isBlocked: () => blocked,
    dispose: () => {
      playing = false;
      element.pause();
    },
  };
}

/** Web Audio 합성 엔진 — 무자산 톤(드론·맥박 가이드) */
function createToneEngine(track: MeditationTrack, spec: AudioToneSpec): AudioEngine {
  const durationSec = track.duration_sec;
  const Ctor = resolveAudioContextCtor();
  let volume = DEFAULT_AUDIO_VOLUME;

  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let nodes: AudioScheduledSourceNode[] = [];
  let timer: number | null = null;

  let playing = false;
  /** 재생 위치 기준점 — anchorSec(초) + (지금 - anchorMs) 이 현재 위치 */
  let anchorSec = 0;
  let anchorMs = 0;
  let blocked = false;

  const wrap = (sec: number): number => {
    if (!durationSec || durationSec <= 0) return Math.max(0, sec);
    return ((sec % durationSec) + durationSec) % durationSec;
  };

  const readPosition = (): number => {
    if (!playing) return anchorSec;
    return wrap(anchorSec + Math.max(0, (Date.now() - anchorMs) / 1000));
  };

  /** 기준점을 지금 위치로 재고정 — 다음 readPosition 이 누적 오차 없이 계산되게 한다 */
  const reanchor = (): void => {
    anchorSec = readPosition();
    anchorMs = Date.now();
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const stopNodes = (): void => {
    for (const node of nodes) {
      try {
        node.stop();
      } catch {
        // 이미 정지한 노드 — 무시
      }
    }
    nodes = [];
  };

  const ensureContext = (): AudioContext | null => {
    if (!Ctor) return null;
    if (context) return context;
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = groupGain();
      master.connect(context.destination);
    } catch {
      context = null;
      master = null;
    }
    return context;
  };

  /** 트랙 정의 기준 소리 크기(볼륨 곱하기 전) */
  const groupGain = (): number => clampVolume(spec.gain) * 0.25;

  const applyVolume = (): void => {
    if (master && context) {
      master.gain.setTargetAtTime(groupGain() * volume, context.currentTime, 0.02);
    }
  };

  const startNodes = (): void => {
    const ctx = ensureContext();
    if (!ctx || !master) return;
    stopNodes();

    const freqs = [spec.freq_hz];
    if (spec.detune_hz && spec.detune_hz > 0) freqs.push(spec.freq_hz + spec.detune_hz);

    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type = spec.waveform;
      osc.frequency.value = freq;
      osc.connect(master);
      osc.start();
      nodes.push(osc);
    }

    // 가이드 트랙의 호흡 안내 — 진폭 변조(LFO)로 맥박을 만든다
    if (spec.pulse_sec && spec.pulse_sec > 0) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 1 / spec.pulse_sec;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = groupGain() * volume * 0.6;
      lfo.connect(lfoGain);
      lfoGain.connect(master.gain);
      lfo.start();
      nodes.push(lfo);
    }
  };

  const suspendNodes = (): void => {
    stopNodes();
  };

  return {
    track,
    positionSec: readPosition,
    isPlaying: () => playing,
    play: (fromSec?: number) => {
      if (fromSec !== undefined) {
        anchorSec = wrap(clampPosition(fromSec, durationSec));
      }
      anchorMs = Date.now();
      playing = true;

      const ctx = ensureContext();
      if (ctx) {
        // 자동재생 정책: 사용자 제스처 없이 시작하면 suspended 로 남는다
        const resumed = ctx.resume() as Promise<void> | undefined;
        blocked = ctx.state !== 'running';
        if (resumed && typeof resumed.then === 'function') {
          resumed.then(
            () => {
              blocked = false;
            },
            () => {
              blocked = true;
            },
          );
        }
      } else {
        blocked = true; // AudioContext 미지원 — 위치만 흐른다(무음)
      }

      startNodes();
      applyVolume();
      clearTimer();
      // 기준점을 주기적으로 재고정 — 긴 세션에서 누적 오차·루프 경계 처리를 단순화한다
      timer = window.setInterval(reanchor, TONE_ANCHOR_TICK_MS);
    },
    pause: () => {
      reanchor();
      playing = false;
      clearTimer();
      suspendNodes();
    },
    seek: (toSec: number) => {
      const next = wrap(clampPosition(toSec, durationSec));
      if (playing) {
        anchorSec = next;
        anchorMs = Date.now();
        return;
      }
      anchorSec = next;
    },
    stop: () => {
      playing = false;
      clearTimer();
      suspendNodes();
      anchorSec = 0;
      anchorMs = Date.now();
    },
    setVolume: (value: number) => {
      volume = clampVolume(value);
      applyVolume();
    },
    volume: () => volume,
    resume: () => {
      const ctx = ensureContext();
      if (!ctx) return;
      const resumed = ctx.resume() as Promise<void> | undefined;
      if (resumed && typeof resumed.then === 'function') {
        resumed.then(
          () => {
            blocked = false;
          },
          () => {
            blocked = true;
          },
        );
      } else {
        blocked = ctx.state !== 'running';
      }
    },
    isBlocked: () => blocked,
    dispose: () => {
      playing = false;
      clearTimer();
      stopNodes();
      if (context) {
        void context.close().catch(() => undefined);
        context = null;
        master = null;
      }
    },
  };
}

/**
 * 트랙에 맞는 엔진 생성. 소스가 전혀 없으면 null(호출측이 재생하지 않음).
 * url 트랙은 자산 로딩 실패 시에도 조용히 무음 — 위치 기준은 유지된다.
 */
export function createAudioEngine(track: MeditationTrack): AudioEngine | null {
  const source = trackSourceOf(track);
  if (source === 'url' && track.url) {
    return createElementEngine(track, track.url);
  }
  if (track.synth) {
    return createToneEngine(track, track.synth);
  }
  return null;
}
