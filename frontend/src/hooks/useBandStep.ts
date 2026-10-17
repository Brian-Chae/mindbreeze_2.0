// SDD-209 M4 — FM06c 준비 단계의 LINK BAND 연결 상태. 관찰 전용(observationOnly)이라 업로드·소켓 없이 로컬 스트림만 쓴다.
// 전역 BLE 연결은 유지되므로 진행 화면(MemberClassContainer)의 useBand 가 마운트될 때 그대로 이어받는다.
import { useEffect, useRef, useState } from 'react';
import { useBand } from './useBand';
import type { LeadOffStatus } from '../lib/eeg/types/eeg';
import { deriveBandStep, type BandStepUi } from '../lib/class/band-step';

const TICK_MS = 1000;

export interface UseBandStepResult {
  state: BandStepUi;
  leadOff: LeadOffStatus | null;
  battery: number | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useBandStep(enabled: boolean): UseBandStepResult {
  const band = useBand({ sessionId: '', participantId: null, enabled, observationOnly: true });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const everConnectedRef = useRef(false);
  if (band.connectionState === 'connected') everConnectedRef.current = true;

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const state = deriveBandStep(
    {
      connectionState: band.connectionState,
      everConnected: everConnectedRef.current,
      deviceStatus: band.deviceStatus,
      signalQualityLevel: band.signalQualityLevel,
      battery: band.battery,
      lastEegAt: band.lastEegAt,
    },
    band.leadOff,
    nowMs,
  );
  return { state, leadOff: band.leadOff, battery: band.battery, connect: band.connect, disconnect: band.disconnect };
}
