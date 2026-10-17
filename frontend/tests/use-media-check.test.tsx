// @vitest-environment jsdom
// SDD-209 T2b — useMediaCheck: 사용자 동작 후에만 권한 요청, 오류 3분류, 레벨/링/조용해요, 정리
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaCheck, type MediaCheck } from '../src/hooks/useMediaCheck';

let latest: MediaCheck;
function Probe(): ReactNode {
  latest = useMediaCheck();
  return null;
}

const stopSpy = vi.fn();
const makeStream = (): MediaStream => ({ getTracks: () => [{ stop: stopSpy }] }) as unknown as MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
let timeDomain = 128; // 128 = 무음
const resumeSpy = vi.fn(() => Promise.resolve());

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = resumeSpy;
  close = vi.fn(() => Promise.resolve());
  createMediaStreamSource = () => ({ connect: vi.fn() });
  createAnalyser = () => ({
    fftSize: 0,
    frequencyBinCount: 256,
    connect: vi.fn(),
    getByteTimeDomainData: (buf: Uint8Array) => buf.forEach((_, i) => { buf[i] = i % 2 ? timeDomain : 256 - timeDomain; }),
  });
  createOscillator = () => ({ frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() });
  createGain = () => ({ gain: { value: 0 }, connect: vi.fn() });
}

let root: Root;
let container: HTMLDivElement;
async function mount(): Promise<void> {
  await act(async () => { root.render(<Probe />); });
}
const domErr = (name: string): DOMException => new DOMException('x', name);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  stopSpy.mockClear();
  resumeSpy.mockClear();
  timeDomain = 128;
  getUserMedia = vi.fn(() => Promise.resolve(makeStream()));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useMediaCheck', () => {
  it('마운트만으로는 권한을 요청하지 않는다', async () => {
    await mount();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(latest.mic).toBe('off');
    expect(latest.cam).toBe('off');
  });

  it('mediaDevices 가 없으면 unsupported', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    await mount();
    expect(latest.mic).toBe('unsupported');
    expect(latest.cam).toBe('unsupported');
  });

  it('startMic 성공: on, audio 만 요청, AudioContext.resume 호출', async () => {
    await mount();
    await act(async () => { await latest.startMic(); });
    expect(latest.mic).toBe('on');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(resumeSpy).toHaveBeenCalled();
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'nodevice'],
    ['NotReadableError', 'inuse'],
  ])('마이크 %s → %s', async (name, expected) => {
    getUserMedia.mockRejectedValueOnce(domErr(name));
    await mount();
    await act(async () => { await latest.startMic(); });
    expect(latest.mic).toBe(expected);
  });

  it('카메라 오류도 분류되고 마이크에 영향이 없다', async () => {
    getUserMedia.mockRejectedValueOnce(domErr('NotAllowedError'));
    await mount();
    await act(async () => { await latest.startCamera(); });
    expect(latest.cam).toBe('denied');
    expect(latest.mic).toBe('off');
  });

  it('레벨 → 링 단계, 무음이면 0', async () => {
    await mount();
    await act(async () => { await latest.startMic(); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(latest.level).toBe(0);
    expect(latest.steps).toBe(0);
    timeDomain = 192; // 진폭 0.5 → rms 0.5 → level 1
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(latest.level).toBe(1);
    expect(latest.steps).toBe(5);
  });

  it('3초간 작은 소리면 quiet, 큰 소리가 나오면 해제', async () => {
    await mount();
    await act(async () => { await latest.startMic(); });
    timeDomain = 134; // 작은 진폭
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(latest.quiet).toBe(false); // 창이 덜 찬 동안은 판정 보류
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(latest.quiet).toBe(true);
    timeDomain = 192;
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(latest.quiet).toBe(false);
  });

  it('stopMic: 트랙 정지, off, 레벨 0', async () => {
    await mount();
    await act(async () => { await latest.startMic(); });
    await act(async () => { latest.stopMic(); });
    expect(stopSpy).toHaveBeenCalled();
    expect(latest.mic).toBe('off');
    expect(latest.level).toBe(0);
  });

  it('toggleMic: 켜짐 ↔ 꺼짐', async () => {
    await mount();
    await act(async () => { await latest.toggleMic(); });
    expect(latest.mic).toBe('on');
    await act(async () => { await latest.toggleMic(); });
    expect(latest.mic).toBe('off');
  });

  it('recheck: 실패한 장치만 다시 요청', async () => {
    getUserMedia.mockRejectedValueOnce(domErr('NotAllowedError'));
    await mount();
    await act(async () => { await latest.startMic(); });
    expect(latest.mic).toBe('denied');
    getUserMedia.mockClear();
    await act(async () => { await latest.recheck(); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(latest.mic).toBe('on');
  });

  it('언마운트 시 스트림 정리', async () => {
    await mount();
    await act(async () => { await latest.startMic(); });
    stopSpy.mockClear();
    await act(async () => root.unmount());
    expect(stopSpy).toHaveBeenCalled();
    root = createRoot(container); // afterEach 의 unmount 대비
  });

  it('스피커 테스트음: 재생 중 → 끝나면 false (사용자 탭 안에서 resume)', async () => {
    await mount();
    await act(async () => { await latest.playTestTone(); });
    expect(latest.speakerPlaying).toBe(true);
    expect(resumeSpy).toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(latest.speakerPlaying).toBe(false);
  });
});
