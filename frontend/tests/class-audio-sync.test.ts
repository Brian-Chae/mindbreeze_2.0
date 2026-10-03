// @vitest-environment jsdom
// 개선 10: 명상 가이드·BGM 동기 재생 — 순수 계약/시계 보정 + 재생 엔진 + Socket.IO 계약 + UI
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { ClassAudioPanel } from '../src/components/class/ClassAudioPanel';
import { GuestAudioPanel } from '../src/components/class/GuestAudioPanel';
import { createAudioEngine } from '../src/lib/class/audio-engine';
import {
  AUDIO_SYNC_ACTIONS,
  AUDIO_VOLUME_STORAGE_KEY,
  CLASS_AUDIO_SYNC_EVENT,
  DEFAULT_AUDIO_VOLUME,
  DRIFT_TOLERANCE_SEC,
  buildAudioSyncEmit,
  clampPosition,
  clampVolume,
  clockOffsetMs,
  emptyClockSamples,
  formatClock,
  formatTrackDuration,
  isMeditationTrack,
  needsResync,
  normalizeTrackList,
  parseAudioSyncEvent,
  recordClockSample,
  targetPositionSec,
  trackSourceOf,
  type AudioSyncEvent,
  type MeditationTrack,
} from '../src/lib/class/audio-sync';
import { emitClassAudioSync, subscribeClassAudioSync } from '../src/lib/socket';
import { resetClassAudioTracksCache } from '../src/lib/api/class-audio';
import type {
  ClassAudioPlayerActions,
  ClassAudioPlayerState,
} from '../src/hooks/useClassAudioPlayer';
import { useGuestAudioSync } from '../src/hooks/useGuestAudioSync';

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((el) =>
    (el.textContent ?? '').includes(text),
  );
}

function slider(label: string): HTMLInputElement | undefined {
  return [...document.querySelectorAll('input[type="range"]')].find(
    (el) => el.getAttribute('aria-label') === label,
  ) as HTMLInputElement | undefined;
}

/**
 * range 입력값을 바꾼다.
 * React 는 value tracker 로 중복 변경을 걸러내므로 네이티브 setter 로 값을 넣고
 * input 이벤트를 보내야 onChange 가 호출된다.
 */
async function setRange(input: HTMLInputElement, value: number): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function text(): string {
  return container.textContent ?? '';
}

/** 소켓은 계약(이벤트명·payload)만 검증하면 되므로 최소 fake 로 대체한다 */
function fakeSocket(connected = true) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const emit = vi.fn();
  const socket = {
    connected,
    emit,
    on: (event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    off: (event: string, handler: (payload: unknown) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((fn) => fn !== handler),
      );
    },
  } as unknown as Socket;
  /** 서버 → 클라이언트 이벤트를 흉내낸다 */
  const deliver = (event: string, payload: unknown): void => {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  };
  return { socket, emit, deliver, listenerCount: (event: string) => (listeners.get(event) ?? []).length };
}

/** 백엔드 class:audio_sync 계약 payload */
function syncEvent(over: Partial<AudioSyncEvent> = {}): AudioSyncEvent {
  return {
    session_id: 's1',
    action: 'play',
    track_id: 'bgm-calm-drone-432',
    position_sec: 12,
    server_ts: '2026-09-29T10:00:00+00:00',
    server_ts_ms: Date.now(),
    revision: 1,
    ...over,
  };
}

/** 톤 트랙(무자산 — jsdom 에서도 재생 위치 추적이 동작한다) */
const TONE_TRACK: MeditationTrack = {
  track_id: 'bgm-calm-drone-432',
  title: '고요한 드론 (432Hz)',
  kind: 'bgm',
  url: null,
  duration_sec: null,
  synth: { freq_hz: 432, waveform: 'sine', gain: 0.12, detune_hz: 0.4, pulse_sec: null },
  description: '저음 드론',
  loop: true,
  source: 'tone',
};

/** URL 트랙(자산) — 2분 길이 */
const URL_TRACK: MeditationTrack = {
  track_id: 'bgm-s3-rain',
  title: '빗소리',
  kind: 'bgm',
  url: 'https://cdn.example.com/audio/rain.mp3',
  duration_sec: 120,
  synth: null,
  description: '',
  loop: true,
  source: 'url',
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.localStorage.clear();
  // 트랙 카탈로그는 모듈 캐시를 쓴다 — 테스트 간 응답 스텁이 새지 않게 초기화한다
  resetClassAudioTracksCache();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── 순수 계약 ──────────────────────────────────────────────────────

describe('audio-sync 계약', () => {
  it('payload 를 검증·정규화한다 (계약 밖은 null)', () => {
    const event = parseAudioSyncEvent({
      session_id: 's1',
      action: 'play',
      track_id: 't1',
      position_sec: 3.5,
      server_ts: '2026-09-29T10:00:00+00:00',
      server_ts_ms: 1000,
      revision: 2,
    });
    expect(event).toEqual({
      session_id: 's1',
      action: 'play',
      track_id: 't1',
      position_sec: 3.5,
      server_ts: '2026-09-29T10:00:00+00:00',
      server_ts_ms: 1000,
      revision: 2,
    });

    expect(parseAudioSyncEvent(null)).toBeNull();
    expect(parseAudioSyncEvent('nope')).toBeNull();
    expect(parseAudioSyncEvent({ action: 'rewind', server_ts_ms: 1000 })).toBeNull();
    // server_ts_ms 도 server_ts 도 없으면 시각 기준이 없어 적용할 수 없다
    expect(parseAudioSyncEvent({ action: 'play' })).toBeNull();
    // ISO 만 있는 구버전 payload 는 시각을 복원해 받아들인다
    const legacy = parseAudioSyncEvent({ action: 'pause', server_ts: '2026-09-29T10:00:00+00:00' });
    expect(legacy?.server_ts_ms).toBe(Date.parse('2026-09-29T10:00:00+00:00'));
    // 음수 위치·누락 위치는 0 으로
    expect(parseAudioSyncEvent({ action: 'seek', server_ts_ms: 1, position_sec: -9 })?.position_sec).toBe(0);
    expect(parseAudioSyncEvent({ action: 'seek', server_ts_ms: 1 })?.position_sec).toBe(0);
  });

  it('액션 상수는 백엔드와 동일한 4종 계약', () => {
    expect(CLASS_AUDIO_SYNC_EVENT).toBe('class:audio_sync');
    expect([...AUDIO_SYNC_ACTIONS]).toEqual(['play', 'pause', 'seek', 'stop']);
  });

  it('트랙 목록을 검증해 재생 가능한 트랙만 남긴다', () => {
    expect(isMeditationTrack(TONE_TRACK)).toBe(true);
    expect(isMeditationTrack(URL_TRACK)).toBe(true);
    // 소스(url/synth)가 없으면 재생 불가 → 제외
    expect(isMeditationTrack({ track_id: 'x', title: 'x', kind: 'bgm', url: null, synth: null })).toBe(false);
    expect(isMeditationTrack({ track_id: '', title: 'x', kind: 'bgm', url: 'https://a/b.mp3' })).toBe(false);
    expect(
      isMeditationTrack({ track_id: 'x', title: 'x', kind: 'video', url: 'https://a/b.mp3' }),
    ).toBe(false);

    const tracks = normalizeTrackList({
      tracks: [TONE_TRACK, URL_TRACK, { track_id: 'bad' }, null],
    });
    expect(tracks.map((t) => t.track_id)).toEqual([TONE_TRACK.track_id, URL_TRACK.track_id]);
    expect(normalizeTrackList({})).toEqual([]);
    expect(normalizeTrackList(null)).toEqual([]);
    expect(trackSourceOf(TONE_TRACK)).toBe('tone');
    expect(trackSourceOf(URL_TRACK)).toBe('url');
  });

  it('위치·볼륨 클램프와 표기', () => {
    expect(clampPosition(-3)).toBe(0);
    expect(clampPosition(500, 120)).toBe(120);
    expect(clampPosition(Number.NaN)).toBe(0);
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_AUDIO_VOLUME);
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatTrackDuration(null)).toBe('무한');
    expect(formatTrackDuration(120)).toBe('02:00');
  });

  it('emit payload 를 만든다', () => {
    expect(buildAudioSyncEmit('s1', 'play', 't1', 3.2)).toEqual({
      session_id: 's1',
      action: 'play',
      track_id: 't1',
      position_sec: 3.2,
    });
  });
});

// ── 서버 시계 보정 · 동기 수식 ──────────────────────────────────────

describe('동기 수식', () => {
  it('시계 오차는 지연이 가장 작았던 표본(최댓값)으로 추정한다', () => {
    expect(clockOffsetMs(emptyClockSamples())).toBe(0);

    // 로컬 시계가 서버보다 10초 느림(offset=+10000ms), 지연 200ms → 표본 9800
    const event = syncEvent({ server_ts_ms: 1_010_000, revision: 1 });
    const first = recordClockSample(emptyClockSamples(), event, 1_000_200);
    expect(clockOffsetMs(first)).toBe(9_800);

    // 두 번째 표본의 지연이 컸다(5000ms) → 오래된 지연 큰 표본은 추정을 흔들지 않는다
    const second = recordClockSample(first, syncEvent({ server_ts_ms: 1_015_000, revision: 2 }), 1_005_000);
    expect(clockOffsetMs(second)).toBe(10_000);

    // 표본은 상한까지만 보관한다
    let state = emptyClockSamples();
    for (let i = 0; i < 30; i += 1) {
      state = recordClockSample(state, syncEvent({ server_ts_ms: i * 1000, revision: i + 1 }), 0, 4);
    }
    expect(state.samples).toHaveLength(4);
  });

  it('play 는 경과 시간을 더해 현재 위치를 계산한다(늦은 입장자도 합류)', () => {
    const event = syncEvent({ action: 'play', position_sec: 30, server_ts_ms: 1_000_000 });
    // 서버 시각이 로컬보다 10초 앞(offset=+10000ms)이고 명령 후 5초 지났다
    expect(targetPositionSec(event, 995_000, 10_000)).toBe(35);
    // 같은 명령을 20초 뒤에 받은 회원
    expect(targetPositionSec(event, 1_020_000, 10_000)).toBe(60);
    // 로컬 시계가 서버보다 앞서 있어도(offset 음수) 음수 경과는 0 으로 본다
    expect(targetPositionSec(event, 990_000, 0)).toBe(30);
  });

  it('pause·seek·stop 은 지시된 위치를 그대로 따른다(경과 시간 미가산)', () => {
    const paused = syncEvent({ action: 'pause', position_sec: 42, server_ts_ms: 1_000_000 });
    expect(targetPositionSec(paused, 1_600_000, 0)).toBe(42);
    const seek = syncEvent({ action: 'seek', position_sec: 7, server_ts_ms: 1_000_000 });
    expect(targetPositionSec(seek, 1_600_000, 0)).toBe(7);
    const stop = syncEvent({ action: 'stop', position_sec: 99, server_ts_ms: 1_000_000 });
    expect(targetPositionSec(stop, 1_600_000, 0)).toBe(0);
  });

  it('임계 이내 편차는 재시킹하지 않는다', () => {
    expect(needsResync(10, 10.1)).toBe(false);
    expect(needsResync(10, 10 + DRIFT_TOLERANCE_SEC + 0.01)).toBe(true);
    expect(needsResync(Number.NaN, 10)).toBe(false);
  });
});

// ── 재생 엔진 ──────────────────────────────────────────────────────

describe('재생 엔진', () => {
  it('톤 트랙 엔진 — 재생/일시정지/이동/정지와 위치 추적', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const engine = createAudioEngine(TONE_TRACK);
    expect(engine).not.toBeNull();
    const tone = engine!;

    expect(tone.isPlaying()).toBe(false);
    expect(tone.positionSec()).toBe(0);

    tone.play(0);
    expect(tone.isPlaying()).toBe(true);

    now += 5_000; // 5초 경과
    expect(tone.positionSec()).toBeCloseTo(5, 3);

    tone.pause();
    expect(tone.isPlaying()).toBe(false);
    now += 10_000; // 일시정지 중에는 위치가 흐르지 않는다
    expect(tone.positionSec()).toBeCloseTo(5, 3);

    tone.seek(31.5);
    expect(tone.positionSec()).toBeCloseTo(31.5, 3);

    tone.play(); // 현재 위치에서 이어서
    now += 1_000;
    expect(tone.positionSec()).toBeCloseTo(32.5, 3);

    tone.stop();
    expect(tone.isPlaying()).toBe(false);
    expect(tone.positionSec()).toBe(0);

    // 볼륨은 엔진이 보관한다(회원 개별 설정)
    tone.setVolume(0.35);
    expect(tone.volume()).toBeCloseTo(0.35, 5);
    tone.setVolume(5);
    expect(tone.volume()).toBe(1);

    // AudioContext 미지원 환경(jsdom)은 무음이지만 차단 상태로 알린다
    expect(tone.isBlocked()).toBe(true);

    tone.dispose();
  });

  it('URL 트랙 엔진 — 오디오 요소 시킹·볼륨·정지', () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const elements: {
      src: string;
      currentTime: number;
      volume: number;
      loop: boolean;
      paused: boolean;
    }[] = [];

    class FakeAudio {
      src: string;
      currentTime = 0;
      volume = 1;
      loop = false;
      preload = '';
      constructor(src: string) {
        this.src = src;
        elements.push(this as unknown as (typeof elements)[number]);
      }
      play = play;
      pause = pause;
    }
    vi.stubGlobal('Audio', FakeAudio);

    const engine = createAudioEngine(URL_TRACK);
    expect(engine).not.toBeNull();
    const audio = engine!;

    expect(elements[0]?.src).toBe(URL_TRACK.url);
    expect(elements[0]?.loop).toBe(true);

    audio.play(15);
    expect(play).toHaveBeenCalledTimes(1);
    expect(audio.positionSec()).toBeCloseTo(15, 3);
    expect(audio.isPlaying()).toBe(true);

    audio.setVolume(0.2);
    expect(engine!.volume()).toBeCloseTo(0.2, 3);

    audio.seek(119);
    expect(audio.positionSec()).toBeCloseTo(119, 3);
    // 길이를 넘는 위치는 트랙 길이로 잘린다
    audio.seek(999);
    expect(audio.positionSec()).toBeCloseTo(120, 3);

    audio.stop();
    expect(pause).toHaveBeenCalled();
    expect(audio.positionSec()).toBe(0);
    expect(audio.isPlaying()).toBe(false);

    audio.dispose();
  });

  it('소스가 없는 트랙은 엔진을 만들지 않는다', () => {
    expect(
      createAudioEngine({
        track_id: 'x',
        title: 'x',
        kind: 'bgm',
        url: null,
        duration_sec: null,
        synth: null,
        description: '',
        loop: true,
        source: 'tone',
      }),
    ).toBeNull();
  });
});

// ── Socket.IO 계약 ─────────────────────────────────────────────────

describe('class:audio_sync 소켓 계약', () => {
  it('구독은 이벤트명 class:audio_sync 로 연결되고 계약 밖 payload 는 걸러진다', () => {
    const { socket, deliver, listenerCount } = fakeSocket();
    const handler = vi.fn();

    const unsubscribe = subscribeClassAudioSync(socket, handler);
    expect(listenerCount(CLASS_AUDIO_SYNC_EVENT)).toBe(1);

    deliver(CLASS_AUDIO_SYNC_EVENT, {
      session_id: 's1',
      action: 'play',
      track_id: 't1',
      position_sec: 5,
      server_ts_ms: 1000,
      revision: 3,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].action).toBe('play');

    deliver(CLASS_AUDIO_SYNC_EVENT, { action: 'rewind' });
    deliver(CLASS_AUDIO_SYNC_EVENT, null);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(listenerCount(CLASS_AUDIO_SYNC_EVENT)).toBe(0);
  });

  it('emit 은 연결된 소켓에서만 전송한다', () => {
    const connected = fakeSocket(true);
    expect(
      emitClassAudioSync(connected.socket, {
        session_id: 's1',
        action: 'play',
        track_id: 't1',
        position_sec: 0,
      }),
    ).toBe(true);
    expect(connected.emit).toHaveBeenCalledWith('class:audio_sync', {
      session_id: 's1',
      action: 'play',
      track_id: 't1',
      position_sec: 0,
    });

    const offline = fakeSocket(false);
    expect(
      emitClassAudioSync(offline.socket, {
        session_id: 's1',
        action: 'stop',
        track_id: null,
        position_sec: 0,
      }),
    ).toBe(false);
    expect(offline.emit).not.toHaveBeenCalled();
  });
});

// ── 상담사 패널 UI ─────────────────────────────────────────────────

function playerState(over: Partial<ClassAudioPlayerState> = {}): ClassAudioPlayerState {
  return {
    tracks: [TONE_TRACK, URL_TRACK],
    tracksLoading: false,
    selectedTrackId: URL_TRACK.track_id,
    playing: false,
    positionSec: 30,
    durationSec: 120,
    volume: 0.6,
    broadcastOk: true,
    blocked: false,
    ...over,
  };
}

function playerActions(): ClassAudioPlayerActions {
  return {
    selectTrack: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    stop: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    resume: vi.fn(),
  };
}

describe('ClassAudioPanel (상담사)', () => {
  it('트랙 목록·재생 컨트롤을 렌더하고 조작을 전달한다', async () => {
    const actions = playerActions();
    await render(
      createElement(ClassAudioPanel, { state: playerState(), actions, enabled: true, connected: true }),
    );

    expect(text()).toContain('대기실 BGM');
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe(URL_TRACK.track_id);
    expect([...select.options].map((o) => o.value)).toEqual([TONE_TRACK.track_id, URL_TRACK.track_id]);

    await act(async () => {
      button('재생')?.click();
    });
    expect(actions.toggle).toHaveBeenCalledTimes(1);

    await act(async () => {
      button('정지')?.click();
    });
    expect(actions.stop).toHaveBeenCalledTimes(1);

    const position = slider('재생 위치')!;
    await setRange(position, 45);
    expect(actions.seekTo).toHaveBeenCalled();

    const volume = slider('모니터 볼륨')!;
    await setRange(volume, 30);
    expect(actions.setVolume).toHaveBeenCalled();

    // 정지 상태에서는 동기 안내 대신 정지로 표시된다(재생 중 표기는 별도 테스트)
    expect(text()).toContain('정지');
  });

  it('재생 중·전달 실패·연결 끊김 상태를 구분해 표시한다', async () => {
    const actions = playerActions();
    await render(
      createElement(ClassAudioPanel, {
        state: playerState({ playing: true, broadcastOk: false }),
        actions,
        enabled: true,
        connected: true,
      }),
    );
    expect(text()).toContain('서버 연결 끊김');

    await render(
      createElement(ClassAudioPanel, {
        state: playerState({ playing: true }),
        actions,
        enabled: true,
        connected: false,
      }),
    );
    expect(text()).toContain('서버 연결 끊김');

    await render(
      createElement(ClassAudioPanel, {
        state: playerState({ playing: true }),
        actions,
        enabled: true,
        connected: true,
      }),
    );
    expect(text()).toContain('회원 동시 재생');
  });

  it('진행 단계가 아니면 컨트롤이 비활성된다', async () => {
    const actions = playerActions();
    await render(
      createElement(ClassAudioPanel, { state: playerState(), actions, enabled: false, connected: true }),
    );
    expect(button('재생')?.disabled).toBe(true);
    expect(button('정지')?.disabled).toBe(true);
  });

  it('내장 톤 트랙(길이 없음)은 길이 대신 무한으로 표기한다', async () => {
    const actions = playerActions();
    await render(
      createElement(ClassAudioPanel, {
        state: playerState({ selectedTrackId: TONE_TRACK.track_id, durationSec: null }),
        actions,
        enabled: true,
        connected: true,
      }),
    );
    expect(text()).toContain('무한');
    expect(slider('재생 위치')).toBeUndefined();
  });
});

// ── 회원 패널 UI ───────────────────────────────────────────────────

describe('GuestAudioPanel (회원)', () => {
  it('트랙·동기 상태·개별 볼륨을 표시하고 볼륨 변경을 전달한다', async () => {
    const onVolumeChange = vi.fn();
    await render(
      createElement(GuestAudioPanel, {
        trackTitle: TONE_TRACK.title,
        playing: true,
        positionSec: 65,
        durationSec: null,
        volume: 0.6,
        onVolumeChange,
        blocked: false,
        onResume: vi.fn(),
        synced: true,
      }),
    );

    expect(text()).toContain(TONE_TRACK.title);
    expect(text()).toContain('상담사와 동기 재생 중');
    expect(text()).toContain('01:05');
    expect(text()).toContain('60%');

    const volume = slider('볼륨')!;
    await setRange(volume, 20);
    expect(onVolumeChange).toHaveBeenCalled();
  });

  it('상담사 재생 전에는 대기 안내를 보여 준다', async () => {
    await render(
      createElement(GuestAudioPanel, {
        trackTitle: null,
        playing: false,
        positionSec: 0,
        durationSec: null,
        volume: 0.6,
        onVolumeChange: vi.fn(),
        blocked: false,
        onResume: vi.fn(),
        synced: false,
      }),
    );
    expect(text()).toContain('상담사가 재생을 시작하면 함께 재생됩니다');
    expect(text()).toContain('대기');
  });

  it('자동재생 차단 시 소리 켜기를 안내한다', async () => {
    const onResume = vi.fn();
    await render(
      createElement(GuestAudioPanel, {
        trackTitle: TONE_TRACK.title,
        playing: false,
        positionSec: 0,
        durationSec: null,
        volume: 0,
        onVolumeChange: vi.fn(),
        blocked: true,
        onResume,
        synced: true,
      }),
    );
    expect(text()).toContain('음소거');
    await act(async () => {
      button('여기를 눌러 켜기')?.click();
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

// ── 회원 동기 재생 훅 ──────────────────────────────────────────────

/** 카탈로그 API 응답을 스텁해 훅이 트랙을 해석하게 한다 */
function stubCatalog(tracks: MeditationTrack[] = [TONE_TRACK, URL_TRACK]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ tracks, count: tracks.length }), { status: 200 })),
  );
}

function SyncHarness({ event }: { event: AudioSyncEvent | null }) {
  const { state, setVolume } = useGuestAudioSync({ sessionId: 's1', enabled: true, event });
  return createElement(
    'div',
    {},
    createElement('span', { 'data-testid': 'title' }, state.track?.title ?? 'none'),
    createElement('span', { 'data-testid': 'playing' }, String(state.playing)),
    createElement('span', { 'data-testid': 'synced' }, String(state.synced)),
    createElement('span', { 'data-testid': 'volume' }, String(state.volume)),
    createElement('span', { 'data-testid': 'position' }, String(Math.round(state.positionSec))),
    createElement('button', { onClick: () => setVolume(0.25) }, '볼륨변경'),
  );
}

function read(testid: string): string {
  return container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';
}

/** fetch 응답이 반영될 때까지 마이크로태스크를 흘려보낸다 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useGuestAudioSync (회원 동기 재생)', () => {
  it('play 이벤트로 트랙을 해석해 재생 상태가 된다', async () => {
    stubCatalog();
    await render(createElement(SyncHarness, { event: null }));
    await flush();
    expect(read('synced')).toBe('false');

    await render(createElement(SyncHarness, { event: syncEvent({ action: 'play', position_sec: 40, server_ts_ms: Date.now() }) }));
    expect(read('synced')).toBe('true');
    expect(read('playing')).toBe('true');
    expect(read('title')).toBe(TONE_TRACK.title);
    // 서버와 로컬 시계가 같고 명령 직후이므로 위치는 지시값 그대로
    expect(Number(read('position'))).toBe(40);
  });

  it('pause 는 멈추고, stop 은 처음으로 되돌린다', async () => {
    stubCatalog();
    await render(createElement(SyncHarness, { event: syncEvent({ action: 'play', position_sec: 30, revision: 1, server_ts_ms: Date.now() }) }));
    expect(read('playing')).toBe('true');

    await render(createElement(SyncHarness, { event: syncEvent({ action: 'pause', position_sec: 30, revision: 2, server_ts_ms: Date.now() }) }));
    expect(read('playing')).toBe('false');
    expect(Number(read('position'))).toBe(30);

    await render(createElement(SyncHarness, { event: syncEvent({ action: 'stop', position_sec: 0, revision: 3, server_ts_ms: Date.now() }) }));
    expect(read('playing')).toBe('false');
    expect(Number(read('position'))).toBe(0);
  });

  it('역순 도착 이벤트는 무시한다(최신 명령 유지)', async () => {
    stubCatalog();
    await render(
      createElement(SyncHarness, {
        event: syncEvent({ action: 'play', position_sec: 10, revision: 7, server_ts_ms: Date.now() }),
      }),
    );
    expect(read('playing')).toBe('true');

    // 오래된 revision(네트워크 재정렬) — 적용되면 재생이 멈춰 버린다
    await render(
      createElement(SyncHarness, {
        event: syncEvent({ action: 'pause', position_sec: 0, revision: 3, server_ts_ms: Date.now() }),
      }),
    );
    expect(read('playing')).toBe('true');
  });

  it('회원 볼륨은 개별 설정으로 유지된다', async () => {
    stubCatalog();
    await render(createElement(SyncHarness, { event: syncEvent({ server_ts_ms: Date.now() }) }));
    expect(Number(read('volume'))).toBeCloseTo(DEFAULT_AUDIO_VOLUME, 3);

    await act(async () => {
      button('볼륨변경')?.click();
    });
    expect(Number(read('volume'))).toBeCloseTo(0.25, 3);
    expect(window.localStorage.getItem(AUDIO_VOLUME_STORAGE_KEY)).toBe('0.25');
  });

  it('트랙 목록을 못 받으면 재생하지 않는다(클래스 진행은 유지)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await render(createElement(SyncHarness, { event: syncEvent({ server_ts_ms: Date.now() }) }));
    await flush();
    expect(read('title')).toBe('none');
    expect(read('playing')).toBe('false');
    expect(read('synced')).toBe('false');
  });
});
