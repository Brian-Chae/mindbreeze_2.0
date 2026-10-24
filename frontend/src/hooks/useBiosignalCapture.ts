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
  const wasConnected = useRef(false);
  const closing = useRef(false);
  const runtime = useRef<{ session: BiosignalCaptureSession; queue: BiosignalQueue; api: BiosignalApi; collector: FeatureCollector; display: DisplayRecorder; active: () => boolean } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const accountId = entryCredential ? `entry:${participantId ?? ''}` : userId ? `user:${userId}` : null;
  const active = enabled && armed && Boolean(sessionId && participantId && accountId);

  useEffect(() => {
    if (connected && enabled) setArmed(true);
    const rt = runtime.current;
    if (rt && !closing.current) {
      if (wasConnected.current && !connected) rt.session.markDisconnected();
      if (!wasConnected.current && connected) rt.session.markReconnected();
    }
    wasConnected.current = connected;
  }, [connected, enabled]);

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
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      await rt.collector.flush(false);
      await rt.display.flush(false);
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
    void (async () => {
      try {
        const capability = await api.capability(sessionId, participantId);
        if (cancelled) return;
        const allowed = new Set<Signal>(capability.signals.filter(s => s.upload_allowed).map(s => s.signal));
        // 구버전 서버·미동의·미지원: v2를 쓰지 않고 기존 v1 경로만 유지한다.
        if (!capability.raw_schemas.includes(RAW_V2) || allowed.size === 0) { setStatus('inactive'); return; }
        await session.start();
        if (cancelled) { await session.pause(); return; }
        const collector = new FeatureCollector({ queue, session });
        const display = new DisplayRecorder({ queue, session, viewKind: displayViewKind, sourceFeature: s => collector.lastFeatureAlias(s) });
        await display.start(getActiveModelCache());
        runtime.current = { session, queue, api, collector, display, active: () => !cancelled };
        unsubscribe = subscribeRawPackets(packet => { if (allowed.has(packet.signal)) session.receive(packet); }, error => {
          logger.error('원문 수집 오류 — 수집 중단', error); session.abort('journal_failed');
        });
        timers.push(setInterval(() => { void queue.renew().catch(() => session.abort('lease_lost')); }, LEASE_RENEW_MS));
        timers.push(setInterval(() => { void pump(); }, UPLOAD_INTERVAL_MS));
        timers.push(setInterval(() => { void session.checkQuota().then(() => { if (mounted.current) setQuotaWarning(session.quotaWarning); }).catch(() => undefined); }, QUOTA_INTERVAL_MS));
      } catch (error) {
        // capability 404/네트워크 오류/lease 점유: v2 비활성. 상담·분석 기능에는 영향이 없다.
        logger.warn('biosignal v2 수집 비활성', error);
        if (mounted.current && !cancelled) setStatus('inactive');
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      timers.forEach(clearInterval);
      const rt = runtime.current;
      runtime.current = null;
      if (rt && rt.session === session) void session.pause();
    };
  }, [active, accountId, sessionId, participantId, entryCredential, skipAuth, pump, displayViewKind]);

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
      if (mounted.current) setArmed(false); // 다음 연결은 새 stream으로 시작
    }
  }, [pump]);

  return {
    status: active ? status : 'inactive', stopReason, pendingCount, blockedCount, quotaWarning, closeState,
    markDisconnected: () => runtime.current?.session.markDisconnected(),
    markReconnected: () => runtime.current?.session.markReconnected(),
    featureWindow: (signal, count) => runtime.current?.session.sampleWindow(signal, count) ?? null,
    emitFeature: (signal, data, window, windowIndex, extras) => runtime.current?.collector.emit(signal, data, { window, windowIndex, extras }),
    recordDisplay: (rendered, visible) => {
      const rt = runtime.current; if (!rt) return;
      // 활성 표준 모델이 바뀌면 새 snapshot을 등록(이미 기록한 행은 그대로)
      void rt.display.setModel(getActiveModelCache()).catch(() => undefined);
      rt.display.tick(rendered, visible);
    },
    close,
    resumeBlocked: async () => {
      const rt = runtime.current; if (!rt) return;
      for (const o of await rt.queue.objects()) if (o.state === 'dead_letter') await rt.queue.resume(o.id);
      await pump();
    },
  };
}
