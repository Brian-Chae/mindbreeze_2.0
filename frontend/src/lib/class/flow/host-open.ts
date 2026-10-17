// SDD-209 H4 — 클래스 열기 결정(FH05): 마이크 꺼짐 경고 도달 여부 + 열 때 확정하는 장비 사용 값.
// 현행 SessionPreJoinPreview 는 경고 다이얼로그에 도달할 수 없었다(plan §1.2 FH05). 여기서 판정을 순수 함수로 분리한다.
import { needsMicOffWarning, type MediaDeviceUi } from '../class-media';
import type { FlowPlace } from './types';

export interface OpenInput {
  place: FlowPlace;
  mic: MediaDeviceUi;
  cam: MediaDeviceUi;
}

/** `open` = 바로 연다 / `confirm-mic-off` = 마이크 꺼짐 확인 시트를 먼저 보인다 */
export type OpenDecision = 'open' | 'confirm-mic-off';

export function decideOpen(input: OpenInput): OpenDecision {
  return needsMicOffWarning({ place: input.place, micState: input.mic, micWanted: input.mic === 'on' }) ? 'confirm-mic-off' : 'open';
}

export interface OpenPrefs {
  cameraOn: boolean;
  micOn: boolean;
}

/**
 * 열 때 확정하는 장비 사용 값.
 * - 오프라인: 카메라 없음을 명시(기본값 camera:true 가 남아 영상 녹화를 시도하는 것을 막는다). 마이크는 이 기기 녹음용으로 켠 것으로 본다(권한은 녹음 시작 시 요청).
 * - 온라인: 점검 화면의 실제 상태. `forceMicOn` 은 시트의 `마이크 켜고 열기`, `forceMicOff` 는 `꺼진 채로 열기`.
 */
export function resolveOpenPrefs(input: OpenInput, override?: 'mic-on' | 'mic-off'): OpenPrefs {
  if (input.place === 'offline') return { cameraOn: false, micOn: override !== 'mic-off' };
  const cameraOn = input.cam === 'on';
  if (override === 'mic-off') return { cameraOn, micOn: false };
  if (override === 'mic-on') return { cameraOn, micOn: true };
  return { cameraOn, micOn: input.mic === 'on' };
}

/** FH05 하단 보조 줄(상태별) */
export function setupFootNote(place: FlowPlace, mic: MediaDeviceUi, cam: MediaDeviceUi, quiet: boolean): string {
  if (place === 'offline') return '열면 초대한 회원에게 알려요';
  if (mic === 'unsupported' || cam === 'unsupported') return 'Chrome이나 Edge를 권장해요';
  if (mic === 'nodevice' && cam === 'nodevice') return '장비 없이 열면 수동 기록이에요';
  if (mic === 'denied') return '마이크 없이 열면 수동 기록이에요';
  if (mic === 'off' || mic === 'nodevice' || mic === 'inuse') return '열 때 마이크를 한 번 더 확인해요';
  if (cam === 'denied' || cam === 'nodevice' || cam === 'inuse') return '카메라 없이도 열 수 있어요';
  if (quiet) return '소리가 작아요. 조금 더 크게 말해 보세요';
  if (cam === 'off') return '카메라 없이 소리만 열어요';
  return '열면 초대한 회원이 입장할 수 있어요';
}
