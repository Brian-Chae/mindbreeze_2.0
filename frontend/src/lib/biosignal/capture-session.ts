/**
 * SDD-244 T08 — 원문 수집 세션. BLE 원문(RawPacket) → 영속 journal → 신호별 raw-v2 청크 봉인 → 큐.
 * receive()는 동기: 메모리 사본을 inflight로 잡고 journal 영속 성공 후에만 해제한다.
 * 실패(쓰기/lease/quota/메모리 상한)는 침묵하지 않고 수집을 중단하며 gap을 남긴다.
 * 밴드 미연결 시에는 receive가 호출되지 않으므로 기존 동작에 영향이 없다.
 */
import type { CloseIntent, ExpectedArtifact, GapEvent, RawMeta, StreamClose, ViewClose } from '../api/biosignal';
import { ACC_ADC_SCALE, EEG_ADC_SCALE } from './raw-capture';
import { BiosignalClock, sampleTimeUs } from './raw-clock';
import { encodeRawV2, rawSections } from './raw-encoder';
import type { BiosignalQueue, JournalPacket } from './durable-queue';
import type { MappedPacket, RawHeader, RawPacket, Signal } from './raw-types';

export type CaptureStatus = 'idle' | 'running' | 'stopped';
export type StopReason = 'journal_failed' | 'seal_failed' | 'lease_lost' | 'memory_cap' | 'quota' | 'closed';
export const SIGNALS: Signal[] = ['eeg', 'ppg', 'acc'];
const RATES: Record<Signal, number> = { eeg: 250, ppg: 50, acc: 30 };
const SAMPLE_STRIDE: Record<Signal, number> = { eeg: 17, ppg: 8, acc: 18 };
const SCALES: Record<Signal, number[]> = { eeg: [EEG_ADC_SCALE, EEG_ADC_SCALE], ppg: [1, 1], acc: [ACC_ADC_SCALE, ACC_ADC_SCALE, ACC_ADC_SCALE] };
const CHANNELS: Record<Signal, { channels: string[]; units: string[] }> = {
  eeg: { channels: ['fp1', 'fp2'], units: ['uV', 'uV'] }, ppg: { channels: ['red', 'ir'], units: ['ADC_count', 'ADC_count'] }, acc: { channels: ['x', 'y', 'z'], units: ['g', 'g', 'g'] },
};
export const CHUNK_SECONDS = 10;
export const CHUNK_SOFT_BYTES = 900_000;
export const MAX_UNPERSISTED_BYTES = 8 * 1024 * 1024;
const QUOTA_STOP_RATIO = 0.95;
const QUOTA_WARN_RATIO = 0.8;
const MIN_FREE_BYTES = 2_000_000; // 약 2분 수신량(EEG+PPG+ACC 원문+샘플 섹션 합 ≈ 12KB/s 이내)
const MAP_ROW_ESTIMATE = 260;

interface SegmentStats { lastEmitted: boolean; received: number }
interface SignalState {
  streamId: string; clock: BiosignalClock; segmentId: string; seq: number; nextSample: number;
  unsealedSamples: number; unsealedBytes: number; anchor: JournalPacket['segmentAnchor'] | null;
  segments: Map<string, SegmentStats>; lastReceivedUtcUs: string;
}
export interface SampleWindow {
  signal: Signal; streamId: string; segmentId: string; first: number; end: number; rate: number;
  /** 첫 샘플(segment index 0)의 UTC·회차 상대 µs 기준점 */
  anchorUtcUs: string; anchorRelUs: string;
}
export interface SealedRange { signal: Signal; streamId: string; segmentId: string; alias: string; sha256: string; first: number; end: number }
export interface CaptureOptions {
  queue: BiosignalQueue; createId?: () => string; now?: () => number;
  quota?: () => Promise<{ usage: number; quota: number } | null>;
  onStatus?: (status: CaptureStatus, reason: StopReason | null) => void;
}

export async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('crypto_subtle_unavailable');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))).map(b => b.toString(16).padStart(2, '0')).join('');
}
const alias = (signal: Signal, stream: string, segment: string, index: number) =>
  `RAW-${signal.toUpperCase()}-${stream.replace(/-/g, '').slice(0, 8)}-${segment.replace(/-/g, '').slice(0, 8)}-${String(index).padStart(6, '0')}`;

export class BiosignalCaptureSession {
  status: CaptureStatus = 'idle';
  stopReason: StopReason | null = null;
  quotaWarning = false;
  droppedWhileStopped = 0;
  private readonly queue: BiosignalQueue;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly states = new Map<Signal, SignalState>();
  private chain: Promise<void> = Promise.resolve();
  private inflightBytes = 0;
  private originMono: string | null = null;
  private profileHash = '';
  private disconnectedAtUs: string | null = null;
  private reconnects = 0;
  private featureSequences = new Map<Signal, number>();
  private snapshotCloses = new Map<string, ViewClose>();
  private sealedRanges: SealedRange[] = [];

  private readonly options: CaptureOptions;
  constructor(options: CaptureOptions) {
    this.options = options;
    this.queue = options.queue;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
  }
  private nowUs(): string { return (BigInt(this.now()) * 1000n).toString(); }

  async start(): Promise<void> {
    await this.queue.acquire();
    this.profileHash = await sha256(new TextEncoder().encode(JSON.stringify({ profile: 'mb-web-clock-v1', rates: RATES, tick_hz: 32768, tick_bits: 32, anchor: 'last_sample' })).buffer as ArrayBuffer);
    await this.recover();
    this.setStatus('running', null);
  }

  /** 이전 실행이 남긴 journal: 새 청크로 봉인하고, 마지막 영속 이후는 unknown tail gap으로 남긴다. */
  private async recover(): Promise<void> {
    const groups = new Map<string, JournalPacket[]>();
    for (const p of await this.queue.allPackets()) {
      const key = `${p.signal}|${p.streamId}|${p.segmentId}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    for (const packets of groups.values()) {
      const sorted = [...packets].sort((a, b) => a.seq - b.seq);
      const first = sorted[0], last = sorted[sorted.length - 1];
      await this.sealPackets(first.signal as Signal, first.streamId, first.segmentId);
      await this.queue.addGap({ event_id: this.createId(), discovered_at_us: this.nowUs(), signal: first.signal as Signal, stream_id: first.streamId, segment_id: first.segmentId,
        start_us: last.receivedUtcUs, end_us: null, reason: 'process_terminated', observed_or_estimated: 'unknown', expected_samples: null, received_samples: null, reconnect_count: this.reconnects });
    }
  }

  private setStatus(status: CaptureStatus, reason: StopReason | null): void {
    this.status = status; this.stopReason = reason;
    this.options.onStatus?.(status, reason);
  }

  private state(signal: Signal, utcUs: string, monoUs: string): SignalState {
    let s = this.states.get(signal);
    if (!s) {
      const clock = new BiosignalClock(this.createId);
      s = { streamId: this.createId(), clock, segmentId: '', seq: 0, nextSample: 0, unsealedSamples: 0, unsealedBytes: 0, anchor: null, segments: new Map(), lastReceivedUtcUs: utcUs };
      this.states.set(signal, s);
    }
    this.originMono ??= monoUs;
    return s;
  }

  /** BLE 콜백 첫 단계에서 동기 호출. 반환 전에 메모리 사본 소유권을 잡는다. */
  receive(packet: RawPacket): void {
    if (this.status !== 'running') { this.droppedWhileStopped += 1; return; }
    const signal = packet.signal;
    const s = this.state(signal, packet.receivedUtcUs, packet.receivedMonotonicUs);
    s.lastReceivedUtcUs = packet.receivedUtcUs;
    const rows = packet.rows.length;
    let tickUnwrapped: string | null = null;
    let reason: string | null = null;
    if (packet.tickRaw !== null) {
      const obs = s.clock.observe(packet.tickRaw, packet.receivedUtcUs, packet.receivedMonotonicUs);
      tickUnwrapped = obs.unwrappedTick; reason = obs.reason;
      if (obs.segmentId !== s.segmentId) {
        if (s.segmentId) this.rollSegment(signal, s, reason, packet.receivedUtcUs);
        s.segmentId = obs.segmentId; s.nextSample = 0; s.unsealedSamples = 0; s.unsealedBytes = 0;
        s.segments.set(s.segmentId, { lastEmitted: false, received: 0 });
        // 첫 샘플 시각 = 마지막 샘플 시각(tick 기준)에서 (rows-1)개 전
        const firstUtc = rows > 0 ? sampleTimeUs(0, { numerator: RATES[signal], denominator: 1 }, rows - 1, obs.mappedUtcUs) : obs.mappedUtcUs;
        s.anchor = { utcUs: firstUtc, monotonicUs: packet.receivedMonotonicUs, tickRaw: obs.rawTick, tickUnwrapped: obs.unwrappedTick, originMonotonicUs: this.originMono! };
      }
    } else if (!s.segmentId) {
      s.segmentId = this.createId(); s.segments.set(s.segmentId, { lastEmitted: false, received: 0 });
      s.anchor = { utcUs: packet.receivedUtcUs, monotonicUs: packet.receivedMonotonicUs, tickRaw: null, tickUnwrapped: null, originMonotonicUs: this.originMono! };
    }
    const segmentId = s.segmentId, streamId = s.streamId;
    const record: JournalPacket = {
      id: `${this.queue.scopeKey}|${signal}|${streamId}|${segmentId}|${String(s.seq).padStart(10, '0')}`,
      accountId: '', sessionId: '', participantId: null, // queue.journalPacket이 범위를 채운다
      signal, streamId, segmentId, seq: s.seq, bytes: packet.bytes.buffer.slice(packet.bytes.byteOffset, packet.bytes.byteOffset + packet.bytes.byteLength) as ArrayBuffer,
      tickRaw: packet.tickRaw, tickUnwrapped, receivedUtcUs: packet.receivedUtcUs, receivedMonotonicUs: packet.receivedMonotonicUs, malformedReason: packet.malformedReason,
      firstSampleIndex: s.nextSample, sampleCount: rows, segmentAnchor: s.anchor!,
    };
    s.seq += 1; s.nextSample += rows; s.unsealedSamples += rows;
    s.unsealedBytes += packet.bytes.length + rows * SAMPLE_STRIDE[signal] + MAP_ROW_ESTIMATE;
    s.segments.get(segmentId)!.received += rows;

    this.inflightBytes += packet.bytes.length;
    if (this.inflightBytes > MAX_UNPERSISTED_BYTES) { this.stop('memory_cap', signal, s, packet.receivedUtcUs); return; }
    const size = packet.bytes.length;
    this.enqueue(async () => {
      if (this.status !== 'running') { this.droppedWhileStopped += 1; this.inflightBytes -= size; return; }
      try { await this.queue.journalPacket(record); } catch (error) {
        this.inflightBytes -= size;
        this.stop(error instanceof Error && error.message.startsWith('lease') ? 'lease_lost' : 'journal_failed', signal, s, packet.receivedUtcUs);
        return;
      }
      this.inflightBytes -= size;
    });
    if (s.unsealedSamples >= CHUNK_SECONDS * RATES[signal] || s.unsealedBytes >= CHUNK_SOFT_BYTES) {
      s.unsealedSamples = 0; s.unsealedBytes = 0;
      this.enqueue(() => this.sealPackets(signal, streamId, segmentId));
    }
  }

  /** clock 사유로 segment가 바뀌면 이전 segment를 부분 청크로 봉인하고 gap을 남긴다. */
  private rollSegment(signal: Signal, s: SignalState, reason: string | null, utcUs: string): void {
    const oldSegment = s.segmentId, streamId = s.streamId;
    this.enqueue(() => this.sealPackets(signal, streamId, oldSegment));
    this.enqueue(async () => {
      try {
        await this.queue.addGap({ event_id: this.createId(), discovered_at_us: this.nowUs(), signal, stream_id: streamId, segment_id: oldSegment, start_us: utcUs, end_us: utcUs,
          reason: (reason ?? 'reanchor') as GapEvent['reason'], observed_or_estimated: 'observed', expected_samples: null, received_samples: null, reconnect_count: this.reconnects });
      } catch { /* lease 상실 등: stop 경로가 별도로 기록 */ }
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch(error => {
      this.stop(error instanceof Error && error.message.startsWith('lease') ? 'lease_lost' : 'seal_failed', null, null, this.nowUs());
    });
  }

  /** 수집 중단: 사유를 상태로 노출하고, 영속 가능하면 unknown gap을 신호별로 남긴다. */
  private stop(reason: StopReason, signal: Signal | null, state: SignalState | null, utcUs: string): void {
    if (this.status === 'stopped') return;
    this.setStatus('stopped', reason);
    const targets = signal && state ? [[signal, state] as const] : [...this.states.entries()];
    for (const [sig, st] of targets) {
      if (!st.segmentId) continue;
      void this.queue.addGap({ event_id: this.createId(), discovered_at_us: this.nowUs(), signal: sig, stream_id: st.streamId, segment_id: st.segmentId, start_us: utcUs, end_us: null,
        reason: 'local_write_failed', observed_or_estimated: 'unknown', expected_samples: null, received_samples: null, reconnect_count: this.reconnects }).catch(() => undefined);
    }
  }

  private async sealPackets(signal: Signal, streamId: string, segmentId: string): Promise<void> {
    const packets = await this.queue.packets(signal, streamId, segmentId);
    if (!packets.length) return;
    const index = await this.queue.nextIndex(signal, streamId, segmentId);
    const mapped: MappedPacket[] = [];
    let offset = 0, samples = 0;
    for (const p of packets) {
      const bytes = new Uint8Array(p.bytes);
      mapped.push({ bytes, map: { packet_seq: p.seq, byte_offset: offset, byte_length: bytes.length, first_sample_index: p.sampleCount ? p.firstSampleIndex : null, sample_count: p.sampleCount,
        tick_raw: p.tickRaw === null ? null : String(p.tickRaw), tick_unwrapped: p.tickUnwrapped, received_utc_us: p.receivedUtcUs, received_monotonic_us: p.receivedMonotonicUs,
        header_anchor: 'last_sample', clock_segment_id: segmentId, malformed_reason: p.malformedReason } });
      offset += bytes.length; samples += p.sampleCount;
    }
    const a = packets[0].segmentAnchor;
    const body: Omit<RawHeader, 'sections'> = {
      schema_version: 'mb-biosignal-raw-v2', signal_type: signal, stream_id: streamId, segment_id: segmentId, chunk_index: index,
      parser_profile: { firmware: 'unknown', device_model: 'LINK-BAND-2.0', profile_id: 'mb-web-clock-v1', version: '1', parameters_hash: this.profileHash,
        platform: 'mb-web', verification: 'unverified', packet_endian: 'mixed', tick_hz: 32768, tick_bits: 32, header_anchor: 'last_sample' },
      rate: { numerator: RATES[signal], denominator: 1 }, observed_rate: null, observed_rate_window_us: null, observed_rate_reason: 'not_measured',
      channels: CHANNELS[signal].channels, units: CHANNELS[signal].units, scale: SCALES[signal],
      sample_count: samples, packet_count: packets.length, first_sample_index: packets[0].firstSampleIndex, end_sample_index_exclusive: packets[0].firstSampleIndex + samples,
      time_basis: 'host_estimated',
      anchor: { sample_index: 0, utc_us: a.utcUs, monotonic_us: a.monotonicUs, relative_us: (BigInt(a.monotonicUs) - BigInt(a.originMonotonicUs)).toString(),
        device_tick_raw: a.tickRaw, device_tick_unwrapped: a.tickUnwrapped, clock_segment_id: segmentId, uncertainty_us: null, rule: 'anchor_plus_index_delta_over_rate' },
    };
    const header: RawHeader = { ...body, sections: rawSections(body, mapped) };
    const bytes = encodeRawV2(header, mapped);
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const meta: RawMeta = { chunk_alias: alias(signal, streamId, segmentId, index), header, checksum: await sha256(payload), size_bytes: payload.byteLength, content_type: 'application/octet-stream' };
    await this.queue.sealRaw(meta, payload, packets.map(p => p.id));
    this.sealedRanges.push({ signal, streamId, segmentId, alias: meta.chunk_alias, sha256: meta.checksum, first: packets[0].firstSampleIndex, end: packets[0].firstSampleIndex + samples });
    const stats = this.states.get(signal)?.segments.get(segmentId);
    if (stats) stats.lastEmitted = true;
  }

  async flush(): Promise<void> { await this.chain; }

  /** 열린 segment의 남은 journal을 모두 봉인한다(종료 전 feature 원창 해소용). close intent는 만들지 않는다. */
  async sealOpen(): Promise<void> {
    await this.flush();
    if (this.status !== 'running') return;
    for (const [signal, s] of this.states) if (s.segmentId) this.enqueue(() => this.sealPackets(signal, s.streamId, s.segmentId));
    await this.flush();
  }

  /** 외부(lease 갱신 실패 등)에서 수집을 중단한다. */
  abort(reason: StopReason): void { this.stop(reason, null, null, this.nowUs()); }

  /** 언마운트/탭 이동: close intent 없이 열린 청크만 봉인하고 lease를 반납한다(종료 사유는 알 수 없음). */
  async pause(): Promise<void> {
    await this.flush();
    if (this.status === 'running') {
      for (const [signal, s] of this.states) if (s.segmentId) this.enqueue(() => this.sealPackets(signal, s.streamId, s.segmentId));
      await this.flush();
      this.setStatus('stopped', 'closed');
    }
    await this.queue.release().catch(() => undefined);
  }

  /** BLE 단절/재연결: 단절 구간은 observed gap, 샘플 손실 수는 알 수 없으므로 null. */
  markDisconnected(): void { this.disconnectedAtUs ??= this.nowUs(); }
  markReconnected(): void {
    const start = this.disconnectedAtUs; if (!start) return;
    this.disconnectedAtUs = null; this.reconnects += 1;
    const end = this.nowUs();
    for (const [signal, s] of this.states) {
      if (!s.segmentId) continue;
      const streamId = s.streamId, segmentId = s.segmentId;
      this.enqueue(async () => { try { await this.queue.addGap({ event_id: this.createId(), discovered_at_us: end, signal, stream_id: streamId, segment_id: segmentId, start_us: start, end_us: end,
        reason: 'ble_disconnect', observed_or_estimated: 'observed', expected_samples: null, received_samples: null, reconnect_count: this.reconnects }); } catch { /* stop 경로가 기록 */ } });
    }
  }

  /** quota 80% 경고, 95% 또는 여유 2분 미만이면 안전 중단. 경고 후 삭제로 공간을 만들지 않는다. 추정 불가면 쓰기 실패 즉시 중단에 맡긴다. */
  async checkQuota(): Promise<void> {
    const estimate = this.options.quota ? await this.options.quota() : (typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate().then(e => ({ usage: e.usage ?? 0, quota: e.quota ?? 0 })) : null);
    if (!estimate || !estimate.quota) return;
    const ratio = estimate.usage / estimate.quota;
    this.quotaWarning = ratio >= QUOTA_WARN_RATIO;
    if (this.status === 'running' && (ratio >= QUOTA_STOP_RATIO || estimate.quota - estimate.usage < Math.min(MIN_FREE_BYTES, estimate.quota * 0.05))) {
      this.stop('quota', null, null, this.nowUs());
    }
  }

  streamId(signal: Signal): string | null { return this.states.get(signal)?.streamId ?? null; }

  /** 지금까지 수신한 마지막 count개 샘플의 창(분석 emit의 원창 추정). 수집 중인 segment가 없으면 null. */
  sampleWindow(signal: Signal, count: number): SampleWindow | null {
    const s = this.states.get(signal);
    if (!s || !s.segmentId || !s.anchor) return null;
    const end = s.nextSample;
    return { signal, streamId: s.streamId, segmentId: s.segmentId, first: Math.max(0, end - count), end, rate: RATES[signal],
      anchorUtcUs: s.anchor.utcUs, anchorRelUs: (BigInt(s.anchor.monotonicUs) - BigInt(s.anchor.originMonotonicUs)).toString() };
  }
  /** 봉인된 raw 청크 중 창과 겹치는 범위(샘플 인덱스 오름차순). */
  sealedOverlap(window: SampleWindow): SealedRange[] {
    return this.sealedRanges.filter(r => r.signal === window.signal && r.streamId === window.streamId && r.segmentId === window.segmentId && r.end > window.first && r.first < window.end)
      .sort((a, b) => a.first - b.first);
  }

  noteFeatureSequence(signal: Signal, sequence: number): void { this.featureSequences.set(signal, Math.max(sequence, this.featureSequences.get(signal) ?? -1)); }
  noteSnapshotSequence(streamId: string, viewInstanceId: string, sequence: number): void {
    const key = `${streamId}|${viewInstanceId}`;
    this.snapshotCloses.set(key, { stream_id: streamId, view_instance_id: viewInstanceId, last_snapshot_sequence: Math.max(sequence, this.snapshotCloses.get(key)?.last_snapshot_sequence ?? -1) });
  }

  /** 종료: 남은 청크 봉인 → 전체 expected set·마지막 sequence를 로컬에 먼저 기록한다(서버 응답 이전). */
  async close(endReason: string): Promise<CloseIntent> {
    await this.flush();
    if (this.status === 'running') {
      if (this.disconnectedAtUs) {
        for (const [signal, s] of this.states) if (s.segmentId) await this.queue.addGap({ event_id: this.createId(), discovered_at_us: this.nowUs(), signal, stream_id: s.streamId, segment_id: s.segmentId,
          start_us: this.disconnectedAtUs, end_us: null, reason: 'ble_disconnect', observed_or_estimated: 'observed', expected_samples: null, received_samples: null, reconnect_count: this.reconnects });
      }
      for (const [signal, s] of this.states) if (s.segmentId) this.enqueue(() => this.sealPackets(signal, s.streamId, s.segmentId));
      await this.flush();
    }
    const streams: StreamClose[] = [];
    for (const [signal, s] of this.states) {
      for (const [segmentId, stats] of s.segments) {
        const next = await this.queue.nextIndex(signal, s.streamId, segmentId);
        streams.push({ stream_id: s.streamId, segment_id: segmentId, signal, last_chunk_sequence: next > 0 ? next - 1 : null,
          last_feature_sequence: this.featureSequences.get(signal) ?? null, received_samples: stats.received });
      }
    }
    const seen = new Set<string>();
    const expected: ExpectedArtifact[] = [];
    for (const item of [...(await this.queue.expected()), ...(await this.queue.objects()).map(o => ({ kind: o.kind, alias: o.alias, sha256: o.meta.checksum }))]) {
      const key = `${item.kind}|${item.alias}`;
      if (!seen.has(key)) { seen.add(key); expected.push(item); }
    }
    const intent: CloseIntent = { event_type: 'close_intent', intent_id: this.createId(), expected_artifacts: expected, streams, snapshots: [...this.snapshotCloses.values()],
      last_gap_sequence: await this.queue.lastGapSequence(), end_reason: endReason, closed_at_us: this.nowUs() };
    await this.queue.addEvent(intent);
    if (this.status === 'running') this.setStatus('stopped', 'closed');
    return intent;
  }
}
