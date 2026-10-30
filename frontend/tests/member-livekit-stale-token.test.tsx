// @vitest-environment jsdom
// 발언권 이벤트가 DB 커밋보다 먼저 도착해 구독 전용 토큰을 받았을 때 송출 권한 토큰으로 다시 받는지 검증한다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getToken = vi.fn();
const handlers: Array<(e: unknown) => void> = [];
vi.mock('../src/lib/api/class-flow', () => ({
  getEntryLiveKitToken: (...a: unknown[]) => getToken(...a),
  raiseEntryHand: vi.fn(),
  lowerEntryHand: vi.fn(),
}));
vi.mock('../src/lib/socket', () => ({
  getActiveSessionLiveSocket: () => ({ on() {}, off() {}, connected: true }),
  getSessionLiveSocket: () => ({ on() {}, off() {}, connected: true }),
  joinSessionLive: vi.fn(),
  subscribeSpeakingChanged: (_s: unknown, h: (e: unknown) => void) => { handlers.push(h); return () => undefined; },
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
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  handlers.length = 0;
  getToken.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

describe('회원 송출 권한 토큰', () => {
  it('발언권 부여 직후 토큰이 구독 전용이면 송출 권한이 올 때까지 재발급한다', async () => {
    getToken
      .mockResolvedValueOnce({ livekit_token: 't0', webrtc_room_id: 'r', can_publish: false })
      .mockResolvedValueOnce({ livekit_token: 't1', webrtc_room_id: 'r', can_publish: false }) // 커밋 전 조회
      .mockResolvedValue({ livekit_token: 't2', webrtc_room_id: 'r', can_publish: true });
    await act(async () => { root.render(<Probe />); });
    await act(async () => { await holder.api!.connect(); });
    expect(holder.api!.canPublish).toBe(false);
    await act(async () => { handlers.forEach((h) => h({ participant_id: 'p1', session_id: 's1', speaking: true, raise_hand: false })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(holder.api!.canPublish).toBe(true);
    expect(holder.api!.token).toBe('t2');
  });
});
