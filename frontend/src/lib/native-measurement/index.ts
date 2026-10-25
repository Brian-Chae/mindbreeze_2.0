// SDD-246 T06 — typed Capacitor facade. 화면은 이 모듈만 쓴다(플러그인 직접 호출 금지).
// - foreground 복귀 = full snapshot → 그보다 새로운 event 만 반영.
// - managerGeneration+seq 로 stale 이벤트 폐기. 새 세대면 snapshot 재조회.
// - 웹뷰는 중복 수집 시작/소켓 writer 를 만들지 않는다: start 는 requestId 단위로 한 번만.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CommandAck, LiveCommand, LiveEvent } from '../session-live/live-types';
import type {
  BridgeEvent, Capabilities, DispatchLiveCommandResult, ListenerHandle, MeasurementSnapshot,
  NativeMeasurementPlugin, QueueCounts, BlockedReason, StartMeasurementRequest, StartMeasurementResult,
} from './types';

export type { BridgeEvent, Capabilities, MeasurementSnapshot, NativeMeasurementPlugin, QueueCounts, BlockedReason } from './types';
export { describeArchiveStatus } from './archive-status';

const EVENTS: Array<BridgeEvent['event']> = ['measurementUpdated', 'liveStateUpdated', 'commandAck', 'archiveStatus'];

export const WEB_CAPABILITIES: Capabilities = {
  bridge_version: 1,
  platform: 'web',
  os_version: 'web',
  native_runtime_version: null,
  core_version: null,
  live_protocol_versions: [2],
  device_profiles: ['linkband2-v1'],
  background: { capture: 'unsupported', live_socket: 'unsupported', archive_upload: 'unsupported' },
  permissions: { bluetooth: 'not_determined', notifications: 'not_determined', microphone: 'not_required' },
};

type Cb<T> = (v: T) => void;

export class NativeMeasurementFacade {
  private readonly plugin: NativeMeasurementPlugin;
  private handles: ListenerHandle[] = [];
  private generation: string | null = null;
  private lastSeq: bigint = -1n;
  private sessionId: string | null = null;
  private attachToken = 0;
  private startFlights = new Map<string, Promise<StartMeasurementResult>>();
  private measurementCbs = new Set<Cb<MeasurementSnapshot>>();
  private liveCbs = new Set<Cb<LiveEvent>>();
  private ackCbs = new Set<Cb<CommandAck>>();
  private archiveCbs = new Set<Cb<{ queue: QueueCounts; blocked_reason: BlockedReason | null; stage: string | null; code: string | null }>>();

  constructor(plugin: NativeMeasurementPlugin) {
    this.plugin = plugin;
  }

  onMeasurement(cb: Cb<MeasurementSnapshot>): () => void { this.measurementCbs.add(cb); return () => { this.measurementCbs.delete(cb); }; }
  onLiveEvent(cb: Cb<LiveEvent>): () => void { this.liveCbs.add(cb); return () => { this.liveCbs.delete(cb); }; }
  onCommandAck(cb: Cb<CommandAck>): () => void { this.ackCbs.add(cb); return () => { this.ackCbs.delete(cb); }; }
  onArchive(cb: Cb<{ queue: QueueCounts; blocked_reason: BlockedReason | null; stage: string | null; code: string | null }>): () => void {
    this.archiveCbs.add(cb); return () => { this.archiveCbs.delete(cb); };
  }

  getCapabilities(): Promise<Capabilities> {
    return this.plugin.getCapabilities();
  }

  /** 수집을 시작하지 않고 현재 상태에 붙는다(foreground 복귀·화면 진입). */
  async attach(sessionId: string): Promise<MeasurementSnapshot> {
    await this.detach();
    this.sessionId = sessionId;
    const token = ++this.attachToken;
    // listener 를 먼저 설치하고 snapshot 을 읽는다 — snapshot 이전 이벤트는 seq 로 걸러진다.
    for (const name of EVENTS) {
      const h = await this.plugin.addListener(name, (e) => { if (token === this.attachToken) this.onEvent(e); });
      this.handles.push(h);
    }
    const snap = await this.plugin.getMeasurementSnapshot({ sessionId });
    if (token !== this.attachToken) return snap;
    this.accept(snap);
    return snap;
  }

  async detach(): Promise<void> {
    this.attachToken += 1;
    const hs = this.handles;
    this.handles = [];
    await Promise.all(hs.map((h) => h.remove().catch(() => undefined)));
  }

  start(req: StartMeasurementRequest): Promise<StartMeasurementResult> {
    const inflight = this.startFlights.get(req.requestId);
    if (inflight) return inflight;
    const p = this.plugin.startMeasurement(req);
    this.startFlights.set(req.requestId, p);
    return p;
  }

  stop(req: { reason: string; requestId: string }): Promise<{ accepted: boolean }> {
    return this.plugin.stopMeasurement(req);
  }

  dispatchLiveCommand(cmd: LiveCommand): Promise<DispatchLiveCommandResult> {
    return this.plugin.dispatchLiveCommand(cmd);
  }

  private accept(snap: MeasurementSnapshot): boolean {
    const seq = BigInt(snap.seq);
    if (this.generation === snap.managerGeneration && seq <= this.lastSeq) return false;
    if (this.generation !== null && BigInt(snap.managerGeneration) < BigInt(this.generation)) return false;
    this.generation = snap.managerGeneration;
    this.lastSeq = seq;
    for (const cb of this.measurementCbs) cb(snap);
    return true;
  }

  private onEvent(e: BridgeEvent): void {
    const gen = BigInt(e.managerGeneration);
    if (this.generation !== null) {
      const cur = BigInt(this.generation);
      if (gen < cur) return; // 이전 세대
      if (gen > cur) { void this.resnapshot(); return; } // 새 세대 → 전체 상태부터
    }
    if (e.event === 'measurementUpdated') { this.accept(e.payload); return; }
    if (this.generation === e.managerGeneration && BigInt(e.seq) <= this.lastSeq && e.event !== 'liveStateUpdated' && e.event !== 'commandAck') return;
    if (e.event === 'liveStateUpdated') for (const cb of this.liveCbs) cb(e.payload.event);
    else if (e.event === 'commandAck') for (const cb of this.ackCbs) cb(e.payload.ack);
    else if (e.event === 'archiveStatus') for (const cb of this.archiveCbs) cb(e.payload);
  }

  private async resnapshot(): Promise<void> {
    if (!this.sessionId) return;
    const token = this.attachToken;
    const snap = await this.plugin.getMeasurementSnapshot({ sessionId: this.sessionId });
    if (token === this.attachToken) {
      this.generation = null; this.lastSeq = -1n; // 새 세대는 seq 가 다시 시작한다
      this.accept(snap);
    }
  }
}

const pluginProxy = registerPlugin<NativeMeasurementPlugin>('NativeMeasurement');

/** 네이티브 앱에서만 true. 웹은 JS Socket.IO + WASM worker 경로를 쓴다. */
export const isNativeMeasurementAvailable = (): boolean => Capacitor.isNativePlatform();

let singleton: NativeMeasurementFacade | null = null;
export function getNativeMeasurement(): NativeMeasurementFacade {
  if (!singleton) singleton = new NativeMeasurementFacade(pluginProxy);
  return singleton;
}
