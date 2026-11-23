// SDD-333: 밴드 안내 우선순위(순수). 블루투스가 꺼져 있으면 "밴드 깨우기"(SDD-331)보다 먼저 꺼짐 안내를 보인다.
// 꺼짐 상태에서 밴드 깨우기를 안내하면 사용자가 엉뚱한 곳을 찾는다.

export type BandNotice = 'bluetooth_off' | 'wake' | 'none';

export interface BandNoticeInput {
  /** true 꺼짐 / false 켜짐 / null 알 수 없음 */
  bluetoothOff: boolean | null;
  wakeHint: boolean;
}

export function pickBandNotice({ bluetoothOff, wakeHint }: BandNoticeInput): BandNotice {
  if (bluetoothOff === true) return 'bluetooth_off';
  return wakeHint ? 'wake' : 'none';
}

/** 켜기 요청 뒤 안내 문구 — iOS 는 시스템 알림이 안 뜰 수 있어 제어센터 안내를 덧붙인다. */
export function bluetoothOffHelp(platform: 'android' | 'ios' | 'web', asked: boolean): string {
  if (platform === 'ios') {
    return asked
      ? '알림이 보이지 않으면 화면 가장자리를 쓸어내려 제어센터에서 Bluetooth를 켜 주세요. 설정 열기에서 앱의 Bluetooth 허용도 확인할 수 있어요.'
      : 'Bluetooth를 켜면 LINK BAND를 다시 찾아요.';
  }
  return 'Bluetooth를 켜면 LINK BAND를 바로 다시 찾아요. 끊긴 동안 측정된 값은 이 기기에 보관돼요.';
}
