// SDD-293 — 밴드 단계 완료 직후 네이티브 보류 인계 훅(앱 로그인 회원 전용). 측정 시작(capture.start)은 하지 않는다.
// 클래스가 시작되지 않고 화면을 떠나면(want=false·live=false, 언마운트) 네이티브가 밴드를 해제한다.
import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { bluetoothService } from '../eeg/bluetoothService';
import { getNativeMeasurement, isNativeMeasurementAvailable } from '../native-measurement';
import { getBandHold } from '../native-measurement/band-hold';
import { isLiveProtocolV2Enabled } from '../session-live/live-flag';

export interface HoldWantInput {
  native: boolean; platform: string; guest: boolean; v2: boolean; bandOptIn: boolean; eegConsent: boolean;
  /** 밴드 단계를 "연결됨"으로 마쳤고 아직 클래스 시작 전이거나 진행 중 */
  bandDone: boolean;
}
/** 보류 인계를 원하는가(순수). 게스트·웹·미동의·밴드 없이 참여는 현행 JS 경로 */
export function shouldHoldBand(i: HoldWantInput): boolean {
  return i.native && (i.platform === 'ios' || i.platform === 'android') && !i.guest && i.v2 && i.bandOptIn && i.eegConsent && i.bandDone;
}

export function useNativeBandHold(o: { want: HoldWantInput; live: boolean }): void {
  const want = shouldHoldBand(o.want);
  const wantRef = useRef(want); wantRef.current = want;
  const liveRef = useRef(o.live); liveRef.current = o.live;
  const inflight = useRef(false);
  const release = (): void => { if (getBandHold().held) void getNativeMeasurement().releaseHeldBand(); };

  useEffect(() => {
    if (!want) { if (!liveRef.current) release(); return; }
    if (getBandHold().held || inflight.current) return;
    if (!bluetoothService.isConnected()) return;
    inflight.current = true;
    void getNativeMeasurement().adoptBand({
      platform: Capacitor.getPlatform(), deviceId: bluetoothService.getDeviceId() || null,
      releaseJsBand: () => bluetoothService.releaseForNative(),
    }).finally(() => {
      inflight.current = false;
      if (!wantRef.current && !liveRef.current) release();
    });
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps -- release/ref 만 쓴다

  useEffect(() => () => { release(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

export const holdEnvironment = (): { native: boolean; platform: string; v2: boolean } =>
  ({ native: isNativeMeasurementAvailable(), platform: Capacitor.getPlatform(), v2: isLiveProtocolV2Enabled() });
