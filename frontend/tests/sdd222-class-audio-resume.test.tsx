// @vitest-environment jsdom
// SDD-222 T-J10 — useClassAudioPlayer 앱 복귀 시 음원 재동기화 (V39)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  resume: [] as { cb: () => void | Promise<void>; order?: number }[],
  playing: false,
  blocked: false,
  position: 42,
  engineResume: vi.fn(),
}));
const track = { track_id: 't1', kind: 'bgm', duration_sec: 600, title: 'x' };
vi.mock('../src/lib/api/class-audio', () => ({ getClassAudioTracks: async () => [track] }));
vi.mock('../src/lib/class/audio-engine', () => ({
  createAudioEngine: () => ({
    track,
    positionSec: () => h.position,
    isPlaying: () => h.playing,
    play: () => { h.playing = true; },
    pause: () => { h.playing = false; },
    seek: () => undefined,
    stop: () => { h.playing = false; },
    setVolume: () => undefined,
    volume: () => 1,
    resume: () => h.engineResume(),
    fadeOut: () => undefined,
    isBlocked: () => h.blocked,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  }),
}));
vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { socket: 10, rawFlush: 20, ble: 30, screen: 40, liveKit: 50, audio: 60 },
  subscribeAppResume: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; h.resume.push(e);
    return () => { h.resume.splice(h.resume.indexOf(e), 1); };
  },
  subscribeAppPause: () => () => undefined,
}));

import { useClassAudioPlayer } from '../src/hooks/useClassAudioPlayer';

let root: Root;
const publish = vi.fn(() => true);
function Harness({ enabled }: { enabled: boolean }) {
  useClassAudioPlayer({ sessionId: 's1', enabled, publish });
  return null;
}
const render = (enabled: boolean) => act(async () => root.render(<Harness enabled={enabled} />));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.resume.length = 0; h.playing = false; h.blocked = false; h.position = 42; h.engineResume.mockReset();
  publish.mockClear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('useClassAudioPlayer — 복귀 재동기화', () => {
  it('V39 재생 중 복귀하면 현재 위치로 seek 를 재발행한다', async () => {
    await render(true); // 대기실 진입 → 자동 재생(play 발행)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: 'play' }));
    publish.mockClear();
    h.position = 130;
    await act(async () => { await h.resume[0].cb(); });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: 'seek', track_id: 't1', position_sec: 130 }));
  });

  it('재생 중이 아니면 복귀해도 발행하지 않는다 (필요 시만)', async () => {
    await render(true);
    h.playing = false; // 백그라운드에서 멈춘 경우·사용자가 정지한 경우
    publish.mockClear();
    await act(async () => { await h.resume[0].cb(); });
    expect(publish).not.toHaveBeenCalled();
  });

  it('재생 제어가 비활성(enabled=false)이면 복귀해도 발행하지 않는다', async () => {
    await render(false);
    h.playing = true;
    await act(async () => { for (const e of [...h.resume]) await e.cb(); });
    expect(publish).not.toHaveBeenCalled();
  });

  it('OS 가 오디오를 막아 둔 상태(blocked)면 엔진을 재개한 뒤 재발행한다', async () => {
    await render(true);
    h.blocked = true;
    publish.mockClear();
    await act(async () => { await h.resume[0].cb(); });
    expect(h.engineResume).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: 'seek' }));
  });
});
