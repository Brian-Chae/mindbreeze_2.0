// SDD-246 T06 — typed Capacitor facade. 화면은 이 모듈만 쓴다(플러그인 직접 호출 금지).
// - foreground 복귀 = full snapshot → 그보다 새로운 event 만 반영.
// - managerGeneration+seq 로 stale 이벤트 폐기. 새 세대면 snapshot 재조회.
// - 웹뷰는 중복 수집 시작/소켓 writer 를 만들지 않는다: start 는 requestId 단위로 한 번만.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CommandAck, LiveCommand, LiveEvent } from '../session-live/live-types';
import type {
  BridgeEvent, Capabilities, DispatchLiveCommandResult, ListenerHandle, MeasurementSnapshot,
  NativeMeasurementPlugin, QueueCounts, BlockedReason, RawPreview, StartMeasurementRequest, StartMeasurementResult,
} from './types';
import { parseModelParams } from '../eeg/eegPersonalScore';
import type { CalibrationMetricKey } from '../eeg/eegSigmoidScore';
import type { NormalizationModelDto } from '../api/normalization-api';

/** Android start 에 싣는 활성 표준 모델(비밀 아님). 없으면 필드를 보내지 않아 네이티브가 코호트를 유지한다. */
export interface NativeModelPayload { modelParams: string; modelVersion: string }

const MODEL_METRICS = new Set(['focusIndex', 'relaxationIndex', 'stressIndex', 'totalNeuralActivity', 'faa', 'cognitiveLoad', 'emotionalStability', 'autonomicStability', 'sdnn', 'avgHeartRate', 'breathingStability']);

/** 서버 활성 모델 DTO → 네이티브 전달 형태. 웹 parseModelParams 와 같은 검증(s>0, direction ±1)을 통과한 지표만. 하나도 없으면 null. */
export function buildNativeModelPayload(model: NormalizationModelDto | null | undefined): NativeModelPayload | null {
  if (!model || typeof model.params !== 'object' || model.params === null) return null;
  const out: Record<string, { m: number; s: number; direction: 1 | -1 }> = {};
  for (const key of Object.keys(model.params).sort()) {
    if (!MODEL_METRICS.has(key)) continue;
    const p = parseModelParams(key as CalibrationMetricKey, model.params[key]);
    if (p) out[key] = { m: p.m, s: p.s, direction: p.direction };
  }
  if (Object.keys(out).length === 0) return null;
  return { modelParams: JSON.stringify(out), modelVersion: String(model.version) };
}

/** 자격 인계 후 native 측정 시작(웹뷰는 토큰을 1회 넘기고, 이후 native 가 소켓·갱신을 소유한다) */
export interface NativeStartWithCredentials {
  platform: 'ios' | 'android';
  sessionId: string;
  requestId: string;
  accountId: string;
  apiBase: string;
  socketBase: string;
  configHash: string;
  instanceId: string;
  address?: string;
  /** iOS CoreBluetooth peripheral UUID(= BLE deviceId). 현 iOS startMeasurement 는 받지 않아 optional 로만 전달한다(progress/t12-fe.md 'iOS 워커 요청') */
  peripheralId?: string;
  tokens: { accessToken: string; refreshToken: string };
  /** 시작 시점 활성 표준 모델(1회 pin 은 네이티브가 한다) */
  model?: NativeModelPayload | null;
}

const CREDENTIAL_HANDLE = /^[A-Za-z0-9_-]{16,128}$/;
/** 키 이름 전체가 비밀값 필드인 경우만(예: pending_authorization 같은 정상 집계 필드는 제외) */
const SECRET_KEY = /^(?:(?:access|refresh|id)_?token|token|secret|client_?secret|password|authorization)$/i;

/** 결과·이벤트에 토큰 모양 키나 인계한 토큰 값이 섞여 있는지(값 자체는 어디에도 남기지 않는다) */
function containsSecret(v: unknown, secrets: readonly string[], depth = 0): boolean {
  if (depth > 8 || v === null || v === undefined) return false;
  if (typeof v === 'string') return secrets.some((s) => s.length > 0 && v.includes(s));
  if (Array.isArray(v)) return v.some((x) => containsSecret(x, secrets, depth + 1));
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).some(([k, x]) => SECRET_KEY.test(k) || containsSecret(x, secrets, depth + 1));
  }
  return false;
}

export type { BridgeEvent, Capabilities, MeasurementSnapshot, NativeMeasurementPlugin, QueueCounts, BlockedReason } from './types';
export { decideMeasurementPath, type MeasurementPath } from '../measurement-web/measurement-path';
export { describeArchiveStatus } from './archive-status';

const isU64 = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);

/** Android getMeasurementSnapshot 은 계약 스냅샷을 `bridge` 아래에 두고 최상위에 진단 필드를 싣는다 — 계약 형태로 맞춘다. */
function normalizeSnapshot(raw: MeasurementSnapshot): MeasurementSnapshot {
  const r = raw as unknown as { seq?: unknown; bridge?: unknown };
  if (!isU64(r.seq) && r.bridge && typeof r.bridge === 'object') return r.bridge as MeasurementSnapshot;
  return raw;
}

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
  private droppedSecrets = 0;
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
    // iOS 는 manager 가 setNativeOwnership(true) 이후에야 생겨, 첫 실행의 attach 시점에는 snapshot 이 not_active 로 거절된다.
    // 이는 '아직 측정 전'일 뿐이므로 listener 만 붙이고 진행해야 한다(throw 하면 startForSession 이 영영 불리지 않는다).
    let snap: MeasurementSnapshot;
    try {
      snap = normalizeSnapshot(await this.plugin.getMeasurementSnapshot({ sessionId }));
    } catch (err) {
      const code = (err as { code?: unknown; message?: unknown } | null)?.code ?? (err as { message?: unknown } | null)?.message;
      if (code !== 'not_active') throw err;
      console.info('[native-measurement] attach: 측정 전(not_active) — listener 만 연결');
      return { seq: '0', managerGeneration: '0', sessionId, state: 'IDLE' } as unknown as MeasurementSnapshot;
    }
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

  /**
   * 앱 측정 시작: setNativeOwnership → (iOS) registerCredential→credentialHandle / (Android) handoffCredentials → startMeasurement.
   * 토큰은 인계 호출에만 싣고 start 요청·결과·이벤트 어디에도 싣지 않는다. native 가 토큰을 되돌리면 'credential_echo' 로 거절한다.
   * 같은 requestId 는 한 번만 실행된다.
   */
  startWithCredentials(req: NativeStartWithCredentials): Promise<StartMeasurementResult> {
    const inflight = this.startFlights.get(req.requestId);
    if (inflight) return inflight;
    const p = this.doStartWithCredentials(req);
    this.startFlights.set(req.requestId, p);
    p.catch(() => { this.startFlights.delete(req.requestId); });
    return p;
  }

  private async doStartWithCredentials(req: NativeStartWithCredentials): Promise<StartMeasurementResult> {
    const secrets = [req.tokens.accessToken, req.tokens.refreshToken];
    const guard = <T>(v: T): T => {
      if (containsSecret(v, secrets)) throw new Error('credential_echo');
      return v;
    };
    if (this.plugin.setNativeOwnership) guard(await this.plugin.setNativeOwnership({ enabled: true }));
    let started: StartMeasurementResult;
    if (req.platform === 'ios') {
      if (!this.plugin.registerCredential) throw new Error('native_method_unavailable');
      const r = guard(await this.plugin.registerCredential({
        accountId: req.accountId, accessToken: req.tokens.accessToken, refreshToken: req.tokens.refreshToken, apiBase: req.apiBase,
      }));
      if (!CREDENTIAL_HANDLE.test(r.credentialHandle)) throw new Error('invalid_credential_handle');
      started = await this.plugin.startMeasurement({
        sessionId: req.sessionId, credentialHandle: r.credentialHandle, configHash: req.configHash, requestId: req.requestId,
        ...(req.peripheralId ? { peripheralId: req.peripheralId } : {}),
        ...(req.model ? { modelParams: req.model.modelParams, modelVersion: req.model.modelVersion } : {}),
      });
    } else {
      if (!this.plugin.handoffCredentials) throw new Error('native_method_unavailable');
      const r = guard(await this.plugin.handoffCredentials({ accessToken: req.tokens.accessToken, refreshToken: req.tokens.refreshToken }));
      if (!r.handoff) throw new Error('credential_handoff_failed');
      started = await this.plugin.startMeasurement({
        sessionId: req.sessionId, apiBase: req.apiBase, socketBase: req.socketBase, requestId: req.requestId, instanceId: req.instanceId,
        ...(req.address ? { address: req.address } : {}),
        ...(req.model ? { modelParams: req.model.modelParams, modelVersion: req.model.modelVersion } : {}),
      });
    }
    return guard(started);
  }

  /**
   * 앱 회원 화면 진입점: 플랫폼 차이(iOS peripheralId / Android address=MAC)를 여기서 흡수한다.
   * JS 밴드 소유를 먼저 놓는다(iOS setJSBandOwnership(false)) — 소유가 풀리지 않으면 시작하지 않고 'js_band_release_failed'.
   */
  async startForSession(a: {
    platform: 'ios' | 'android'; sessionId: string; requestId: string; accountId: string; apiBase: string; socketBase: string;
    instanceId: string; deviceId: string | null; tokens: { accessToken: string; refreshToken: string }; configHash?: string;
    model?: NativeModelPayload | null;
    /** Android·iOS: 네이티브가 밴드를 잡기 전에 JS(BLE 플러그인) 연결을 놓는다. 같은 링크에 두 클라이언트가 CCCD 를 쓰면 PPG/ACC 구독이 깨진다. */
    releaseJsBand?: () => Promise<unknown>;
  }): Promise<StartMeasurementResult> {
    const inflight = this.startFlights.get(a.requestId);
    if (inflight) return inflight;
    const p = (async () => {
      // Capacitor 프록시는 구현 없는 메서드도 truthy 다 — 존재 검사로는 못 거른다. 이 메서드는 iOS 에만 있다.
      // iOS 도 JS(BLE 플러그인) 연결을 먼저 실제로 끊는다 — 소유 플래그만 내리면 JS 가 같은 밴드를 계속 잡아 native 와 구독이 겹친다.
      if (a.platform === 'ios' && a.releaseJsBand) {
        try { await a.releaseJsBand(); } catch { /* 계속 */ }
      }
      if (a.platform === 'ios' && this.plugin.setJSBandOwnership) {
        const r = await this.plugin.setJSBandOwnership({ owning: false });
        if (!r.accepted) throw new Error('js_band_release_failed');
      }
      if (a.platform === 'android' && a.releaseJsBand) {
        // 해제 실패는 시작을 막지 않는다(수신 여부는 snapshot 의 ppgPackets 로 진단).
        try { await a.releaseJsBand(); } catch { /* 계속 */ }
      }
      return this.doStartWithCredentials({
        platform: a.platform, sessionId: a.sessionId, requestId: a.requestId, accountId: a.accountId, apiBase: a.apiBase,
        socketBase: a.socketBase, configHash: a.configHash ?? 'linkband2-v1', instanceId: a.instanceId, tokens: a.tokens, model: a.model ?? null,
        ...(a.deviceId ? (a.platform === 'android' ? { address: a.deviceId } : { peripheralId: a.deviceId }) : {}),
      });
    })();
    this.startFlights.set(a.requestId, p);
    p.catch(() => { this.startFlights.delete(a.requestId); });
    return p;
  }

  /**
   * 기기 시트 원시 파형 미리보기. Capacitor 프록시는 없는 메서드도 truthy 라 platform 으로 거르고,
   * 미구현(UNIMPLEMENTED)·형식 불일치는 null 로 폴백한다.
   */
  async getRawPreview(platform: string, seconds = 4, points = 120): Promise<RawPreview | null> {
    if ((platform !== 'android' && platform !== 'ios') || !this.plugin.getRawPreview) return null;
    try {
      const r = await this.plugin.getRawPreview({ seconds, points });
      const ok = (a: unknown): a is number[] => Array.isArray(a) && a.every((v) => typeof v === 'number');
      if (!r || !ok(r.eegFp1) || !ok(r.eegFp2) || !ok(r.ppgRed) || !ok(r.ppgIr)) return null;
      return { eegFp1: r.eegFp1, eegFp2: r.eegFp2, ppgRed: r.ppgRed, ppgIr: r.ppgIr };
    } catch { return null; }
  }

  /** 네이티브 소유 밴드 재연결(iOS). 미지원 플랫폼·수집 전·실패는 false — 호출자가 JS BLE 로 폴백하지 않는다. */
  async reconnectBand(platform: string): Promise<boolean> {
    if (platform !== 'ios' || !this.plugin.reconnectBand) return false;
    try { return (await this.plugin.reconnectBand()).accepted === true; } catch { return false; }
  }

  /** 토큰 모양 필드를 실어 버린 bridge 이벤트 수(진단용) */
  droppedSecretEvents(): number {
    return this.droppedSecrets;
  }

  stop(req: { reason: string; requestId: string }): Promise<{ accepted: boolean }> {
    return this.plugin.stopMeasurement(req);
  }

  dispatchLiveCommand(cmd: LiveCommand): Promise<DispatchLiveCommandResult> {
    return this.plugin.dispatchLiveCommand(cmd);
  }

  private accept(snap: MeasurementSnapshot): boolean {
    if (!isU64(snap.seq) || !isU64(snap.managerGeneration)) return false; // 측정 전·형식 불일치 스냅샷은 무시(attach 를 깨뜨리지 않는다)
    const seq = BigInt(snap.seq);
    if (this.generation === snap.managerGeneration && seq <= this.lastSeq) return false;
    if (this.generation !== null && BigInt(snap.managerGeneration) < BigInt(this.generation)) return false;
    this.generation = snap.managerGeneration;
    this.lastSeq = seq;
    for (const cb of this.measurementCbs) cb(snap);
    return true;
  }

  private onEvent(e: BridgeEvent): void {
    // native 는 토큰을 이벤트로 되돌리면 안 된다(bridge 계약). 섞여 오면 화면에 전달하지 않고 버린다.
    if (containsSecret(e.payload, [])) { this.droppedSecrets += 1; return; }
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
    const snap = normalizeSnapshot(await this.plugin.getMeasurementSnapshot({ sessionId: this.sessionId }));
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
