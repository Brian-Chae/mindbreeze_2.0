/**
 * SDD-244 T08 — 세 신호 원문 선수집 훅.
 * 서버 capability(raw-v2·신호별 upload_allowed)가 확인된 경우에만 구독한다. 미지원/404/미동의 신호는
 * 기존 eeg-raw v1 경로만 사용한다(밴드 미연결 시에도 기존 동작 유지).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { putEegRawToPresignedUrl } from '../lib/api/eeg-raw';
import { createBiosignalApi, type BiosignalApi, type CloseIntent } from '../lib/api/biosignal';
import { BiosignalQueue, LEASE_RENEW_MS } from '../lib/biosignal/durable-queue';
import { BiosignalCaptureSession, type CaptureStatus, type SampleWindow, type StopReason } from '../lib/biosignal/capture-session';
import { FeatureCollector } from '../lib/biosignal/feature-collector';
import { DisplayRecorder, type RenderedMetrics, type ViewKind } from '../lib/biosignal/display-snapshot';
import { getActiveModelCache } from '../lib/eeg/eegPersonalScore';
import type { Scalars } from '../lib/biosignal/feature-record';
import { subscribeRawPackets } from '../lib/biosignal/raw-capture';
import { sendBiosignalEvents, uploadBiosignalQueue } from '../lib/biosignal/upload-queue';
import type { Signal } from '../lib/biosignal/raw-types';
import { createLogger } from '../lib/eeg/logger';
import { useAuthStore } from '../stores/authStore';

const logger = createLogger('useBiosignalCapture');
const UPLOAD_INTERVAL_MS = 4000;
const QUOTA_INTERVAL_MS = 30_000;
const RAW_V2 = 'mb-biosignal-raw-v2';

export interface UseBiosignalCaptureOptions {
  sessionId: string; participantId: string | null;
  /** 업로드 대상 회차인지(관찰 전용/목업이면 false) */
  enabled: boolean;
  /** 밴드가 연결되어 있을 때만 수집 */
  connected: boolean;
  skipAuth?: boolean; entryCredential?: string | null;
  /** 화면 snapshot의 view 종류(기본 participant_player) */
  displayViewKind?: ViewKind;
}
export interface UseBiosignalCaptureResult {
  status: CaptureStatus | 'inactive'; stopReason: StopReason | null;
  pendingCount: number; blockedCount: number; quotaWarning: boolean; closeState: string | null;
  markDisconnected: () => void; markReconnected: () => void;
  /** 분석 시작 시점의 원창. 수집 중이 아니면 null → emitFeature는 아무것도 만들지 않는다. */
  featureWindow: (signal: Signal, count: number) => SampleWindow | null;
  /** 1초 타이머에서 호출: 이번 렌더에서 화면이 실제로 보여 준 6지표(없으면 null=미렌더). */
  recordDisplay: (rendered: RenderedMetrics | null, visible: boolean) => void;
  /** 처리기 emit마다 호출(다운샘플 없음). */
  emitFeature: (signal: Signal, data: Record<string, unknown>, window: SampleWindow | null, windowIndex: number, extras?: Partial<Scalars>) => void;
  /** 명시 종료: 남은 청크 봉인 → close intent 영속 → 전송 시도. 서버 응답을 저장 완료로 간주하지 않는다. */
  close: (reason: string) => Promise<CloseIntent | null>;
  /** 8회 초과/403/409로 보관된 사본을 재인증 뒤 명시 재개한다. */
  resumeBlocked: () => Promise<void>;
}

type CaptureRuntime = { session: BiosignalCaptureSession; queue: BiosignalQueue; api: BiosignalApi; collector: FeatureCollector; display: DisplayRecorder; active: () => boolean };
// 저장 장치가 쓰기를 거절한 상태의 unmount도 메모리 사본을 버리지 않는다. 같은 계정/회차 재진입에서만 재시도한다.
const suspendedRuntimes = new Map<string, CaptureRuntime>();
const cleanupBarriers = new Map<string, Promise<void>>();

export function useBiosignalCapture(options: UseBiosignalCaptureOptions): UseBiosignalCaptureResult {
  const { sessionId, participantId, enabled, connected, skipAuth = false, entryCredential = null, displayViewKind = 'participant_player' } = options;
  const userId = useAuthStore(state => state.user?.id ?? null);
  const [status, setStatus] = useState<CaptureStatus | 'inactive'>('inactive');
  const [stopReason, setStopReason] = useState<StopReason | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);
  const [quotaWarning, setQuotaWarning] = useState(false);
  const [closeState, setCloseState] = useState<string | null>(null);
  // 밴드를 한 번도 연결하지 않은 사용자는 capability 요청·구독을 하지 않는다. close 뒤에는 다시 대기.
  const [armed, setArmed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const wasConnected = useRef(false);
  const closing = useRef(false);
  const runtime = useRef<CaptureRuntime | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const accountId = entryCredential ? `entry:${participantId ?? ''}` : userId ? `user:${userId}` : null;
  const active = enabled && armed && Boolean(sessionId && participantId && accountId);

  useEffect(() => {
    if (connected && enabled) setArmed(true);
    const rt = runtime.current;
    if (rt && !closing.current) {
      if (wasConnected.current && !connected) rt.session.markDisconnected();
      if (!wasConnected.current && connected) {
        if (rt.session.stopReason === 'closed') setGeneration(g => g + 1);
        else rt.session.markReconnected();
      }
    }
    wasConnected.current = connected;
  }, [connected, enabled]);

  // 밴드 없는 재진입도 해당 계정·회차의 미전송 사본이 있으면 복구한다.
  useEffect(() => {
    if (!enabled || !accountId || !participantId) return;
    let cancelled = false;
    const queue = new BiosignalQueue({ accountId, sessionId, participantId, deviceAlias: 'LINK-BAND' }, crypto.randomUUID());
    void Promise.all([queue.objects(), queue.pendingEvents(), queue.allPackets(), queue.drafts('feature'), queue.drafts('display')]).then(parts => {
      if (!cancelled && (parts.some(part => part.length > 0) || suspendedRuntimes.has(queue.scopeKey))) setArmed(true);
    }).catch(error => logger.warn('biosignal 복구 조회 실패', error));
    return () => { cancelled = true; };
  }, [enabled, accountId, sessionId, participantId]);

  const refresh = useCallback(async () => {
    const rt = runtime.current; if (!rt || !mounted.current) return;
    try {
      const objects = await rt.queue.objects();
      setPendingCount(objects.filter(o => o.state === 'pending').length);
      setBlockedCount(objects.filter(o => o.state === 'dead_letter').length);
    } catch (error) { logger.warn('biosignal 큐 조회 실패', error); }
  }, []);

  const pump = useCallback(async () => {
    const rt = runtime.current; if (!rt) return;
    try {
      await rt.collector.flush(rt.session.status !== 'running');
      await rt.display.flush(rt.session.status !== 'running');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { await refresh(); return; }
      await uploadBiosignalQueue(rt.queue, rt.api, (url, payload, headers) => putEegRawToPresignedUrl(url, payload, headers), rt.active);
      const result = await sendBiosignalEvents(rt.queue, rt.api, rt.active);
      if (result?.close_state && mounted.current) setCloseState(result.close_state);
    } catch (error) { logger.warn('biosignal 업로드 실패, 사본 보존', error); }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    if (!active || !accountId || !participantId) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const timers: ReturnType<typeof setInterval>[] = [];
    const api = createBiosignalApi({ entryCredential, skipAuth });
    const queue = new BiosignalQueue({ accountId, sessionId, participantId, deviceAlias: 'LINK-BAND' }, crypto.randomUUID());
    const session = new BiosignalCaptureSession({ queue, onStatus: (s, r) => { if (mounted.current && !cancelled) { setStatus(s); setStopReason(r); } } });
    const startup = (async () => {
      try {
        await cleanupBarriers.get(queue.scopeKey);
        if (cancelled) return;
        const suspended = suspendedRuntimes.get(queue.scopeKey);
        if (suspended) {
          await suspended.queue.acquire();
          try { await suspended.session.sealOpen(); await suspended.collector.flush(true); await suspended.display.flush(true); suspendedRuntimes.delete(queue.scopeKey); }
          finally { await suspended.queue.release(); }
        }
        const capability = await api.capability(sessionId, participantId);
        if (cancelled) return;
        const allowed = new Set<Signal>(capability.signals.filter(s => s.upload_allowed).map(s => s.signal));
        // 구버전 서버·미동의·미지원: v2를 쓰지 않고 기존 v1 경로만 유지한다.
        if (!capability.raw_schemas.includes(RAW_V2) || allowed.size === 0) { setStatus('inactive'); return; }
        const collecting = wasConnected.current;
        await session.start(collecting);
        if (cancelled) { await session.pause(); return; }
        const collector = new FeatureCollector({ queue, session });
        await collector.restore();
        const display = new DisplayRecorder({ queue, session, viewKind: displayViewKind, sourceFeature: s => collector.lastFeatureAlias(s) });
        if (collecting) await display.start(getActiveModelCache());
        else await display.restore();
        if (cancelled) { await session.pause(); return; }
        runtime.current = { session, queue, api, collector, display, active: () => !cancelled };
        unsubscribe = subscribeRawPackets(packet => { if (allowed.has(packet.signal) && session.status === 'running' && !closing.current) session.receive(packet); }, error => {
          logger.error('원문 수집 오류 — 수집 중단', error); session.abort('journal_failed');
        });
        timers.push(setInterval(() => { void queue.renew().catch(() => session.abort('lease_lost')); }, LEASE_RENEW_MS));
        timers.push(setInterval(() => { void pump(); }, UPLOAD_INTERVAL_MS));
        void pump();
        timers.push(setInterval(() => { void session.checkQuota().then(() => { if (mounted.current) setQuotaWarning(session.quotaWarning); }).catch(() => undefined); }, QUOTA_INTERVAL_MS));
      } catch (error) {
        // capability 404/네트워크 오류/lease 점유: v2 비활성. 상담·분석 기능에는 영향이 없다.
        logger.warn('biosignal v2 수집 비활성', error);
        await session.pause();
        if (mounted.current && !cancelled) {
          const leaseLost = error instanceof Error && error.message.startsWith('lease');
          setStatus(leaseLost ? 'stopped' : 'inactive');
          setStopReason(leaseLost ? 'lease_lost' : null);
        }
      }
    })();
    const online = () => { if (!runtime.current) setGeneration(g => g + 1); else void pump(); };
    window.addEventListener('online', online);
    return () => {
      cancelled = true;
      window.removeEventListener('online', online);
      unsubscribe?.();
      timers.forEach(clearInterval);
      const rt = runtime.current;
      runtime.current = null;
      const cleanup = startup.then(async () => {
        if (!rt || rt.session !== session) return;
        try { await session.sealOpen(); await rt.collector.flush(true); await rt.display.flush(true); }
        catch (error) { suspendedRuntimes.set(rt.queue.scopeKey, rt); logger.warn('종료 전 로컬 기록 실패 — 영속 journal 및 메모리 사본 유지', error); }
        finally { await session.pause(); }
      });
      cleanupBarriers.set(queue.scopeKey, cleanup);
      void cleanup.finally(() => { if (cleanupBarriers.get(queue.scopeKey) === cleanup) cleanupBarriers.delete(queue.scopeKey); });
    };
  }, [active, accountId, sessionId, participantId, entryCredential, skipAuth, pump, displayViewKind, generation]);

  const close = useCallback(async (reason: string) => {
    const rt = runtime.current; if (!rt) return null;
    closing.current = true;
    try {
      // 원창이 봉인된 뒤 남은 feature를 모두 묶어야 close intent의 expected set에 들어간다.
      await rt.session.sealOpen();
      await rt.collector.flush(true);
      await rt.display.flush(true);
      const intent = await rt.session.close(reason);
      await pump();
      return intent;
    } catch (error) { logger.warn('close intent 기록 실패', error); return null; } finally {
      closing.current = false; wasConnected.current = false;
      // 수집 종료 후에도 영속 큐 업로더와 online 재개는 살아 있다.
    }
  }, [pump]);

  return {
    status: active ? status : 'inactive', stopReason, pendingCount, blockedCount, quotaWarning, closeState,
    markDisconnected: () => runtime.current?.session.markDisconnected(),
    markReconnected: () => runtime.current?.session.markReconnected(),
    featureWindow: (signal, count) => runtime.current?.session.sampleWindow(signal, count) ?? null,
    emitFeature: (signal, data, window, windowIndex, extras) => { const rt = runtime.current; if (rt?.session.status === 'running' && !closing.current) rt.collector.emit(signal, data, { window, windowIndex, extras }); },
    recordDisplay: (rendered, visible) => {
      const rt = runtime.current; if (!rt || rt.session.status !== 'running' || closing.current) return;
      // 활성 표준 모델이 바뀌면 새 snapshot을 등록(이미 기록한 행은 그대로)
      void rt.display.record(rendered, visible, rendered && 'normalizationModel' in rendered ? rendered.normalizationModel ?? null : getActiveModelCache()).catch(error => logger.warn('표시 기록 실패', error));
    },
    close,
    resumeBlocked: async () => {
      const rt = runtime.current; if (!rt) return;
      for (const o of await rt.queue.objects()) if (o.state === 'dead_letter') await rt.queue.resume(o.id);
      await pump();
    },
  };
}
