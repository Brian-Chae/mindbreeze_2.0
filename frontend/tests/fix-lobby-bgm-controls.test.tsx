// @vitest-environment jsdom
// FIX — 대기 화면 BGM 끄기·음량 조절 (verify V1~V6)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rejectPlay: null as null | ((e: unknown) => void),
  elements: [] as Array<{ volume: number; muted: boolean; paused: boolean }>,
}));

class FakeAudio {
  volume = 1; muted = false; paused = true; loop = false; preload = ''; currentTime = 0;
  constructor() { h.elements.push(this); }
  play(): Promise<void> {
    this.paused = false;
    return new Promise<void>((_res, rej) => { h.rejectPlay = (e) => { this.paused = true; rej(e); }; });
  }
  pause(): void { this.paused = true; }
}

const track = { track_id: 't1', kind: 'bgm', title: 'x', duration_sec: 600, loop: true, url: 'http://x/a.mp3' };
vi.mock('../src/lib/api/class-audio', () => ({
  getClassAudioTracks: async () => [track],
  readStoredVolume: () => 0.6,
  writeStoredVolume: () => undefined,
}));

import { createAudioEngine } from '../src/lib/class/audio-engine';
import { useLobbyBgm } from '../src/hooks/useLobbyBgm';

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, Audio: FakeAudio });
  h.elements.length = 0; h.rejectPlay = null;
});
afterEach(() => vi.restoreAllMocks());

describe('audio-engine (url)', () => {
  it('V1 play() 가 나중에 거부되면 구독자에게 알린다', async () => {
    const engine = createAudioEngine(track as never)!;
    const spy = vi.fn();
    engine.subscribe(spy);
    engine.play(0);
    expect(engine.isBlocked()).toBe(false);
    h.rejectPlay?.(new Error('NotAllowed'));
    await Promise.resolve(); await Promise.resolve();
    expect(engine.isBlocked()).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('V2 음량 0 이면 muted, 올리면 해제', () => {
    const engine = createAudioEngine(track as never)!;
    engine.setVolume(0);
    expect(h.elements[0].muted).toBe(true);
    engine.setVolume(0.5);
    expect(h.elements[0].muted).toBe(false);
    expect(h.elements[0].volume).toBe(0.5);
  });
});

describe('useLobbyBgm', () => {
  let root: Root;
  let api: ReturnType<typeof useLobbyBgm>;
  function Harness() { api = useLobbyBgm(true); return null; }
  beforeEach(async () => {
    root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Harness />));
    await act(async () => { await Promise.resolve(); });
  });
  afterEach(async () => { await act(async () => root.unmount()); });

  it('V4 자동재생이 나중에 막히면 blocked 상태가 반영된다', async () => {
    expect(api.state.blocked).toBe(false);
    await act(async () => { h.rejectPlay?.(new Error('NotAllowed')); await Promise.resolve(); await Promise.resolve(); });
    expect(api.state.blocked).toBe(true);
  });

  it('V4/V5 막힌 상태에서 슬라이더를 올리면 재생이 재개되고, 끈 상태에서도 켜진다', async () => {
    await act(async () => { api.setVolume(0); });
    expect(h.elements[0].muted).toBe(true);
    await act(async () => { h.rejectPlay?.(new Error('x')); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { api.setVolume(0.4); });
    expect(api.state.muted).toBe(false);
    expect(h.elements[0].muted).toBe(false);
    expect(h.elements[0].volume).toBe(0.4);
    expect(h.elements[0].paused).toBe(false); // 제스처로 재생 재개
  });
});
