// SDD-305 — `NativeMeasurement` Capacitor 플러그인 프록시의 단일 등록 지점.
// 측정 파사드와 인증 bridge 가 같은 프록시를 쓰도록 여기서만 registerPlugin 한다(중복 등록 경고 방지).
// 순환 import 를 피하려고 @capacitor/core 와 타입만 가져온다.
import { registerPlugin } from '@capacitor/core';
import type { NativeMeasurementPlugin } from '../native-measurement/types';

let proxy: NativeMeasurementPlugin | null = null;

export function getMeasurementPlugin(): NativeMeasurementPlugin {
  if (!proxy) proxy = registerPlugin<NativeMeasurementPlugin>('NativeMeasurement');
  return proxy;
}
