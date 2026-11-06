// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHostPrepMedia } from '../src/hooks/useHostPrepMedia';
let root: Root;
let container: HTMLDivElement;
const stop = vi.fn();
const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
const getUserMedia = vi.fn();
function Probe({ phase, online = true }: { phase: 'setup' | 'lobby' | 'live'; online?: boolean }) {
  const media = useHostPrepMedia(online && phase !== 'live', 'session-1');
  return phase === 'live' ? null : <video key={phase} data-phase={phase} ref={media.videoRef} />;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  stop.mockClear(); getUserMedia.mockReset().mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (phase: 'setup' | 'lobby' | 'live', online = true) => { await act(async () => root.render(<Probe phase={phase} online={online} />)); };
it('setup → lobby에서 스트림을 유지하고 새 video DOM에 부착한다', async () => {
  await render('setup'); const original = container.querySelector('video');
  expect(original?.srcObject).toBe(stream);
  await render('lobby');
  expect(container.querySelector('video')).not.toBe(original);
  expect(container.querySelector('video')?.srcObject).toBe(stream);
  expect(stop).not.toHaveBeenCalled(); expect(getUserMedia).toHaveBeenCalledTimes(2);
  await render('live'); expect(stop).toHaveBeenCalledTimes(2);
});
it('open 직접 진입은 실제 미디어를 초기화하고 오프라인은 권한을 요청하지 않는다', async () => {
  await render('lobby', false); expect(getUserMedia).not.toHaveBeenCalled();
  await render('lobby'); expect(container.querySelector('video')?.srcObject).toBe(stream);
});
it('권한 응답 전에 라이브로 바뀌면 늦은 트랙을 즉시 닫는다', async () => {
  const resolvers: Array<(value: MediaStream) => void> = [];
  getUserMedia.mockImplementation(() => new Promise<MediaStream>(resolve => resolvers.push(resolve)));
  await render('lobby'); await render('live');
  await act(async () => { resolvers.forEach(resolve => resolve(stream)); });
  expect(stop).toHaveBeenCalledTimes(2);
});
