// @vitest-environment jsdom
// [Fix] 녹음 끊김 감지 — useRecordingStallGuard (verify V1~V6)
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecordingStallGuard } from '../src/hooks/useRecordingStallGuard';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot>;
let box: HTMLDivElement;
let latest: { stalled: boolean };
let progress = 0;
const onStall = vi.fn();

function Probe({ active }: { active: boolean }) {
  const g = useRecordingStallGuard({ active, readProgress: () => progress, onStall });
  useEffect(() => { latest = g; });
  return null;
}
const render = (active: boolean) => act(async () => root.render(<Probe active={active} />));
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  progress = 0;
  onStall.mockReset();
  box = document.createElement('div');
  document.body.append(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
});

describe('useRecordingStallGuard', () => {
  it('V1 30초 무증가 → stalled + onStall 1회', async () => {
    await render(true);
    await advance(35_000);
    expect(latest.stalled).toBe(true);
    expect(onStall).toHaveBeenCalledTimes(1);
  });
  it('V2 29초까지는 정상', async () => {
    await render(true);
    await advance(25_000);
    expect(latest.stalled).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
  });
  it('V3 정지가 이어져도 자동 복구는 1회만', async () => {
    await render(true);
    await advance(90_000);
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(latest.stalled).toBe(true);
  });
  it('V4 증가가 재개되면 경고 해제, 이후 새 정지는 다시 1회 자동 복구', async () => {
    await render(true);
    await advance(35_000);
    expect(latest.stalled).toBe(true);
    progress = 5;
    await advance(5_000);
    expect(latest.stalled).toBe(false);
    await advance(40_000);
    expect(latest.stalled).toBe(true);
    expect(onStall).toHaveBeenCalledTimes(2);
  });
  it('V5 active=false(일시정지·마이크 꺼짐)면 60초가 지나도 정지로 보지 않는다', async () => {
    await render(false);
    await advance(60_000);
    expect(latest.stalled).toBe(false);
    expect(onStall).not.toHaveBeenCalled();
  });
  it('V6 일시정지 → 재개 시 재개 시점부터 다시 센다', async () => {
    await render(true);
    await advance(25_000);
    await render(false);
    await advance(60_000);
    await render(true);
    await advance(25_000);
    expect(latest.stalled).toBe(false);
    await advance(10_000);
    expect(latest.stalled).toBe(true);
  });
});
