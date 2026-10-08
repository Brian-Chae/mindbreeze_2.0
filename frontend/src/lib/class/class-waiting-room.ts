import { isBleSupported } from '../ble';
// 입장 전 대기실 — 순수 로직(닉네임 확정 · 입장 게이트).
// 컴포넌트(ClassWaitingRoom.tsx)와 함께 사용한다.
//
// 입장 게이트는 이름 확인 + 3단계 준비(설문·링크밴드·기기)를 모두 마쳐야 통과한다.
// 각 단계는 건너뛰기로도 완료 처리된다. 카메라·마이크는 시스템이 자동 확인하고
// 문제가 있을 때만 안내한다(입장을 막지 않는다). 설문·링크밴드·기기 3단계 완료가 입장 게이트다(Q2 확정).

/** 확정한 게스트 닉네임 보관 키(sessionStorage) — 새로고침 시에도 대기실 입력이 유지된다. */
export const WAITING_ROOM_NICKNAME_KEY = 'mb_waiting_room_nickname';

/** 닉네임 최대 길이 — 화면·영상 타일에 표시되는 이름이라 짧게 제한한다. */
export const NICKNAME_MAX_LENGTH = 20;

/** 카메라/마이크 장치 상태. denied/unsupported 는 동작상 off 와 같고 안내 문구만 다르다. */
export type WaitingRoomDeviceState =
  | 'pending'
  | 'on'
  | 'off'
  | 'denied'
  | 'unsupported';

/** 앞뒤 공백·연속 공백을 정리하고 길이를 제한한다(빈 이름은 유효하지 않다). */
export function normalizeNickname(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX_LENGTH);
}

export function isNicknameValid(nickname: string): boolean {
  return normalizeNickname(nickname).length > 0;
}

/** 확정 닉네임 복원 — 저장이 차단된 환경(프라이빗 모드)에서도 예외 없이 null 을 돌려준다. */
export function readStoredNickname(): string | null {
  try {
    const raw = sessionStorage.getItem(WAITING_ROOM_NICKNAME_KEY);
    if (!raw) return null;
    const normalized = normalizeNickname(raw);
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

/** 확정 닉네임 저장 — 실패해도 현재 화면 동작에는 영향이 없다. */
export function storeNickname(nickname: string): void {
  try {
    sessionStorage.setItem(WAITING_ROOM_NICKNAME_KEY, normalizeNickname(nickname));
  } catch {
    /* 저장 실패는 무시 */
  }
}

export function clearStoredNickname(): void {
  try {
    sessionStorage.removeItem(WAITING_ROOM_NICKNAME_KEY);
  } catch {
    /* ignore */
  }
}

export interface WaitingRoomGateInput {
  /** 확정한 닉네임(회원은 프로필 이름) */
  nickname: string;
  /** 3단계 준비(설문·링크밴드·기기) 완료 여부 — 모두 완료해야 입장 버튼이 활성화된다 */
  readiness?: {
    surveyDone: boolean;
    bandDone: boolean;
    deviceDone: boolean;
  };
}

export interface WaitingRoomGateResult {
  canEnter: boolean;
  /** 아직 확인하지 않은 항목 라벨 — 버튼 비활성 사유 안내에 쓴다 */
  missing: string[];
}

/**
 * 입장 가능 여부를 계산한다 — 이름 확인 + 3단계 준비(설문·링크밴드·기기)를 모두 마쳐야 입장한다.
 * 각 단계는 건너뛰기로도 완료 처리되므로 '작성'이 필수가 아니라 '단계 통과'가 필수다.
 */
export function resolveWaitingRoomGate(input: WaitingRoomGateInput): WaitingRoomGateResult {
  const missing: string[] = [];
  if (!isNicknameValid(input.nickname)) missing.push('이름 확인');
  if (!input.readiness?.surveyDone) missing.push('설문');
  if (!input.readiness?.bandDone) missing.push('링크밴드');
  if (!input.readiness?.deviceDone) missing.push('기기 테스트');
  return { canEnter: missing.length === 0, missing };
}

/** 장치 상태 → 화면 표시 문구 */
export function deviceStateLabel(state: WaitingRoomDeviceState, device: '카메라' | '마이크'): string {
  switch (state) {
    case 'pending':
      return `${device} 권한 확인 중…`;
    case 'on':
      return `${device} 켜짐`;
    case 'off':
      return `${device} 꺼짐`;
    case 'denied':
      return `${device} 권한이 거부되었습니다`;
    case 'unsupported':
      return `이 브라우저는 ${device}를 지원하지 않습니다`;
  }
}

/** getUserMedia 오류 → 안내 문구(대기실은 차단하지 않고 이유만 알려준다) */
export function mediaErrorMessage(err: unknown, device: '카메라' | '마이크'): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `${device} 권한이 거부되었습니다. 주소창의 권한 설정을 확인해 주세요.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `사용 가능한 ${device}를 찾지 못했습니다. 장치 연결을 확인해 주세요.`;
  }
  if (name === 'NotReadableError') {
    return `다른 앱이 ${device}를 사용 중입니다. 종료 후 다시 시도해 주세요.`;
  }
  return err instanceof Error ? err.message : `${device}를 열지 못했습니다.`;
}

/** Web Bluetooth 지원 여부 — LINK BAND 확인 카드의 안내 분기용(게이트와 무관) */
export function isBluetoothSupported(): boolean {
  return isBleSupported();
}
