// SDD-326 — 입장 준비(밴드 단계)에서 연결된 밴드의 시리얼을 회차에 보고한다.
// 밴드 단계의 useBand 는 observationOnly(sessionId 없음)라 여기서 회차 컨텍스트로 보낸다.
// 시리얼은 bluetoothService 가 연결 직후 스냅샷해 두므로 네이티브 인계(releaseForNative) 뒤에도 읽힌다.
// 부가 기능: 실패는 무시하고, 밴드를 쓰지 않으면(connected 아님) 아무 동작도 하지 않는다.
import { useEffect } from 'react';
import { putBandDevice } from '../lib/api/class-flow';
import { reportBandDevice } from '../lib/band/band-device-report';
import { bluetoothService } from '../lib/eeg/bluetoothService';
import { getPlatform } from '../lib/native/platform';

/** 펌웨어는 연결 직후 비동기로 읽히므로 뒤늦게 한 번 더 확인한다(같은 값이면 보내지 않는다). */
const FIRMWARE_RECHECK_MS = 3000;

export function useBandSerialReport(o: { sessionId: string | null; credential: string | null; bandConnected: boolean }): void {
  const { sessionId, credential, bandConnected } = o;
  useEffect(() => {
    if (!bandConnected || !sessionId) return undefined;
    const report = (): void => {
      void reportBandDevice(
        { sessionId, credential, identity: bluetoothService.getBandIdentity(), platform: getPlatform() },
        { put: putBandDevice },
      );
    };
    report();
    const timer = window.setTimeout(report, FIRMWARE_RECHECK_MS);
    return () => window.clearTimeout(timer);
  }, [bandConnected, sessionId, credential]);
}
