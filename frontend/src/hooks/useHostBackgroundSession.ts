// 상담사(호스트) 화면의 백그라운드 세션 (SDD-222 T-J10, plan §3.4a)
// ClassPlayerPage 의 useWakeLock(isLobby || isRunning) 과 같은 구간에서, 호스트일 때만 켠다.
// 온라인 수업은 음성 송출 유지를 위해 microphone 타입을 더하고, 오프라인 대면 수업은 connectedDevice 만 쓴다.

import { useBackgroundSession } from './useBackgroundSession';

interface HostBackgroundSessionArgs {
  isHost: boolean;
  isLobby: boolean;
  isRunning: boolean;
  /** 온라인 수업 여부 (location_type === 'online') */
  online: boolean;
  /** 수업 음성 녹음 중 여부 — 녹음 중에는 오프라인 수업도 microphone 타입이 필요하다(백그라운드 마이크) */
  recording?: boolean;
}

export function useHostBackgroundSession({ isHost, isLobby, isRunning, online, recording = false }: HostBackgroundSessionArgs) {
  return useBackgroundSession(isHost && (isLobby || isRunning), 'host', online || recording);
}
