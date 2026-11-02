// SDD-246 T12 — 앱(iOS/Android) 회원 측정 자동 시작 훅. path==='native' 일 때만 동작한다(웹/legacy/off 는 아무 것도 안 함).
// 밴드가 연결되면 JS 소유를 놓고 native manager 에 인계해 startMeasurement. 화면을 떠날 때만 stopMeasurement.
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { BASE_URL, getNativeRefreshBody, tokenStorage } from '../api/client';
import { bluetoothService } from '../eeg/bluetoothService';
import { SOCKET_URL } from '../socket';
import { buildNativeModelPayload, getNativeMeasurement } from '../native-measurement';
import { getActiveModelCache, refreshActiveModel } from '../eeg/eegPersonalScore';
import { uploadProgressStore } from './upload-progress';
import { decideMeasurementPath, type MeasurementPath } from './measurement-path';
import { isLiveProtocolV2Enabled } from '../session-live/live-flag';
import { isNativeMeasurementAvailable } from '../native-measurement';
import type { MeasurementSnapshot } from '../native-measurement/types';
import { toNativeDevice, type NativeDeviceState } from '../native-measurement/device-status';
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
  /** native 소유 동안 기기 메뉴용 신호·접촉·연결(JS BLE 는 놓았으므로 native snapshot 에서). 아니면 null */
  device: NativeDeviceState | null;
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

/**
 * 네이티브 측정을 시작해도 되는가(순수). JS BLE 연결 순간에 묶지 않는다.
 * - 이미 시도/실행 중(latched)이면 JS 연결이 풀려도(releaseForNative) 유지한다.
 * - iOS: 저장된 기기 ID 가 없어도 네이티브가 스캔으로 밴드를 찾는다.
 * - Android: 주소(MAC) 가 필요하므로 JS 연결 중이거나 캐시된 기기 ID 가 있어야 한다.
 */
export function shouldStartNative(i: {
  path: MeasurementPath; hasIds: boolean; platform: string; bandConnected: boolean; latched: boolean; knownDeviceId: string | null;
}): boolean {
  if (i.path !== 'native' || !i.hasIds) return false;
  if (i.latched || i.bandConnected || Boolean(i.knownDeviceId)) return true;
  return i.platform === 'ios';
}

/** effect 정리 직후 같은 회차로 곧바로 재실행되면(bandSkipped 토글 등) stop→start 를 만들지 않고 제자리에서 재연결한다. */
export function shouldRestartNativeInPlace(i: { active: boolean; sameSession: boolean }): boolean {
  return i.active && i.sameSession;
}

/** 정리 후 이 시간 안에 같은 회차로 재실행되면 stop 을 취소한다(실제 이탈이면 이 시간 뒤 stop) */
const STOP_GRACE_MS = 2500;
const RETRY_MAX = 5;
const RETRY_BASE_MS = 3000;

export function useNativeMeasurementV2(o: UseNativeMeasurementOptions): UseNativeMeasurementResult {
  const path = decideMeasurementPath({
    v2: o.v2 && o.enabled && isLiveProtocolV2Enabled(), native: isNativeMeasurementAvailable(),
    webBluetooth: false, bandConnected: o.bandConnected, eegConsent: o.eegConsent, bandOptIn: o.bandOptIn,
    guest: !o.accountId, // 게스트는 네이티브를 시작하지 않는다(웹 훅이 web_wasm 으로 측정)
  });
  const [status, setStatus] = useState<NativeMeasurementStatus>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricSnapshot | null>(null);
  const [device, setDevice] = useState<NativeDeviceState | null>(null);
  const instanceRef = useRef<string>(crypto.randomUUID());
  const startedRef = useRef(false);
  // 시도 시작 시점부터 래치한다: startForSession 이 JS 연결을 놓으면 useBand 의 connectionState 가 풀려
  // ready 가 꺼지고, 그러면 진행 중이던 시작이 cancelled 처리돼 리스너·재시도가 사라졌다.
  const latchedRef = useRef(false);
  const retryRef = useRef(0);
  // 한 번 성공한 밴드 ID — releaseForNative 가 JS 캐시 ID 를 지우므로 재시작 때 이 값을 네이티브에 넘긴다(iOS 스캔만 하다 실패 방지)
  const lastGoodDeviceIdRef = useRef<string | null>(null);
  // 정리 직후 유예 중인 stop 과 그 대상 키 — 같은 키로 곧바로 재실행되면 stop 을 취소하고 재시작하지 않는다
  const pendingStopRef = useRef<{ timer: ReturnType<typeof setTimeout>; key: string } | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const prevDepsRef = useRef<string>('');
  // 화면 언마운트(실제 이탈)는 즉시 stop 한다 — 유예는 입력 변화로 effect 만 다시 도는 경우에만 쓴다. 이 effect 가 메인 effect 보다 먼저 선언돼 정리도 먼저 실행된다.
  const unmountingRef = useRef(false);
  useEffect(() => {
    unmountingRef.current = false;
    return () => { unmountingRef.current = true; };
  }, []);
  const [retryTick, setRetryTick] = useState(0);
  const ready = shouldStartNative({
    path, hasIds: Boolean(o.participantId && o.accountId), platform: Capacitor.getPlatform(), bandConnected: o.bandConnected,
    latched: latchedRef.current, knownDeviceId: bluetoothService.getDeviceId() || bluetoothService.getCachedDeviceId() || null,
  });

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
    const key = `${o.sessionId}:${o.participantId}:${o.accountId}`;
    // 시작 사유·직전 effect 와 달라진 입력을 남긴다(현장 재시작 원인 확정용)
    const depsNow = JSON.stringify({ ready, retryTick, s: o.sessionId, p: o.participantId, a: o.accountId });
    console.info('[native-measurement] start_reason', { reason: pendingStopRef.current ? 'resume_in_grace' : retryTick > 0 ? 'retry' : 'initial', changed: prevDepsRef.current === depsNow ? 'none' : { prev: prevDepsRef.current, now: depsNow } });
    prevDepsRef.current = depsNow;
    const pending = pendingStopRef.current;
    const resumeInPlace = pending !== null && shouldRestartNativeInPlace({ active: true, sameSession: pending.key === key });
    if (pending) { clearTimeout(pending.timer); pendingStopRef.current = null; }
    latchedRef.current = true;
    setStatus('starting'); setCode(null);
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      try {
        await facade.attach(o.sessionId);
        if (cancelled) return;
        off = facade.onMeasurement((snap) => { if (!cancelled) { setMetrics(toMetricSnapshot(snap)); setDevice(toNativeDevice(snap)); } });
        // SDD-260: 저장 진행(feature.counts·archive.counts·reconcile.state) → 전역 스토어. 화면을 떠나도 네이티브가 계속 올리므로 detach 후에도 마지막 값을 남긴다.
        const offUpload = facade.onUploadProgress((patch) => { if (!cancelled) uploadProgressStore.update(o.sessionId, patch); });
        const offMeasurement = off;
        off = () => { offMeasurement(); offUpload(); };
        if (resumeInPlace) {
          // 이미 네이티브가 수집 중 — 새 capture.start 를 만들지 않고 밴드 링크만 다시 잡는다
          await facade.reconnectBand(platform);
          if (cancelled) return;
          startedRef.current = true; activeKeyRef.current = key;
          setStatus('running');
          console.info('[native-measurement] 제자리 재연결(stop→start 생략)', platform);
          return;
        }
        const deviceId = bluetoothService.getDeviceId() || bluetoothService.getCachedDeviceId() || lastGoodDeviceIdRef.current;
        // 웹과 같은 규칙: 서버 활성 표준 모델 > 코호트. 시작 시 1회 조회해 넘기고, 이후 교체는 네이티브가 막는다(pin).
        const model = buildNativeModelPayload(getActiveModelCache() ?? (await refreshActiveModel().catch(() => null)));
        if (cancelled) return;
        await facade.startForSession({
          platform, sessionId: o.sessionId, requestId, accountId: o.accountId as string, apiBase: BASE_URL, socketBase: SOCKET_URL,
          instanceId: instanceRef.current, deviceId: deviceId || null, tokens: { accessToken: access, refreshToken: refresh }, model,
          releaseJsBand: () => bluetoothService.releaseForNative(),
        });
        if (cancelled) return;
        startedRef.current = true; activeKeyRef.current = key;
        if (deviceId) lastGoodDeviceIdRef.current = deviceId;
        retryRef.current = 0;
        setStatus('running');
        console.info('[native-measurement] startForSession 성공', platform);
      } catch (err) {
        console.warn('[native-measurement] 시작 실패', platform, err instanceof Error ? err.message : String(err));
        if (cancelled) return;
        setStatus('failed'); setCode(err instanceof Error ? err.message : 'native_start_failed');
        // 시작 실패 후 재시도 없이 멈추던 문제: 지수 백오프로 다시 시도한다(같은 requestId 는 facade 가 실패 시 비운다).
        if (retryRef.current < RETRY_MAX) {
          const delay = RETRY_BASE_MS * 2 ** retryRef.current;
          retryRef.current += 1;
          retryTimer = setTimeout(() => setRetryTick((n) => n + 1), delay);
        } else {
          latchedRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      off?.();
      void facade.detach();
      latchedRef.current = false;
      if (startedRef.current) {
        startedRef.current = false;
        if (unmountingRef.current) {
          activeKeyRef.current = null;
          void facade.stop({ reason: 'user_left', requestId: crypto.randomUUID() }).catch(() => undefined);
        } else {
        // 즉시 stop 하지 않는다: 입력 흔들림으로 effect 가 다시 도는 경우 stop→start 로 밴드를 잃던 문제. 유예 뒤에도 재실행이 없으면 이탈로 보고 stop.
        console.info('[native-measurement] cleanup → stop 유예', STOP_GRACE_MS, 'ms', { key });
        const timer = setTimeout(() => {
          if (pendingStopRef.current?.timer !== timer) return;
          pendingStopRef.current = null; activeKeyRef.current = null;
          void facade.stop({ reason: 'user_left', requestId: crypto.randomUUID() }).catch(() => undefined);
        }, STOP_GRACE_MS);
        pendingStopRef.current = { timer, key: activeKeyRef.current ?? '' };
        }
      }
      setMetrics(null); setDevice(null);
    };
  }, [ready, retryTick, o.sessionId, o.participantId, o.accountId]);

  return { path, status: path === 'native' ? status : 'idle', code: path === 'native' ? code : null, metrics: path === 'native' && status === 'running' ? metrics : null,
    device: path === 'native' && status === 'running' ? device : null };
}
