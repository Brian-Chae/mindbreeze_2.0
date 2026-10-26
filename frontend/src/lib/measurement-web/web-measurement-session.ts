// SDD-246 T06c — 웹 회원 측정 한 회차: BLE 원문 패킷 → WASM 코어 Web Worker → MetricEnvelope → live:metric(CaptureController).
// 순서: (1) 미착용·EEG 미동의면 아무 것도 만들지 않는다 (2) 워커·WASM 을 먼저 올린다 — 실패하면 서버 요청 없이 core_unavailable
//       (3) capture.start ACK 로 stream 확보 (4) raw 패킷 구독·1초 tick(advance+재전송) 시작.
// 코어가 만든 envelope 의 신원·세대 필드는 쓰지 않는다 — CaptureController 가 ACK 값으로 덮는다.
import { subscribeRawPackets } from '../biosignal/raw-capture';
import type { RawPacket } from '../biosignal/raw-types';
import type { DeviceData } from '../session-live/live-types';
import { WebCaptureAdapter, type WorkerLike } from './capture-adapter';
import { CaptureController, type BandReport, type CaptureClientLike } from './capture-controller';
import { WEB_CORE_CONFIG, WEB_CORE_CONFIG_JSON } from './core-config';

export type WebMeasurementStatus = 'idle' | 'not_allowed' | 'core_unavailable' | 'rejected' | 'capturing' | 'stopped';

export const TICK_MS = 1_000;

export interface WebMeasurementDeps {
  client: CaptureClientLike;
  sessionId: string;
  createWorker: () => WorkerLike;
  subscribeRaw?: (fn: (p: RawPacket) => void) => () => void;
  monotonicUs?: () => number;
  uuid?: () => string;
  onStatus?: (s: WebMeasurementStatus, code: string | null) => void;
}

const sameBand = (a: BandReport | null, b: BandReport): boolean => a !== null
  && a.band_state === b.band_state && a.sqi === b.sqi && a.battery_pct === b.battery_pct && a.state_reason === b.state_reason
  && a.contact.fp1 === b.contact.fp1 && a.contact.fp2 === b.contact.fp2;

export class WebMeasurementSession {
  private readonly d: WebMeasurementDeps;
  private st: WebMeasurementStatus = 'idle';
  private adapter: WebCaptureAdapter | null = null;
  private controller: CaptureController | null = null;
  private unsubRaw: (() => void) | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private lastEegTick = '0';
  private lastBand: BandReport | null = null;
  private starting: Promise<WebMeasurementStatus> | null = null;

  constructor(d: WebMeasurementDeps) {
    this.d = d;
  }

  status(): WebMeasurementStatus {
    return this.st;
  }

  private set(s: WebMeasurementStatus, code: string | null = null): WebMeasurementStatus {
    this.st = s;
    this.d.onStatus?.(s, code);
    return s;
  }

  private mono(): number {
    return Math.round((this.d.monotonicUs ?? (() => performance.now() * 1000))());
  }

  start(args: { eegConsent: boolean; bandConnected: boolean }): Promise<WebMeasurementStatus> {
    if (this.st === 'capturing') return Promise.resolve(this.st);
    if (this.starting) return this.starting;
    this.starting = this.doStart(args).finally(() => { this.starting = null; });
    return this.starting;
  }

  private async doStart({ eegConsent, bandConnected }: { eegConsent: boolean; bandConnected: boolean }): Promise<WebMeasurementStatus> {
    if (!eegConsent || !bandConnected) return this.set('not_allowed');
    const controller = new CaptureController({
      client: this.d.client,
      sessionId: this.d.sessionId,
      eegConsent,
      bandConnected,
      deviceProfile: WEB_CORE_CONFIG.device_profile_version,
      algorithmVersion: WEB_CORE_CONFIG.algorithm_version,
      modelVersion: WEB_CORE_CONFIG.model_version,
      uuid: this.d.uuid,
      // reanchor 는 기본(Date.now()×1000) — 코어 window 가 wall µs 라서. this.mono()(도착 monotonic)는 advance 용이다.
      deviceTicks: () => this.lastEegTick,
      onStopped: (code) => { void this.teardown('stopped', code); },
    });
    const adapter = new WebCaptureAdapter({
      createWorker: this.d.createWorker,
      onEnvelope: (env) => { controller.pushEnvelope(env); },
      onCaptureRequest: () => undefined,
    });
    try {
      // 신원 필드는 자리표시 — 실제 값은 CaptureController 가 ACK result 로 덮는다.
      await adapter.start({
        sessionId: this.d.sessionId, participantId: 'pending', streamId: 'pending', streamGeneration: '0', clockAnchorId: 'pending',
        clockUncertaintyMs: 300_000, deviceProfileVersion: WEB_CORE_CONFIG.device_profile_version,
        algorithmVersion: WEB_CORE_CONFIG.algorithm_version, modelVersion: WEB_CORE_CONFIG.model_version,
        eegConsent, bandConnected, configJson: WEB_CORE_CONFIG_JSON,
      });
    } catch (e) {
      return this.set('core_unavailable', e instanceof Error ? e.message : 'core_unavailable');
    }
    const r = await controller.start();
    if (r !== 'started') {
      await adapter.stop();
      return this.set(r === 'not_allowed' ? 'not_allowed' : 'rejected');
    }
    this.adapter = adapter;
    this.controller = controller;
    this.unsubRaw = (this.d.subscribeRaw ?? subscribeRawPackets)((p) => this.onRaw(p));
    this.tick = setInterval(() => {
      this.adapter?.advance(this.mono());
      void this.controller?.flush();
    }, TICK_MS);
    return this.set('capturing');
  }

  private onRaw(p: RawPacket): void {
    const a = this.adapter;
    if (!a || p.malformedReason) return;
    if (p.signal === 'eeg' && p.tickRaw !== null) this.lastEegTick = String(p.tickRaw);
    // 원본 버퍼는 다른 수신자(T09 journal)가 소유한다 — 복사본만 워커로 transfer 한다.
    const arrivalUs = Number(p.receivedMonotonicUs);
    a.pushPacket({
      sensor: p.signal,
      bytes: p.bytes.slice(),
      arrivalUs,
      wallMs: Math.floor(Number(p.receivedUtcUs) / 1000),
      anchorUs: arrivalUs, // wall_ms 와 같은 순간의 monotonic(WallAnchor 쌍)
    });
  }

  /** 서버 device.changed — owner 교체·권한 회수면 CaptureController 가 onStopped 로 정리를 부른다 */
  observeDevice(d: DeviceData): void {
    this.controller?.observeDevice(d);
  }

  /** 밴드 상태 보고 — 바뀐 경우에만(live:device) */
  async reportBand(band: BandReport): Promise<void> {
    const c = this.controller;
    if (!c || sameBand(this.lastBand, band)) return;
    const r = await c.reportDevice(band);
    if (r === 'accepted' || r === 'duplicate') this.lastBand = band;
  }

  /** 사용자 종료·밴드 해제 — 코어 final_sequences 로 capture.close */
  async stop(reason: string): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    const c = this.controller;
    const final = await this.release();
    if (c) await c.close(reason, final?.final_sequences);
    if (this.st === 'capturing') this.set('stopped', reason);
  }

  private async teardown(status: WebMeasurementStatus, code: string): Promise<void> {
    this.controller = null; // 이미 서버가 끊었다 — close 요청 없음
    await this.release();
    this.set(status, code);
  }

  private async release() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    this.unsubRaw?.();
    this.unsubRaw = null;
    const a = this.adapter;
    this.adapter = null;
    this.controller = null;
    return a ? a.stop() : null;
  }
}
