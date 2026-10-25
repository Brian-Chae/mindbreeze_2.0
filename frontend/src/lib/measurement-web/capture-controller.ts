// SDD-246 T06 — 웹 측정 capture 흐름: capture.start → live:metric → 주기 capture.renew → capture.reanchor(clock_probe) → capture.close.
// 미착용·EEG 미동의면 어떤 요청도 만들지 않는다. stream_id/generation 은 ACK 가 아니라 서버 device 이벤트(LiveState)에서 읽는다.
import type { LiveClient } from '../session-live/live-client';

export const RENEW_INTERVAL_MS = 20_000;

export type CaptureClientLike = Pick<LiveClient, 'request' | 'sendMetric' | 'clockProbe'>;

export interface CaptureControllerOptions {
  client: CaptureClientLike;
  eegConsent: boolean;
  bandConnected: boolean;
  deviceProfile: string;
  algorithmVersion: string;
  modelVersion: string;
  /** 서버가 내린 내 stream (device 도메인). 아직 없으면 null */
  readStream: () => { streamId: string; generation: string } | null;
  uuid?: () => string;
}

export type StartResult = 'started' | 'rejected' | 'not_allowed';

export class CaptureController {
  private readonly o: CaptureControllerOptions;
  private stream: { streamId: string; generation: string } | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private anchorId: string;

  constructor(o: CaptureControllerOptions) {
    this.o = o;
    this.anchorId = (o.uuid ?? (() => crypto.randomUUID()))();
  }

  streamId(): string | null {
    return this.stream?.streamId ?? null;
  }

  async start(): Promise<StartResult> {
    if (this.stream) return 'started';
    if (!this.o.bandConnected || !this.o.eegConsent) return 'not_allowed';
    const ack = await this.o.client.request('capture.start', {
      device_profile: this.o.deviceProfile,
      algorithm_version: this.o.algorithmVersion,
      model_version: this.o.modelVersion,
    });
    if (ack.status !== 'applied' && ack.status !== 'duplicate') return 'rejected';
    // device 이벤트는 commit 뒤 방송되므로 최대 ~2초 기다린다.
    for (let i = 0; i < 20 && !this.stream; i += 1) {
      const s = this.o.readStream();
      if (s) { this.stream = s; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!this.stream) return 'rejected';
    this.renewTimer = setInterval(() => { void this.renew(); }, RENEW_INTERVAL_MS);
    return 'started';
  }

  /** 코어 envelope 을 live:metric 으로 보낸다. stream 이 없거나 전송 불가면 false(호출자가 큐잉/재시도 판단). */
  pushEnvelope(envelope: Record<string, unknown>): boolean {
    if (!this.stream) return false;
    return this.o.client.sendMetric({ ...envelope, stream_id: this.stream.streamId, stream_generation: this.stream.generation });
  }

  async renew(): Promise<void> {
    if (!this.stream) return;
    await this.o.client.request('capture.renew', {
      stream_id: this.stream.streamId, owner_generation: this.stream.generation, clock_anchor_id: this.anchorId,
    });
  }

  async reanchor(anchor: { deviceTicks: string; monotonicUs: string }): Promise<boolean> {
    if (!this.stream) return false;
    const probe = await this.o.client.clockProbe(() => Number(anchor.monotonicUs));
    if (!probe) return false;
    const ack = await this.o.client.request('capture.reanchor', {
      stream_id: this.stream.streamId, clock_probe_id: probe.probeId, device_ticks: anchor.deviceTicks, monotonic_us: anchor.monotonicUs,
    });
    return ack.status === 'applied' || ack.status === 'duplicate';
  }

  async close(reason: string, finalSequences?: { eeg: string; ppg: string; acc: string; metric: string }): Promise<void> {
    const s = this.stream;
    this.stop();
    if (!s) return;
    await this.o.client.request('capture.close', {
      stream_id: s.streamId, reason,
      final_sequences: finalSequences ?? { eeg: '0', ppg: '0', acc: '0', metric: '0' },
    });
  }

  private stop(): void {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = null;
    this.stream = null;
  }
}
