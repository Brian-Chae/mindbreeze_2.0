// SDD-246 T06 — 웹 측정 capture 흐름: capture.start → (reanchor) → live:metric 배치 → 주기 capture.renew → capture.close.
// 미착용·EEG 미동의면 어떤 요청도 만들지 않는다.
// T06c(T05b 계약): stream_id·participant_id·generation·lease 는 capture.start ACK `result` 에서 바로 읽는다(device 이벤트 대기 없음).
// generation/owner_generation 은 u64 십진 문자열 그대로 다룬다(Number 변환 금지, 비교는 compareU64).
import type { DeviceSendOutcome, LiveClient } from '../session-live/live-client';
import { compareU64 } from '../session-live/live-state';
import type { BandState, CommandAck, Contact, DeviceData } from '../session-live/live-types';
import type { MetricEnvelope } from './envelope';
import { MetricOutbox } from './metric-outbox';

/** 서버 capture lease 는 30초 — 10초마다 갱신해 두 번 실패해도 끊기지 않게 한다 */
export const RENEW_INTERVAL_MS = 10_000;
/** 시계 기준점 재설정 주기(native 와 같은 5분). 서버 probe 유효시간(10초) 안에 reanchor 가 도착해야 time_uncertain 이 풀린다 */
export const REANCHOR_INTERVAL_MS = 5 * 60_000;

export type CaptureClientLike = Pick<LiveClient, 'request' | 'sendMetricBatch' | 'sendDevice' | 'clockProbe'>;

export interface CaptureControllerOptions {
  client: CaptureClientLike;
  sessionId: string;
  eegConsent: boolean;
  bandConnected: boolean;
  deviceProfile: string;
  algorithmVersion: string;
  modelVersion: string;
  uuid?: () => string;
  /** envelope window_*_us 와 같은 시간축(µs). 기본 performance.now()×1000 */
  monotonicUs?: () => number;
  /** 최근 패킷의 장치 tick(십진 문자열). 모르면 '0' */
  deviceTicks?: () => string;
  /** fencing·권한 회수·종료로 수집이 멈췄을 때(code = 서버 거절 코드 또는 stream 상태) */
  onStopped?: (code: string) => void;
}

export type StartResult = 'started' | 'rejected' | 'not_allowed';

export interface CaptureInfo {
  streamId: string;
  participantId: string;
  generation: string;
  leaseExpiresAtMs: number | null;
  clockAnchorId: string;
}

export interface BandReport {
  band_state: BandState;
  contact: Contact;
  sqi: number | null;
  battery_pct: number | null;
  state_reason: string | null;
}

export type DeviceReportResult = 'accepted' | 'duplicate' | 'stopped' | 'not_sent' | 'error';

/** renew 거절 중 수집을 계속할 수 없는 코드 */
const RENEW_FATAL = new Set(['stale_owner_generation', 'stream_not_active', 'session_ended', 'stream_not_found', 'invalid_stream_id']);

const isOk = (ack: CommandAck): boolean => ack.status === 'applied' || ack.status === 'duplicate';

export class CaptureController {
  private readonly o: CaptureControllerOptions;
  private info: CaptureInfo | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private reanchorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly anchorId: string;
  private readonly outbox: MetricOutbox;
  private deviceSeq = 0n;
  private deviceStopped = false;

  constructor(o: CaptureControllerOptions) {
    this.o = o;
    this.anchorId = (o.uuid ?? (() => crypto.randomUUID()))();
    this.outbox = new MetricOutbox({
      send: (w) => this.o.client.sendMetricBatch(w),
      onFenced: (code, streamId) => { if (this.info?.streamId === streamId) this.halt(code); },
    });
  }

  capture(): CaptureInfo | null {
    return this.info;
  }

  streamId(): string | null {
    return this.info?.streamId ?? null;
  }

  pendingMetricCount(): number {
    return this.outbox.pendingKeys().length;
  }

  async start(): Promise<StartResult> {
    if (this.info) return 'started';
    if (!this.o.bandConnected || !this.o.eegConsent) return 'not_allowed';
    const ack = await this.o.client.request('capture.start', {
      device_profile: this.o.deviceProfile,
      algorithm_version: this.o.algorithmVersion,
      model_version: this.o.modelVersion,
    });
    const r = ack.result;
    // T05b: capture.start 성공 ACK 는 result 에 stream·participant·세대를 반드시 싣는다. 없으면 추측하지 않고 실패로 둔다.
    if (!isOk(ack) || !r?.stream_id || !r.participant_id || !(r.owner_generation ?? r.generation)) return 'rejected';
    this.info = {
      streamId: r.stream_id,
      participantId: r.participant_id,
      generation: (r.owner_generation ?? r.generation) as string,
      leaseExpiresAtMs: r.lease?.expires_at_ms ?? null,
      clockAnchorId: this.anchorId,
    };
    this.deviceSeq = 0n;
    this.deviceStopped = false;
    this.renewTimer = setInterval(() => { void this.renew(); }, RENEW_INTERVAL_MS);
    this.reanchorTimer = setInterval(() => { void this.reanchorNow(); }, REANCHOR_INTERVAL_MS);
    void this.reanchorNow();
    return 'started';
  }

  /** 코어 envelope 을 대기열에 넣고 보낸다. stream 이 없으면 false. 신원·세대 필드는 ACK 값으로 덮는다(코어 meta 를 믿지 않음). */
  pushEnvelope(envelope: MetricEnvelope): boolean {
    const i = this.info;
    if (!i) return false;
    this.outbox.enqueue({
      ...envelope,
      session_id: this.o.sessionId,
      participant_id: i.participantId,
      stream_id: i.streamId,
      stream_generation: i.generation,
      clock_anchor_id: i.clockAnchorId,
    });
    void this.outbox.flush();
    return true;
  }

  /** 재시도 대기 창을 보낸다(호출자가 1초 tick 등으로 부른다) */
  flush(): Promise<void> {
    return this.outbox.flush();
  }

  /** 밴드 상태 보고. device_seq 는 stream 마다 1부터 단조. stream_not_active 를 받으면 이후 보고하지 않는다. */
  async reportDevice(band: BandReport): Promise<DeviceReportResult> {
    const i = this.info;
    if (this.deviceStopped) return 'stopped';
    if (!i) return 'not_sent';
    const seq = this.deviceSeq + 1n;
    const out: DeviceSendOutcome = await this.o.client.sendDevice({
      session_id: this.o.sessionId,
      stream_id: i.streamId,
      device_seq: seq.toString(),
      band_state: band.band_state,
      contact: band.contact,
      sqi: band.sqi,
      battery_pct: band.battery_pct,
      state_reason: band.state_reason,
    });
    if (out.kind === 'not_sent') return 'not_sent';
    if (out.kind === 'ack') { this.deviceSeq = seq; return out.status; }
    if (out.code === 'stream_not_active' || out.code === 'stream_not_found') { this.deviceStopped = true; return 'stopped'; }
    return 'error';
  }

  /**
   * 서버 device.changed(합집합 스키마)로 owner 교체·권한 회수를 판단한다.
   * - 내 stream 의 status 가 active 가 아니면 멈춘다(cutoff_code 우선).
   * - 같은 참가자의 더 큰 generation 이 보이면 다른 기기/탭이 owner → superseded.
   */
  observeDevice(d: DeviceData): void {
    const i = this.info;
    if (!i || d.participant_id !== i.participantId) return;
    if (d.stream_id === i.streamId) {
      if (d.status && d.status !== 'active') this.halt(d.cutoff_code ?? `stream_${d.status}`);
      return;
    }
    if (d.generation && compareU64(d.generation, i.generation) > 0) this.halt('superseded');
  }

  async renew(): Promise<void> {
    const i = this.info;
    if (!i) return;
    const ack = await this.o.client.request('capture.renew', {
      stream_id: i.streamId, owner_generation: i.generation, clock_anchor_id: i.clockAnchorId,
    });
    if (this.info?.streamId !== i.streamId) return;
    if (isOk(ack)) {
      const exp = ack.result?.lease?.expires_at_ms;
      if (exp !== undefined) this.info = { ...i, leaseExpiresAtMs: exp };
      return;
    }
    if (ack.status === 'rejected' && ack.code && RENEW_FATAL.has(ack.code)) this.halt(ack.code);
  }

  /** 지금 시각으로 기준점을 다시 잡는다(clock_probe → capture.reanchor). */
  reanchorNow(): Promise<boolean> {
    const mono = Math.round((this.o.monotonicUs ?? (() => performance.now() * 1000))());
    return this.reanchor({ deviceTicks: (this.o.deviceTicks ?? (() => '0'))(), monotonicUs: String(mono) });
  }

  async reanchor(anchor: { deviceTicks: string; monotonicUs: string }): Promise<boolean> {
    const i = this.info;
    if (!i) return false;
    const probe = await this.o.client.clockProbe(() => Number(anchor.monotonicUs));
    if (!probe || this.info?.streamId !== i.streamId) return false;
    const ack = await this.o.client.request('capture.reanchor', {
      stream_id: i.streamId, clock_probe_id: probe.probeId, device_ticks: anchor.deviceTicks, monotonic_us: anchor.monotonicUs,
    });
    return isOk(ack);
  }

  async close(reason: string, finalSequences?: { eeg: string; ppg: string; acc: string; metric: string }): Promise<void> {
    const i = this.info;
    this.stopTimers();
    this.info = null;
    if (!i) return;
    this.outbox.discardStream(i.streamId);
    await this.o.client.request('capture.close', {
      stream_id: i.streamId, reason,
      final_sequences: finalSequences ?? { eeg: '0', ppg: '0', acc: '0', metric: '0' },
    });
  }

  /** 서버가 이 stream 을 더 받지 않는다 — 요청 없이 로컬만 멈춘다(close 는 서버 쪽에서 이미 정리됨) */
  private halt(code: string): void {
    const i = this.info;
    if (!i) return;
    this.stopTimers();
    this.info = null;
    this.outbox.discardStream(i.streamId);
    this.o.onStopped?.(code);
  }

  private stopTimers(): void {
    if (this.renewTimer) clearInterval(this.renewTimer);
    if (this.reanchorTimer) clearInterval(this.reanchorTimer);
    this.renewTimer = null;
    this.reanchorTimer = null;
  }
}
