// SDD-246 T06c — 회원 화면 측정 연결 훅. v2 플래그 on + 웹 + 밴드 착용 + EEG 동의일 때만 WebMeasurementSession 을 돌린다.
// v2 off 면 아무 것도 하지 않는다(현행 useBand 경로 그대로). 앱(native)은 native-measurement facade 경로라 웹 수집을 만들지 않는다.
import { useEffect, useRef, useState } from 'react';
import { isBleSupported } from '../ble';
import { isNativeMeasurementAvailable } from '../native-measurement';
import { isLiveProtocolV2Enabled } from '../session-live/live-flag';
import type { UseLiveV2Result } from '../session-live/use-live-v2';
import type { WorkerLike } from './capture-adapter';
import type { BandReport } from './capture-controller';
import { decideMeasurementPath, type MeasurementPath } from './measurement-path';
import { WebMeasurementSession, type WebMeasurementStatus } from './web-measurement-session';

export interface UseWebMeasurementOptions {
  liveV2: UseLiveV2Result | null;
  sessionId: string;
  selfParticipantId: string | null;
  /** 회차 LINK BAND 사용(linkband_mode !== 'none') */
  bandOptIn: boolean;
  eegConsent: boolean;
  bandConnected: boolean;
  band: BandReport | null;
  /** 대기열·종료 등 측정하지 않을 화면 */
  enabled: boolean;
}

export interface UseWebMeasurementResult {
  path: MeasurementPath;
  status: WebMeasurementStatus;
  code: string | null;
}

const createCoreWorker = (): WorkerLike =>
  new Worker(new URL('./core.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export function useWebMeasurementV2(o: UseWebMeasurementOptions): UseWebMeasurementResult {
  const v2 = o.enabled && o.liveV2 !== null && isLiveProtocolV2Enabled();
  const path = decideMeasurementPath({
    v2,
    native: isNativeMeasurementAvailable(),
    webBluetooth: isBleSupported(),
    bandConnected: o.bandConnected,
    eegConsent: o.eegConsent,
    bandOptIn: o.bandOptIn,
  });
  const client = o.liveV2?.client ?? null;
  const ready = o.liveV2?.ready ?? false;
  const [status, setStatus] = useState<WebMeasurementStatus>('idle');
  const [code, setCode] = useState<string | null>(null);
  const sessionRef = useRef<WebMeasurementSession | null>(null);
  // READY 가 된 뒤 한 번 시작한다. 이후 DEGRADED 로 잠시 떨어져도 수집은 유지(전송만 대기열에서 기다린다).
  const canStart = path === 'web_wasm' && client !== null && ready;
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (canStart) setArmed(true);
    if (path !== 'web_wasm' || client === null) setArmed(false);
  }, [canStart, path, client]);

  useEffect(() => {
    if (!armed || client === null) return undefined;
    const s = new WebMeasurementSession({
      client,
      sessionId: o.sessionId,
      createWorker: createCoreWorker,
      onStatus: (st, c) => { setStatus(st); setCode(c); },
    });
    sessionRef.current = s;
    void s.start({ eegConsent: true, bandConnected: true });
    return () => {
      sessionRef.current = null;
      void s.stop('client_stopped');
    };
  }, [armed, client, o.sessionId]);

  const self = o.selfParticipantId;
  const myDevice = self ? o.liveV2?.state?.devices[self]?.data : undefined;
  useEffect(() => {
    if (myDevice) sessionRef.current?.observeDevice(myDevice);
  }, [myDevice]);

  useEffect(() => {
    if (o.band) void sessionRef.current?.reportBand(o.band);
  }, [o.band, status]);

  return { path, status: path === 'web_wasm' ? status : 'idle', code: path === 'web_wasm' ? code : null };
}
