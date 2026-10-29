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
import { recoverOversized } from '../lib/biosignal/archive-recovery';
import { isArchiveV3Enabled } from '../lib/feature-flags';
import type { Signal } from '../lib/biosignal/raw-types';
import { createLogger } from '../lib/eeg/logger';
import { useAuthStore } from '../stores/authStore';

const logger = createLogger('useBiosignalCapture');
const UPLOAD_INTERVAL_MS = 4000;
/** 한 pump 에서 연속 전송할 최대 라운드(적체 해소 속도 ↑, 한 번에 메인스레드를 오래 잡지 않도록 상한). */
const PUMP_MAX_ROUNDS = 8;
/** 다른 창이 lease 를 쥔 경우 TTL 안에 풀릴 때까지 재시도하는 간격·횟수 */
const LEASE_RETRY_MS = 3000;
const LEASE_RETRY_MAX = 14;
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
  /** SDD-246 T09: 서버가 등록한 capture stream(있으면 presign 에 실려 종료 cutoff 판정을 받는다). archive v3 플래그가 켜진 때만 사용. */
  captureStreamId?: string | null;
  /** SDD-246 T09: 서버 close deadline(epoch ms). 지나면 전송 시도 없이 사유와 함께 보존한다. */
  closeDeadlineMs?: number | null;
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
  const { sessionId, participantId, enabled, connected, skipAuth = false, entryCredential = null, displayViewKind = 'participant_player', captureStreamId = null, closeDeadlineMs = null } = options;
  const archiveOpts = useRef({ captureStreamId, closeDeadlineMs });
  archiveOpts.current = { captureStreamId, closeDeadlineMs };
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
    void Promise.all([queue.hasStoredObjects(), queue.pendingEvents(), queue.allPackets(), queue.drafts('feature'), queue.drafts('display')]).then(([hasObjects, ...parts]) => {
      if (!cancelled && (hasObjects || parts.some(part => part.length > 0) || suspendedRuntimes.has(queue.scopeKey))) setArmed(true);
    }).catch(error => logger.warn('biosignal 복구 조회 실패', error));
    return () => { cancelled = true; };
  }, [enabled, accountId, sessionId, participantId]);

  const refresh = useCallback(async () => {
    const rt = runtime.current; if (!rt || !mounted.current) return;
    try {
      const { pending, blocked } = await rt.queue.counts();
      setPendingCount(pending);
      setBlockedCount(blocked);
    } catch (error) { logger.warn('biosignal 큐 조회 실패', error); }
  }, []);

  const pumping = useRef(false);
  /** 진행 중인 명시 종료(close). unmount cleanup 이 이게 끝날 때까지 lease 를 반납하지 않는다. */
  const closeInflight = useRef<Promise<unknown> | null>(null);
  /** force: 화면이 이미 내려간(unmount) 뒤의 종료 전송 — 호출 시점에 잡아 둔 런타임(forceRt)으로 rt.active() 가 false 여도 보낸다. */
  const pump = useCallback(async (forceRt?: CaptureRuntime) => {
    const rt = forceRt ?? runtime.current; if (!rt) return;
    const force = forceRt !== undefined;
    // 재진입 금지: 4초 타이머·online·close 가 겹쳐 같은 객체를 동시에 presign 하던 문제를 막는다.
    if (pumping.current) return;
    pumping.current = true;
    try {
      await rt.collector.flush(rt.session.status !== 'running');
      await rt.display.flush(rt.session.status !== 'running');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { await refresh(); return; }
      const v3 = isArchiveV3Enabled();
      if (v3) await recoverOversized(rt.queue).catch(error => logger.warn('과대 산출물 분할 복구 실패, 원본 보존', error));
      const live = force ? () => true : rt.active;
      for (let round = 0; round < PUMP_MAX_ROUNDS && live(); round++) {
        const summary = await uploadBiosignalQueue(rt.queue, rt.api, (url, payload, headers) => putEegRawToPresignedUrl(url, payload, headers), live, Date.now,
          v3 ? { archiveV3: true, captureStreamId: archiveOpts.current.captureStreamId, originMonotonicUs: rt.session.originMonotonicUs, closeDeadlineMs: archiveOpts.current.closeDeadlineMs } : {});
        if (summary.halted) { logger.warn('archive 전송 중단(권한·동의)', summary.halted); break; }
        if (summary.acked === 0 || summary.failed > 0) break;
        if (mounted.current) await refresh();
      }
      const result = await sendBiosignalEvents(rt.queue, rt.api, live);
      if (result?.close_state && mounted.current) setCloseState(result.close_state);
    } catch (error) { logger.warn('biosignal 업로드 실패, 사본 보존', error); }
    finally { pumping.current = false; }
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
        // 이전 창/인스턴스가 죽으면서 남긴 lease 는 TTL 안에 만료된다 → 그동안 재시도해 자동 인계한다.
        for (let attempt = 0; ; attempt++) {
          try { await session.start(collecting); break; } catch (error) {
            const held = error instanceof Error && error.message.startsWith('lease_held');
            if (!held || attempt >= LEASE_RETRY_MAX || cancelled) throw error;
            await new Promise(resolve => setTimeout(resolve, LEASE_RETRY_MS));
            if (cancelled) return;
          }
        }
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
    // 앱 종료·창 닫기 때 lease 를 즉시 반납해 재입장이 TTL 을 기다리지 않게 한다(best effort).
    const release = () => { void queue.release().catch(() => undefined); };
    window.addEventListener('pagehide', release);
    return () => {
      cancelled = true;
      window.removeEventListener('online', online);
      window.removeEventListener('pagehide', release);
      unsubscribe?.();
      timers.forEach(clearInterval);
      const rt = runtime.current;
      runtime.current = null;
      const cleanup = startup.then(async () => {
        if (!rt || rt.session !== session) return;
        // 회차 종료로 화면이 내려가는 순간 close intent 기록·전송이 진행 중이면 끝날 때까지 기다린다(lease 반납이 기록을 깨뜨림).
        await closeInflight.current?.catch(() => undefined);
        try { await session.sealOpen(); await rt.collector.flush(true); await rt.display.flush(true); }
        catch (error) { suspendedRuntimes.set(rt.queue.scopeKey, rt); logger.warn('종료 전 로컬 기록 실패 — 영속 journal 및 메모리 사본 유지', error); }
        finally { await session.pause(); }
      });
      cleanupBarriers.set(queue.scopeKey, cleanup);
      void cleanup.finally(() => { if (cleanupBarriers.get(queue.scopeKey) === cleanup) cleanupBarriers.delete(queue.scopeKey); });
    };
  }, [active, accountId, sessionId, participantId, entryCredential, skipAuth, pump, displayViewKind, generation]);

  const closeOnce = useCallback(async (reason: string): Promise<CloseIntent | null> => {
    const rt = runtime.current; if (!rt) return null;
    closing.current = true;
    try {
      // 원창이 봉인된 뒤 남은 feature를 모두 묶어야 close intent의 expected set에 들어간다.
      await rt.session.sealOpen();
      await rt.collector.flush(true);
      await rt.display.flush(true);
      const intent = await rt.session.close(reason);
      await pump(rt); // 이 사이 화면이 내려가 runtime.current 가 비어도 잡아 둔 rt 로 전송한다
      return intent;
    } catch (error) { logger.warn('close intent 기록 실패', error); return null; } finally {
      closing.current = false; wasConnected.current = false;
      // 수집 종료 후에도 영속 큐 업로더와 online 재개는 살아 있다.
    }
  }, [pump]);

  const close = useCallback((reason: string): Promise<CloseIntent | null> => {
    const run = closeOnce(reason);
    closeInflight.current = run;
    void run.finally(() => { if (closeInflight.current === run) closeInflight.current = null; });
    return run;
  }, [closeOnce]);

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
      for (const o of await rt.queue.objectsMeta()) if (o.state === 'dead_letter') await rt.queue.resume(o.id);
      await pump();
    },
  };
}
