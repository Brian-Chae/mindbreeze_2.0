// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const raise = vi.fn();
const lower = vi.fn();
vi.mock('../src/lib/api/class-flow', () => ({
  getEntryLiveKitToken: vi.fn(),
  raiseEntryHand: (...a: unknown[]) => raise(...a),
  lowerEntryHand: (...a: unknown[]) => lower(...a),
}));
vi.mock('../src/lib/socket', () => ({
  getActiveSessionLiveSocket: () => null,
  getSessionLiveSocket: () => ({ on() {}, off() {}, connected: false }),
  joinSessionLive: vi.fn(),
  subscribeSpeakingChanged: () => () => undefined,
}));
vi.mock('../src/hooks/use-mobile-swipe-protection', () => ({ useMobileSwipeProtection: () => undefined }));

import { useMemberLiveKit } from '../src/hooks/useMemberLiveKit';

type Api = ReturnType<typeof useMemberLiveKit>;
const holder: { api: Api | null } = { api: null };
let container: HTMLDivElement;
let root: Root;
function Probe() {
  holder.api = useMemberLiveKit({ participantId: 'p1', entryCredential: 'c', sessionId: 's1' });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  raise.mockReset(); lower.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('회원 손들기 낙관적 갱신', () => {
  it('손들기: POST 응답 전에 즉시 raisedHand=true, 실패하면 롤백', async () => {
    let reject!: (e: Error) => void;
    raise.mockReturnValue(new Promise<void>((_, r) => { reject = r; }));
    await act(async () => { root.render(<Probe />); });
    await act(async () => { void holder.api!.raiseHand(); });
    expect(holder.api!.raisedHand).toBe(true);
    await act(async () => { reject(new Error('x')); });
    expect(holder.api!.raisedHand).toBe(false);
    expect(holder.api!.raiseHandError).toBeTruthy();
  });

  it('손내리기: POST 응답 전에 즉시 raisedHand=false, 실패하면 손든 상태로 롤백', async () => {
    raise.mockResolvedValue(undefined);
    await act(async () => { root.render(<Probe />); });
    await act(async () => { await holder.api!.raiseHand(); });
    expect(holder.api!.raisedHand).toBe(true);
    let reject!: (e: Error) => void;
    lower.mockReturnValue(new Promise<void>((_, r) => { reject = r; }));
    await act(async () => { void holder.api!.lowerHand(); });
    expect(holder.api!.raisedHand).toBe(false);
    await act(async () => { reject(new Error('x')); });
    expect(holder.api!.raisedHand).toBe(true);
  });
});
