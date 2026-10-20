// SDD-222 T-J10 — 호스트 복귀 시 LiveKit 확인·카메라 복구 (V36·V37·V38)
import { describe, expect, it, vi } from 'vitest';
import { ConnectionState } from 'livekit-client';
import { recoverHostLiveKit, type HostRoomLike } from '../src/lib/native/host-resume-recovery';

function makeRoom(state: ConnectionState, setCameraEnabled = vi.fn(async () => undefined)): HostRoomLike {
  return { state, localParticipant: { setCameraEnabled } };
}

describe('recoverHostLiveKit', () => {
  it('V37 이미 연결(또는 SDK 가 재연결 중)이면 재연결을 요청하지 않는다', async () => {
    for (const state of [ConnectionState.Connected, ConnectionState.Reconnecting, ConnectionState.Connecting]) {
      const reconnect = vi.fn();
      await recoverHostLiveKit({ room: makeRoom(state), camOn: false, reconnect });
      expect(reconnect).not.toHaveBeenCalled();
    }
  });

  it('V36 연결이 끊겨 있으면 재연결을 요청하고, 연결 전이므로 카메라는 건드리지 않는다', async () => {
    const reconnect = vi.fn();
    const setCam = vi.fn(async () => undefined);
    await recoverHostLiveKit({ room: makeRoom(ConnectionState.Disconnected, setCam), camOn: true, reconnect });
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(setCam).not.toHaveBeenCalled(); // 재연결 후 BridgeProbe 의 camOn 효과가 발행한다
  });

  it('V38 연결 상태에서 카메라가 켜짐이면 setCameraEnabled(true) 를 재호출한다', async () => {
    const setCam = vi.fn(async () => undefined);
    await recoverHostLiveKit({ room: makeRoom(ConnectionState.Connected, setCam), camOn: true, reconnect: vi.fn() });
    expect(setCam).toHaveBeenCalledWith(true);
  });

  it('V38 카메라가 꺼짐이면 호출하지 않는다', async () => {
    const setCam = vi.fn(async () => undefined);
    await recoverHostLiveKit({ room: makeRoom(ConnectionState.Connected, setCam), camOn: false, reconnect: vi.fn() });
    expect(setCam).not.toHaveBeenCalled();
  });

  it('V36 카메라 복구가 실패해도 예외를 던지지 않는다', async () => {
    const setCam = vi.fn(async () => { throw new Error('NotAllowedError'); });
    await expect(
      recoverHostLiveKit({ room: makeRoom(ConnectionState.Connected, setCam), camOn: true, reconnect: vi.fn() }),
    ).resolves.toBeUndefined();
  });

  it('V36 재연결 요청이 예외를 던져도 예외를 전파하지 않는다', async () => {
    const reconnect = vi.fn(() => { throw new Error('boom'); });
    await expect(
      recoverHostLiveKit({ room: makeRoom(ConnectionState.Disconnected), camOn: true, reconnect }),
    ).resolves.toBeUndefined();
  });
});
