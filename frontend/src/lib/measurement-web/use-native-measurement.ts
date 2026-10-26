// SDD-246 T12 — 앱(iOS/Android) 회원 측정 자동 시작 훅. path==='native' 일 때만 동작한다(웹/legacy/off 는 아무 것도 안 함).
// 밴드가 연결되면 JS 소유를 놓고 native manager 에 인계해 startMeasurement. 화면을 떠날 때만 stopMeasurement.
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { BASE_URL, getNativeRefreshBody, tokenStorage } from '../api/client';
import { bluetoothService } from '../eeg/bluetoothService';
import { SOCKET_URL } from '../socket';
import { buildNativeModelPayload, getNativeMeasurement } from '../native-measurement';
import { getActiveModelCache, refreshActiveModel } from '../eeg/eegPersonalScore';
import { decideMeasurementPath, type MeasurementPath } from './measurement-path';
import { isLiveProtocolV2Enabled } from '../session-live/live-flag';
import { isNativeMeasurementAvailable } from '../native-measurement';
import type { MeasurementSnapshot } from '../native-measurement/types';
import type { MetricSnapshot } from '../../components/class/player/member/member-metrics';

export type NativeMeasurementStatus = 'idle' | 'starting' | 'running' | 'failed';

export interface UseNativeMeasurementOptions {
  v2: boolean;
  sessionId: string;
  participantId: string | null;
  accountId: string | null;
  bandOptIn: boolean;
  eegConsent: boolean;
  bandConnected: boolean;
  enabled: boolean;
}
export interface UseNativeMeasurementResult {
  path: MeasurementPath;
  status: NativeMeasurementStatus;
  code: string | null;
  /** native 소유 동안 회원 6지표(null 보존). 아니면 null */
  metrics: MetricSnapshot | null;
}

/** sessionId+participantId 로 결정되는 UUID 형식 requestId(멱등) */
export function deterministicRequestId(sessionId: string, participantId: string): string {
  const src = `native-start:${sessionId}:${participantId}`;
  const parts: number[] = [];
  for (let seed = 0; seed < 4; seed += 1) {
    let h1 = 0xdeadbeef ^ seed; let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < src.length; i += 1) {
      const c = src.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    parts.push(h1 >>> 0);
  }
  const hex = parts.map((n) => n.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const KEYS = { focus: 'focus_display', relaxation: 'relaxation_display', emotional: 'emotion_display', bpm: 'bpm', respiration: 'respiration', hrv: 'sdnn' } as const;

/** snapshot.metrics → 6지표. 값 없음/미보고는 null 그대로(0 치환 금지) */
export function toMetricSnapshot(s: MeasurementSnapshot): MetricSnapshot {
  const m = s.metrics?.metrics ?? {};
  const pick = (k: string): number | null => {
    const v = m[k]?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return {
    focus: pick(KEYS.focus), relaxation: pick(KEYS.relaxation), emotional: pick(KEYS.emotional),
    bpm: pick(KEYS.bpm), respiration: pick(KEYS.respiration), hrv: pick(KEYS.hrv),
  };
}

export function useNativeMeasurementV2(o: UseNativeMeasurementOptions): UseNativeMeasurementResult {
  const path = decideMeasurementPath({
    v2: o.v2 && o.enabled && isLiveProtocolV2Enabled(), native: isNativeMeasurementAvailable(),
    webBluetooth: false, bandConnected: o.bandConnected, eegConsent: o.eegConsent, bandOptIn: o.bandOptIn,
  });
  const [status, setStatus] = useState<NativeMeasurementStatus>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricSnapshot | null>(null);
  const instanceRef = useRef<string>(crypto.randomUUID());
  const startedRef = useRef(false);
  // 시작 후에는 래치한다: Android 는 JS 연결을 일부러 놓으므로 useBand 의 connectionState 가 풀려도 native 측정은 계속한다.
  const ready = path === 'native' && (o.bandConnected || startedRef.current) && Boolean(o.participantId && o.accountId);

  useEffect(() => {
    if (!ready || !o.participantId || !o.accountId) return undefined;
    const access = tokenStorage.getAccess();
    const refresh = getNativeRefreshBody()?.refresh_token ?? '';
    const platform = Capacitor.getPlatform();
    const facade = getNativeMeasurement();
    let cancelled = false;
    let off: (() => void) | null = null;
    const requestId = deterministicRequestId(o.sessionId, o.participantId);
    if (!access || !refresh || (platform !== 'ios' && platform !== 'android')) {
      setStatus('failed'); setCode(!access || !refresh ? 'credentials_unavailable' : 'platform_unsupported');
      return undefined;
    }
    setStatus('starting'); setCode(null);
    void (async () => {
      try {
        await facade.attach(o.sessionId);
        if (cancelled) return;
        off = facade.onMeasurement((snap) => { if (!cancelled) setMetrics(toMetricSnapshot(snap)); });
        const deviceId = bluetoothService.getDeviceId() || bluetoothService.getCachedDeviceId();
        // 웹과 같은 규칙: 서버 활성 표준 모델 > 코호트. 시작 시 1회 조회해 넘기고, 이후 교체는 네이티브가 막는다(pin).
        const model = buildNativeModelPayload(getActiveModelCache() ?? (await refreshActiveModel().catch(() => null)));
        if (cancelled) return;
        await facade.startForSession({
          platform, sessionId: o.sessionId, requestId, accountId: o.accountId as string, apiBase: BASE_URL, socketBase: SOCKET_URL,
          instanceId: instanceRef.current, deviceId: deviceId || null, tokens: { accessToken: access, refreshToken: refresh }, model,
          ...(platform === 'android' ? { releaseJsBand: () => bluetoothService.releaseForNative() } : {}),
        });
        if (cancelled) return;
        startedRef.current = true;
        setStatus('running');
      } catch (err) {
        if (cancelled) return;
        setStatus('failed'); setCode(err instanceof Error ? err.message : 'native_start_failed');
      }
    })();
    return () => {
      cancelled = true;
      off?.();
      void facade.detach();
      if (startedRef.current) {
        startedRef.current = false;
        void facade.stop({ reason: 'user_left', requestId: crypto.randomUUID() }).catch(() => undefined);
      }
      setMetrics(null);
    };
  }, [ready, o.sessionId, o.participantId, o.accountId]);

  return { path, status: path === 'native' ? status : 'idle', code: path === 'native' ? code : null, metrics: path === 'native' && status === 'running' ? metrics : null };
}
