// 상담사(호스트) 앱 복귀 시 LiveKit 복구 (SDD-222 T-J10, plan §3.4a ②③)
// 순서: ② 연결 확인(끊겼으면 재연결 요청) → ③ 카메라가 켜짐 상태였다면 재발행.
// 각 단계는 독립 try/catch — 한 단계 실패가 나머지를 막지 않는다.

import { ConnectionState } from 'livekit-client';

/** 복구에 필요한 LiveKit Room 의 최소 형태 (테스트에서 목으로 대체) */
export interface HostRoomLike {
  state: ConnectionState;
  localParticipant: { setCameraEnabled: (enabled: boolean) => Promise<unknown> };
}

interface RecoverHostLiveKitArgs {
  room: HostRoomLike;
  /** 지금 원하는 카메라 상태 */
  camOn: boolean;
  /** 연결이 끊겨 있을 때 LiveKit 연결을 새로 맺도록 요청한다 */
  reconnect: () => void;
}

export async function recoverHostLiveKit({ room, camOn, reconnect }: RecoverHostLiveKitArgs): Promise<void> {
  // SDK 가 이미 연결 중·재연결 중이면 건드리지 않는다(불필요한 재연결 방지, V37).
  if (room.state === ConnectionState.Disconnected) {
    try {
      reconnect();
    } catch (error: unknown) {
      console.warn('[host-resume] LiveKit 재연결 요청 실패', error);
    }
    // 끊긴 상태에서는 발행할 수 없다 — 재연결 뒤 BridgeProbe 의 camOn 효과가 카메라를 다시 켠다.
    return;
  }
  if (room.state !== ConnectionState.Connected || !camOn) return;
  try {
    // 백그라운드에서 OS 가 카메라 트랙을 중단시켰어도 다시 발행되도록 재호출한다.
    await room.localParticipant.setCameraEnabled(true);
  } catch (error: unknown) {
    console.warn('[host-resume] 카메라 복구 실패', error);
  }
}
