// SDD-246 T06c — 측정 경로 판정(화면이 측정을 시작할지·어느 경로로 할지). 순수 함수.
// LINK BAND 는 선택(opt-in)이다: 미착용·EEG 미동의·Web Bluetooth 미지원이면 측정 없이 수업은 그대로 진행한다.
export type MeasurementPath = 'legacy' | 'off' | 'web_wasm' | 'native';

export interface MeasurementPathInput {
  /** live protocol v2 플래그(off 면 현행 useBand 경로 그대로) */
  v2: boolean;
  /** Capacitor 앱(iOS/Android) — 측정·live 전송은 native manager 가 소유한다 */
  native: boolean;
  /** navigator.bluetooth 지원(웹) */
  webBluetooth: boolean;
  /** 웹: 밴드가 지금 연결돼 있음. native 는 밴드를 native 가 잡으므로 판정에 쓰지 않는다 */
  bandConnected: boolean;
  /** 회차 EEG 수집 동의 */
  eegConsent: boolean;
  /** 회차가 LINK BAND 를 쓰는 수업인지(linkband_mode !== 'none') */
  bandOptIn: boolean;
  /** 코드 입장 게스트(로그인 계정 없음). 네이티브는 계정 JWT 가 있어야 시작되므로 앱에서도 JS BLE + WASM(web_wasm)으로 측정한다 */
  guest?: boolean;
  /** SDD-284: 네이티브 스트림 확정 실패가 반복돼 웹 경로로 단방향 하강한 회차. undefined=현행 동작 */
  nativeFailed?: boolean;
}

export function decideMeasurementPath(i: MeasurementPathInput): MeasurementPath {
  if (!i.v2) return 'legacy';
  if (!i.bandOptIn || !i.eegConsent) return 'off';
  if (i.native && !i.guest && !i.nativeFailed) return 'native';
  if (!i.webBluetooth || !i.bandConnected) return 'off';
  return 'web_wasm';
}
