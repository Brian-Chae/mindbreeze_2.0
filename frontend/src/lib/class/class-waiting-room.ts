// 개선 3: 클래스 입장 전 대기실 — 순수 로직(닉네임 확정 · 셀프체크 · 입장 게이트).
// 컴포넌트(ClassWaitingRoom.tsx)와 테스트가 함께 사용한다.
//
// 게이트 설계 원칙(차분한 UX — 입장을 막되 갇히게 하지 않는다):
//   · 기기(카메라·마이크)·스피커는 "확인했는가"만 판정한다. 장치가 없거나 권한이 거부돼도
//     사용자가 그 사실을 확인하면 입장할 수 있다(기기 미비로 영구 차단 금지).
//   · LINK BAND는 선택(opt-in)이므로 게이트에 포함하지 않는다 — 미연결이어도 항상 입장 가능.
//   · 조용한 공간·이어폰은 몰입 품질을 위한 자기 점검이며 모두 체크해야 입장할 수 있다.

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

export type WaitingRoomChecklistId = 'space' | 'headset';

export interface WaitingRoomChecklistItem {
  id: WaitingRoomChecklistId;
  /** 안내 아이콘(이모지) */
  icon: string;
  label: string;
  hint: string;
}

/** 조용한 공간 · 이어폰 셀프체크 — 두 항목 모두 체크해야 입장할 수 있다. */
export const WAITING_ROOM_CHECKLIST: readonly WaitingRoomChecklistItem[] = [
  {
    id: 'space',
    icon: '🤫',
    label: '조용한 공간에서 참여하나요?',
    hint: '주변 소음이 적은 곳이면 몰입에 도움이 됩니다. 휴대폰은 무음으로 두어 주세요.',
  },
  {
    id: 'headset',
    icon: '🎧',
    label: '이어폰·헤드셋을 착용했나요?',
    hint: '스피커로 들으면 하울링(삐—)이 생길 수 있어요. 이어폰 착용을 권장합니다.',
  },
] as const;

/** 셀프체크 체크 상태(항목 id → 체크 여부) */
export type WaitingRoomCheckState = Record<WaitingRoomChecklistId, boolean>;

export function emptyCheckState(): WaitingRoomCheckState {
  return { space: false, headset: false };
}

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
  /** 카메라·마이크 프리뷰를 확인하고 [기기 확인 완료]를 눌렀는가 */
  devicesChecked: boolean;
  /** 스피커 테스트 톤을 재생했는가 */
  speakerVerified: boolean;
  /** 스피커 테스트 지원 여부 — 미지원 브라우저는 확인 없이도 통과시킨다 */
  speakerSupported: boolean;
  /** 셀프체크(조용한 공간·이어폰) 체크 상태 */
  checks: WaitingRoomCheckState;
}

export interface WaitingRoomGateResult {
  canEnter: boolean;
  /** 아직 확인하지 않은 항목 라벨 — 버튼 비활성 사유 안내에 쓴다 */
  missing: string[];
}

/** 입장 가능 여부와 부족한 항목을 계산한다. LINK BAND 는 판정 대상이 아니다(opt-in). */
export function resolveWaitingRoomGate(input: WaitingRoomGateInput): WaitingRoomGateResult {
  const missing: string[] = [];
  if (!isNicknameValid(input.nickname)) missing.push('이름 확인');
  if (!input.devicesChecked) missing.push('카메라·마이크 확인');
  if (input.speakerSupported && !input.speakerVerified) missing.push('스피커 테스트');
  for (const item of WAITING_ROOM_CHECKLIST) {
    if (!input.checks[item.id]) missing.push(item.label);
  }
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
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/** 카메라·마이크 상태가 확정되었는가 — [기기 확인 완료] 버튼 활성 조건 */
export function areDevicesResolved(
  camera: WaitingRoomDeviceState,
  mic: WaitingRoomDeviceState,
): boolean {
  return camera !== 'pending' && mic !== 'pending';
}
