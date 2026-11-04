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

/** SDD-284: 스트림 확정 감시 임계값(현장 로그 후 조정 가능) */
export const NATIVE_POLL_MS = 2000;
export const NATIVE_CONFIRM_MS = 20_000;
export const NATIVE_HEALTH_MS = 10_000;
/** 스트림 확정 실패·건강 점검 실패가 이 횟수에 이르면 web_wasm 으로 하강한다 */
export const NATIVE_STREAM_FAIL_DESCEND_AT = 3;

/** snapshot 이 "스트림 확정" 상태인가(순수) */
export function isStreamConfirmed(s: Pick<MeasurementSnapshot, 'state' | 'streamId'> | null): boolean {
  return Boolean(s) && s!.streamId != null && (s!.state === 'CAPTURING' || s!.state === 'RECONNECTING');
}
/** running 중 건강 이상인가(순수): BLOCKED/CLOSED/IDLE 이거나 streamId 가 null 로 돌아감. snapshot 을 못 읽으면(null) 판단 보류 */
export function isStreamUnhealthy(s: Pick<MeasurementSnapshot, 'state' | 'streamId'> | null): boolean {
  if (!s) return false;
  if (s.state === 'SEALING' || s.state === 'DRAINING') return false; // 종료 처리 중은 이상이 아니다
  return s.state === 'BLOCKED' || s.state === 'CLOSED' || s.state === 'IDLE' || s.streamId == null;
}

export interface NativeDiagnostics {
  path: MeasurementPath;
  status: NativeMeasurementStatus;
  code: string | null;
  nativeState: string | null;
  /** streamId 앞 8자리 */
  streamIdHead: string | null;
  restartCount: number;
  /** 마지막 확정 시도가 시작된 뒤 경과 ms(확정되면 확정까지 걸린 시간). 시도 전 null */
  lastConfirmElapsedMs: number | null;
  upload: { featurePending: number; featureAcked: number; rawPending: number; rawVerified: number } | null;
}

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
  /** SDD-284: 스트림 확정 실패가 반복돼 웹 경로(web_wasm)로 하강했는가(회차 내 되돌아가지 않음) */
  nativeFailed: boolean;
  /** SDD-284: 연결 진단 패널(T4)용 데이터 */
  diagnostics: NativeDiagnostics;
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

/**
 * 네이티브 세션 소유권(모듈 단위). stop 은 "내가 시작해 아직 내가 소유한" 세션에만 보낸다.
 * 이전 화면(A)의 늦은 정리가 새 화면(B)이 시작한 회차를 끊지 못하게 한다.
 */
let activeOwner: symbol | null = null;

const RETRY_MAX = 5;
/** SDD-284 T4: 연결 진단 패널의 "재시작 n/5" 표기용 */
export const NATIVE_RESTART_MAX = RETRY_MAX;
const RETRY_BASE_MS = 3000;

export function useNativeMeasurementV2(o: UseNativeMeasurementOptions): UseNativeMeasurementResult {
  const [nativeFailed, setNativeFailed] = useState(false);
  const path = decideMeasurementPath({
    v2: o.v2 && o.enabled && isLiveProtocolV2Enabled(), native: isNativeMeasurementAvailable(),
    webBluetooth: false, bandConnected: o.bandConnected, eegConsent: o.eegConsent, bandOptIn: o.bandOptIn,
    guest: !o.accountId, // 게스트는 네이티브를 시작하지 않는다(웹 훅이 web_wasm 으로 측정)
    nativeFailed,
  });
  const [status, setStatus] = useState<NativeMeasurementStatus>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricSnapshot | null>(null);
  const [device, setDevice] = useState<NativeDeviceState | null>(null);
  const [diag, setDiag] = useState<{ nativeState: string | null; streamIdHead: string | null; restartCount: number; lastConfirmElapsedMs: number | null }>({ nativeState: null, streamIdHead: null, restartCount: 0, lastConfirmElapsedMs: null });
  // 스트림 확정 실패·건강 점검 실패 누적(하강 판단)과 재시작마다 새 requestId 를 쓰기 위한 시도 번호
  const streamFailRef = useRef(0);
  const attemptRef = useRef(0);
  const instanceRef = useRef<string>(crypto.randomUUID());
  const startedRef = useRef(false);
  // 시도 시작 시점부터 래치한다: startForSession 이 JS 연결을 놓으면 useBand 의 connectionState 가 풀려
  // ready 가 꺼지고, 그러면 진행 중이던 시작이 cancelled 처리돼 리스너·재시도가 사라졌다.
  const latchedRef = useRef(false);
  const retryRef = useRef(0);
  // 한 번 성공한 밴드 ID — releaseForNative 가 JS 캐시 ID 를 지우므로 재시작 때 이 값을 네이티브에 넘긴다(iOS 스캔만 하다 실패 방지)
  const lastGoodDeviceIdRef = useRef<string | null>(null);
  // 이 훅 인스턴스가 시작 시도한 네이티브 세션(소유 키). effect 재실행(입력 흔들림)과 무관하게 유지되고 실제 이탈·종료·동의 철회에서만 stop 한다.
  const ownerRef = useRef<{ token: symbol; key: string } | null>(null);
  const prevDepsRef = useRef<string>('');
  const lastStopReasonRef = useRef('user_left');
  const optionsRef = useRef(o);
  optionsRef.current = o;
  /** 소유한 세션에만 stop. 소유권이 다른 인스턴스로 넘어갔으면(새 화면이 시작함) 건드리지 않는다. */
  const stopOwned = (reason: string) => {
    const owned = ownerRef.current;
    if (!owned) return;
    ownerRef.current = null; startedRef.current = false;
    lastStopReasonRef.current = reason;
    if (activeOwner !== owned.token) return;
    activeOwner = null;
    void getNativeMeasurement().stop({ reason, requestId: crypto.randomUUID() }).catch(() => undefined);
  };
  // 실제 이탈(언마운트)·회차/참가자/계정 변경 → 즉시 stop. 화면이 유지되는 입력 흔들림(bandOptIn·연결 상태·재시도)은 여기 오지 않는다.
  useEffect(() => () => stopOwned('user_left'), [o.sessionId, o.participantId, o.accountId]); // eslint-disable-line react-hooks/exhaustive-deps -- stopOwned 는 ref 만 쓴다
  // 동의 철회·수업 비활성(회차 종료/대기열)은 명시적으로 수집을 끝낸다. bandOptIn(밴드 건너뛰기) 토글은 세션을 끊지 않는다.
  useEffect(() => {
    if (!o.eegConsent) stopOwned('consent_withdrawn');
    else if (!o.enabled || !o.v2) stopOwned('user_left');
  }, [o.eegConsent, o.enabled, o.v2]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const requestId = attemptRef.current === 0 ? deterministicRequestId(o.sessionId, o.participantId) : crypto.randomUUID(); // 재시작은 새 requestId(같은 id 는 native 가 replay 로 막는다)
    if (!access || !refresh || (platform !== 'ios' && platform !== 'android')) {
      setStatus('failed'); setCode(!access || !refresh ? 'credentials_unavailable' : 'platform_unsupported');
      return undefined;
    }
    const key = `${o.sessionId}:${o.participantId}:${o.accountId}`;
    // 시작 사유·직전 effect 와 달라진 입력을 남긴다(현장 재시작 원인 확정용)
    const depsNow = JSON.stringify({ ready, retryTick, s: o.sessionId, p: o.participantId, a: o.accountId });
    console.info('[native-measurement] start_reason', { reason: startedRef.current ? 'resume_in_place' : retryTick > 0 ? 'retry' : 'initial', changed: prevDepsRef.current === depsNow ? 'none' : { prev: prevDepsRef.current, now: depsNow } });
    prevDepsRef.current = depsNow;
    // 이미 같은 키로 시작에 성공한 세션이 있으면 새 capture.start 없이 밴드 링크만 다시 잡는다
    const resumeInPlace = startedRef.current && ownerRef.current?.key === key;
    if (!resumeInPlace) {
      const token = ownerRef.current?.key === key ? ownerRef.current.token : Symbol('native-session');
      ownerRef.current = { token, key }; activeOwner = token;
    }
    latchedRef.current = true;
    setStatus('starting'); setCode(null);
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // 시작 비동기 흐름의 각 await 뒤에 확인한다: 이 시도가 잡은 소유권이 아직 유효하고 동의가 유지되는가
    const myToken = ownerRef.current?.token ?? null;
    const stillOwned = () => myToken !== null && ownerRef.current?.token === myToken && optionsRef.current.eegConsent;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const wait = (ms: number) => new Promise<void>((res) => { const t = setTimeout(() => { timers.delete(t); res(); }, ms); timers.add(t); });
    const noteSnap = (snap: MeasurementSnapshot | null, elapsed?: number) => {
      if (cancelled || !snap) return;
      setDiag((d) => ({ ...d, nativeState: snap.state, streamIdHead: snap.streamId ? snap.streamId.slice(0, 8) : null, ...(elapsed !== undefined ? { lastConfirmElapsedMs: elapsed } : {}) }));
    };
    /** native stop 을 완료까지 기다린다. 이미 수집 중이 아니면(not_active) 정지된 것으로 본다. 그 밖의 실패는 false. */
    const stopNativeAndWait = async (reason: string): Promise<boolean> => {
      try {
        const r = await facade.stop({ reason, requestId: crypto.randomUUID() });
        return r?.accepted !== false;
      } catch (err) {
        const c = (err as { code?: unknown; message?: unknown } | null)?.code ?? (err as { message?: unknown } | null)?.message;
        return c === 'not_active';
      }
    };
    const releaseOwnership = () => {
      const owned = ownerRef.current;
      ownerRef.current = null; startedRef.current = false; lastStopReasonRef.current = 'user_left';
      if (owned && activeOwner === owned.token) activeOwner = null;
    };
    /** 재시도 소진·확정 실패 반복 → 네이티브를 완전히 멈춘 뒤 web_wasm 으로 단방향 하강. 멈춤·소유권 회수가 확인되지 않으면 하강하지 않고 오류만 남긴다. */
    const descendToWeb = async (why: string) => {
      const stopped = await stopNativeAndWait('user_left');
      if (cancelled) return;
      if (!stopped) { setStatus('failed'); setCode('native_stop_failed'); latchedRef.current = false; return; }
      const reclaimed = await facade.reclaimJsBand(platform);
      if (cancelled) return;
      if (!reclaimed) { setStatus('failed'); setCode('js_band_reclaim_failed'); latchedRef.current = false; return; }
      releaseOwnership();
      latchedRef.current = false;
      console.warn('[native-measurement] 웹 경로로 하강', why);
      setStatus('failed'); setCode(why);
      setNativeFailed(true);
    };
    /** 스트림 확정 실패·건강 이상 → stop 후 지수 백오프로 새 requestId 재시작. 소진되면 하강. */
    const restartOrDescend = async (why: string) => {
      streamFailRef.current += 1;
      setStatus('starting'); setCode(why);
      if (streamFailRef.current >= NATIVE_STREAM_FAIL_DESCEND_AT || retryRef.current >= RETRY_MAX) { await descendToWeb(why); return; }
      const stopped = await stopNativeAndWait('user_left');
      if (cancelled || !stillOwned()) return;
      if (!stopped) { setStatus('failed'); setCode('native_stop_failed'); return; }
      releaseOwnership(); // 새 시도가 새 소유 토큰을 잡는다
      const delay = RETRY_BASE_MS * 2 ** retryRef.current;
      retryRef.current += 1; attemptRef.current += 1;
      setDiag((d) => ({ ...d, restartCount: d.restartCount + 1, streamIdHead: null }));
      retryTimer = setTimeout(() => setRetryTick((n) => n + 1), delay);
    };
    /** running 중 10초 간격 건강 점검 */
    const monitorHealth = async () => {
      while (!cancelled) {
        await wait(NATIVE_HEALTH_MS);
        if (cancelled || !stillOwned()) return;
        const snap = await facade.getSnapshot(o.sessionId);
        if (cancelled || !stillOwned()) return;
        noteSnap(snap);
        if (isStreamUnhealthy(snap)) { await restartOrDescend('native_stream_lost'); return; }
      }
    };
    /** startForSession 직후 2초 폴링으로 streamId 확정을 기다린다. 20초 안에 확정 안 되면 false */
    const awaitConfirm = async (): Promise<boolean> => {
      const t0 = Date.now();
      setDiag((d) => ({ ...d, lastConfirmElapsedMs: 0 }));
      for (;;) {
        const snap = await facade.getSnapshot(o.sessionId);
        if (cancelled || !stillOwned()) return true; // 취소는 실패가 아니다(호출자가 cancelled 로 빠진다)
        const elapsed = Date.now() - t0;
        noteSnap(snap, elapsed);
        if (isStreamConfirmed(snap)) return true;
        if (elapsed >= NATIVE_CONFIRM_MS) return false;
        await wait(NATIVE_POLL_MS);
        if (cancelled) return true;
      }
    };
    void (async () => {
      try {
        await facade.attach(o.sessionId);
        if (cancelled) return;
        off = facade.onMeasurement((snap) => { if (!cancelled) { setMetrics(toMetricSnapshot(snap)); setDevice(toNativeDevice(snap)); noteSnap(snap); } });
        // SDD-260: 저장 진행(feature.counts·archive.counts·reconcile.state) → 전역 스토어. 화면을 떠나도 네이티브가 계속 올리므로 detach 후에도 마지막 값을 남긴다.
        const offUpload = facade.onUploadProgress((patch) => { if (!cancelled) uploadProgressStore.update(o.sessionId, patch); });
        const offMeasurement = off;
        off = () => { offMeasurement(); offUpload(); };
        if (resumeInPlace) {
          // 이미 네이티브가 수집 중 — 새 capture.start 를 만들지 않고 밴드 링크만 다시 잡는다
          await facade.reconnectBand(platform);
          if (cancelled) return;
          startedRef.current = true;
          setStatus('running');
          console.info('[native-measurement] 제자리 재연결(stop→start 생략)', platform);
          void monitorHealth();
          return;
        }
        const deviceId = bluetoothService.getDeviceId() || bluetoothService.getCachedDeviceId() || lastGoodDeviceIdRef.current;
        // 웹과 같은 규칙: 서버 활성 표준 모델 > 코호트. 시작 시 1회 조회해 넘기고, 이후 교체는 네이티브가 막는다(pin).
        const model = buildNativeModelPayload(getActiveModelCache() ?? (await refreshActiveModel().catch(() => null)));
        if (cancelled || !stillOwned()) return;
        await facade.startForSession({
          platform, sessionId: o.sessionId, requestId, accountId: o.accountId as string, apiBase: BASE_URL, socketBase: SOCKET_URL,
          instanceId: instanceRef.current, deviceId: deviceId || null, tokens: { accessToken: access, refreshToken: refresh }, model,
          releaseJsBand: () => bluetoothService.releaseForNative(),
          isValid: stillOwned,
        });
        if (!stillOwned()) {
          // 시작 요청이 이미 나간 뒤 철회됐다 — 완료 직후 정지를 보내 최종 상태가 정지가 되게 한다(새 소유자가 있으면 건드리지 않음)
          if (activeOwner === null || activeOwner === myToken) {
            if (activeOwner === myToken) activeOwner = null;
            void facade.stop({ reason: lastStopReasonRef.current, requestId: crypto.randomUUID() }).catch(() => undefined);
          }
          return;
        }
        if (cancelled) return;
        startedRef.current = true;
        if (deviceId) lastGoodDeviceIdRef.current = deviceId;
        console.info('[native-measurement] startForSession 반환 — 스트림 확정 대기', platform);
        // SDD-284: 반환만으로 running 이 아니다. streamId 확정(CAPTURING/RECONNECTING)을 확인한 뒤에만 running.
        const confirmed = await awaitConfirm();
        if (cancelled || !stillOwned()) return;
        if (!confirmed) { await restartOrDescend('native_stream_unconfirmed'); return; }
        retryRef.current = 0; streamFailRef.current = 0;
        setStatus('running');
        console.info('[native-measurement] 스트림 확정', platform);
        void monitorHealth();
      } catch (err) {
        console.warn('[native-measurement] 시작 실패', platform, err instanceof Error ? err.message : String(err));
        if (cancelled || !stillOwned()) return;
        setStatus('failed'); setCode(err instanceof Error ? err.message : 'native_start_failed');
        // 시작 실패 후 재시도 없이 멈추던 문제: 지수 백오프로 다시 시도한다(같은 requestId 는 facade 가 실패 시 비운다).
        if (retryRef.current < RETRY_MAX) {
          const delay = RETRY_BASE_MS * 2 ** retryRef.current;
          retryRef.current += 1;
          retryTimer = setTimeout(() => setRetryTick((n) => n + 1), delay);
        } else {
          latchedRef.current = false;
          // SDD-284: 재시도 소진 — 네이티브를 멈추고 웹 경로로 단방향 하강(실패 시 오류 상태만)
          await descendToWeb(err instanceof Error ? err.message : 'native_start_failed');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const t of timers) clearTimeout(t);
      off?.();
      void facade.detach();
      latchedRef.current = ownerRef.current !== null; // 소유 세션이 있으면 JS 연결이 풀려도(ready) 유지
      setMetrics(null); setDevice(null);
    };
  }, [ready, retryTick, o.sessionId, o.participantId, o.accountId]);

  const up = uploadProgressStore.get(o.sessionId);
  const diagnostics: NativeDiagnostics = {
    path, status, code, nativeState: diag.nativeState, streamIdHead: diag.streamIdHead, restartCount: diag.restartCount, lastConfirmElapsedMs: diag.lastConfirmElapsedMs,
    upload: up ? { featurePending: up.featurePending, featureAcked: up.featureAcked, rawPending: up.rawPending + up.rawUploading, rawVerified: up.rawVerified } : null,
  };
  return { path, status: path === 'native' ? status : 'idle', code: path === 'native' ? code : null, metrics: path === 'native' && status === 'running' ? metrics : null,
    device: path === 'native' && status === 'running' ? device : null, nativeFailed, diagnostics };
}
