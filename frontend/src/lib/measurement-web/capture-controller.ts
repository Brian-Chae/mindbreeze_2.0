// SDD-246 T06 — 웹 측정 capture 흐름: capture.start → (reanchor) → live:metric 배치 → 주기 capture.renew → capture.close.
// 미착용·EEG 미동의면 어떤 요청도 만들지 않는다.
// T06c(T05b 계약): stream_id·participant_id·generation·lease 는 capture.start ACK `result` 에서 바로 읽는다(device 이벤트 대기 없음).
// generation/owner_generation 은 u64 십진 문자열 그대로 다룬다(Number 변환 금지, 비교는 compareU64).
import type { DeviceSendOutcome, LiveClient } from '../session-live/live-client';
import { compareU64 } from '../session-live/live-state';
import type { BandState, CommandAck, Contact, DeviceData } from '../session-live/live-types';
import type { MetricEnvelope } from './envelope';
import { MetricOutbox, type FeatureResult, type OutboxStore } from './metric-outbox';
import { postFeatureBatch, type FeatureAuth } from '../api/feature-batch';

/** feature 정본 REST 배치 전송 주기(5초). 1초 tick 이 불러도 이 간격으로만 보낸다(종료·복귀는 force) */
export const FEATURE_FLUSH_INTERVAL_MS = 5_000;

/** 서버 capture lease 는 30초 — 10초마다 갱신해 두 번 실패해도 끊기지 않게 한다 */
export const RENEW_INTERVAL_MS = 10_000;
/** 시계 기준점 재설정 주기(native 와 같은 5분). 서버 probe 유효시간(10초) 안에 reanchor 가 도착해야 time_uncertain 이 풀린다 */
export const REANCHOR_INTERVAL_MS = 5 * 60_000;
/**
 * SDD-272 — 시각 보정 실패(probe 없음·거절·clock_uncertain=true) 시 짧은 간격 재시도. 소진하면 위 5분 주기만 남는다.
 * 서버는 probe 후 10초 안의 reanchor 만 인정하므로 매 재시도는 새 probe 부터 시작한다(오래된 probe 재사용 금지).
 */
export const REANCHOR_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000, 15_000];

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
  /**
   * reanchor 기준점 시계(µs) — 반드시 envelope window_*_us 와 같은 시간축이어야 한다.
   * 서버는 창 시각을 anchor_server_at + (window_end_us − monotonic_us) 로 환산한다. 웹 코어는 패킷마다 받은
   * WallAnchor(wall_ms) 로 window 를 UTC µs 로 내므로 기본값은 Date.now()×1000 이다(T06c 로컬 왕복에서 확인).
   */
  anchorClockUs?: () => number;
  /** 최근 패킷의 장치 tick(십진 문자열). 모르면 '0' */
  deviceTicks?: () => string;
  /** fencing·권한 회수·종료로 수집이 멈췄을 때(code = 서버 거절 코드 또는 stream 상태) */
  onStopped?: (code: string) => void;
  /** SDD-260: outbox 소유 계정(로그아웃·계정 전환 시 다른 계정 창을 건드리지 않는다) */
  accountId: string;
  /** SDD-260: REST 인증(JWT 또는 입장 자격) */
  featureAuth?: FeatureAuth;
  /** SDD-260: 테스트용 주입 */
  sendFeatures?: (participantId: string, windows: MetricEnvelope[]) => Promise<FeatureResult[]>;
  outboxStore?: OutboxStore;
  now?: () => number;
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
  private reanchorRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private reanchorRetryIndex = 0;
  private readonly anchorId: string;
  private outbox: MetricOutbox | null = null;
  private lastFlushAt = 0;
  private deviceSeq = 0n;
  private deviceStopped = false;

  constructor(o: CaptureControllerOptions) {
    this.o = o;
    this.anchorId = (o.uuid ?? (() => crypto.randomUUID()))();
  }

  /** 참가자 확정 후(capture.start ACK) outbox 를 만든다 — 정본 저장은 REST 배치 */
  private makeOutbox(participantId: string): MetricOutbox {
    return new MetricOutbox({
      scope: { accountId: this.o.accountId, sessionId: this.o.sessionId, participantId },
      store: this.o.outboxStore,
      now: this.o.now,
      send: async (w) => {
        if (this.o.sendFeatures) return this.o.sendFeatures(participantId, w);
        return (await postFeatureBatch(this.o.sessionId, participantId, w, this.o.featureAuth ?? {})).results;
      },
    });
  }

  /** 재전송 가능한 미전송 창 수(비동기 집계 전 동기 근사: 마지막 조회값) */
  outboxHandle(): MetricOutbox | null {
    return this.outbox;
  }

  capture(): CaptureInfo | null {
    return this.info;
  }

  streamId(): string | null {
    return this.info?.streamId ?? null;
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
    this.outbox = this.makeOutbox(r.participant_id);
    this.deviceSeq = 0n;
    this.deviceStopped = false;
    this.renewTimer = setInterval(() => { void this.renew(); }, RENEW_INTERVAL_MS);
    this.reanchorTimer = setInterval(() => { this.reanchorRetryIndex = 0; void this.reanchorWithRetry(); }, REANCHOR_INTERVAL_MS);
    this.reanchorRetryIndex = 0;
    void this.reanchorWithRetry();
    return 'started';
  }

  /** 코어 envelope 을 대기열에 넣고 보낸다. stream 이 없으면 false. 신원·세대 필드는 ACK 값으로 덮는다(코어 meta 를 믿지 않음). */
  pushEnvelope(envelope: MetricEnvelope): boolean {
    const i = this.info;
    const ob = this.outbox;
    if (!i || !ob) return false;
    const env: MetricEnvelope = {
      ...envelope,
      session_id: this.o.sessionId,
      participant_id: i.participantId,
      stream_id: i.streamId,
      stream_generation: i.generation,
      clock_anchor_id: i.clockAnchorId,
    };
    // 정본: 영속 outbox 적재 → REST 배치. 소켓은 방송 전용(결과를 보지 않는다, 실패해도 저장과 무관).
    void ob.enqueue(env).then(() => this.flush()).catch(() => undefined);
    void this.o.client.sendMetricBatch([env]).catch(() => undefined);
    return true;
  }

  /** 5초 주기로 REST 배치 전송(호출자가 1초 tick 등으로 불러도 간격을 지킨다). force 면 즉시 */
  async flush(force = false): Promise<void> {
    const ob = this.outbox;
    if (!ob) return;
    const t = (this.o.now ?? Date.now)();
    if (!force && t - this.lastFlushAt < FEATURE_FLUSH_INTERVAL_MS) return;
    this.lastFlushAt = t;
    await ob.flush();
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

  /** 한 번 시도하고, 실패하면 다음 재시도를 예약한다(성공하면 재시도 없음). 5분 주기·start 가 이 함수를 부른다. */
  private async reanchorWithRetry(): Promise<void> {
    if (this.reanchorRetryTimer) { clearTimeout(this.reanchorRetryTimer); this.reanchorRetryTimer = null; }
    const streamId = this.info?.streamId;
    if (!streamId) return;
    const ok = await this.reanchorNow().catch(() => false);
    if (ok || this.info?.streamId !== streamId) return;
    const delay = REANCHOR_RETRY_DELAYS_MS[this.reanchorRetryIndex];
    if (delay === undefined) return;
    this.reanchorRetryIndex += 1;
    this.reanchorRetryTimer = setTimeout(() => { this.reanchorRetryTimer = null; void this.reanchorWithRetry(); }, delay);
  }

  /** 지금 시각으로 기준점을 다시 잡는다(clock_probe → capture.reanchor). */
  reanchorNow(): Promise<boolean> {
    const at = Math.round((this.o.anchorClockUs ?? (() => Date.now() * 1000))());
    return this.reanchor({ deviceTicks: (this.o.deviceTicks ?? (() => '0'))(), monotonicUs: String(at) });
  }

  async reanchor(anchor: { deviceTicks: string; monotonicUs: string }): Promise<boolean> {
    const i = this.info;
    if (!i) return false;
    const probe = await this.o.client.clockProbe(() => Number(anchor.monotonicUs));
    if (!probe || this.info?.streamId !== i.streamId) return false;
    const ack = await this.o.client.request('capture.reanchor', {
      stream_id: i.streamId, clock_probe_id: probe.probeId, device_ticks: anchor.deviceTicks, monotonic_us: anchor.monotonicUs,
    });
    // 서버가 probe 를 확인해야(clock_uncertain=false) 보정 완료다. 확인 못 했으면 실패로 보고 재시도한다.
    return isOk(ack) && (ack.result as { clock_uncertain?: boolean } | undefined)?.clock_uncertain !== true;
  }

  async close(reason: string, finalSequences?: { eeg: string; ppg: string; acc: string; metric: string }): Promise<void> {
    const i = this.info;
    this.stopTimers();
    this.info = null;
    if (!i) return;
    await this.o.client.request('capture.close', {
      stream_id: i.streamId, reason,
      final_sequences: finalSequences ?? { eeg: '0', ppg: '0', acc: '0', metric: '0' },
    }).catch(() => undefined);
    // 종료 비차단: 마지막 배치 전송을 한 번 시도하고, 남은 창은 outbox(IndexedDB)가 끝까지 올린다(스위퍼).
    this.outbox?.resetBackoff();
    void this.outbox?.flushAll().catch(() => undefined);
  }

  /** 서버가 이 stream 을 더 받지 않는다 — 요청 없이 로컬만 멈춘다(close 는 서버 쪽에서 이미 정리됨) */
  private halt(code: string): void {
    const i = this.info;
    if (!i) return;
    this.stopTimers();
    this.info = null;
    this.o.onStopped?.(code); // 서버가 소켓 stream 을 닫아도 로컬 창은 outbox 에 남아 REST 로 계속 올라간다
  }

  private stopTimers(): void {
    if (this.renewTimer) clearInterval(this.renewTimer);
    if (this.reanchorTimer) clearInterval(this.reanchorTimer);
    if (this.reanchorRetryTimer) clearTimeout(this.reanchorRetryTimer);
    this.reanchorRetryTimer = null;
    this.renewTimer = null;
    this.reanchorTimer = null;
  }
}
