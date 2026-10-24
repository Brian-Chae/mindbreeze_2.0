/**
 * SDD-244 T09 — 처리기 emit을 모두 보존하는 feature 수집기.
 * emit마다 FeatureRecord 1건(중첩 창도 별도 feature_id/sequence)을 만들고, 원창이 raw 청크로 봉인된 뒤
 * 10초/1MiB 묶음 gzip JSONL(feature) + 파형/SQI 배열 묶음(raw_derived)으로 영속 큐에 넣는다.
 * 저장 빈도와 분석 빈도는 별개: 1Hz로 줄이지 않는다. 수집 중이 아니면 아무것도 하지 않는다.
 */
import type { ArtifactMeta } from '../api/biosignal';
import type { BiosignalQueue } from './durable-queue';
import { sha256, type BiosignalCaptureSession, type SampleWindow } from './capture-session';
import { buildFeatureRecord, derivedPayloads, type AlgorithmSnapshot, type FeatureRecord, type FeatureResult, type Scalars, type SourceWindow } from './feature-record';
import { sampleTimeUs } from './raw-clock';
import type { Signal } from './raw-types';

export const ALGORITHM_VERSIONS: Record<Signal, string> = { eeg: '1', ppg: '1', acc: '1' };
const ALGORITHM_PARAMETERS: Record<Signal, Record<string, number | string | boolean | number[]>> = {
  eeg: { sample_rate_hz: 250, min_window_samples: 500, channels: 'fp1,fp2' },
  ppg: { sample_rate_hz: 50, channels: 'red,ir' },
  acc: { sample_rate_hz: 30, channels: 'x,y,z' },
};
export const BUNDLE_MAX_AGE_MS = 10_000;
export const BUNDLE_SOFT_BYTES = 800_000;
export const MAX_PENDING = 2000;

export interface EmitContext {
  window: SampleWindow | null; windowIndex: number;
  /** 처리기 밖에서 오는 보조 스칼라(rmssd·호흡·motion 등) */
  extras?: Partial<Scalars>;
}
interface Pending {
  signal: Signal; sequence: number; alias: string; result: FeatureResult; window: SampleWindow; windowIndex: number;
  extras: Partial<Scalars>; computedAtUs: string; emittedMs: number; payloads: Record<string, unknown>; bytes: number;
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(new TextEncoder().encode(text)).then(() => writer.close());
  return new Response(stream.readable).arrayBuffer();
}
const short = (id: string) => id.replace(/-/g, '').slice(0, 8);

export class FeatureCollector {
  unresolved = 0;
  private readonly queue: BiosignalQueue;
  private readonly session: BiosignalCaptureSession;
  private readonly now: () => number;
  private readonly playGroupId: () => string | null;
  private pending: Pending[] = [];
  private sequences = new Map<Signal, number>();
  private featureBundles = new Map<string, number>();
  private derivedBundles = new Map<string, number>();
  private algorithms = new Map<Signal, AlgorithmSnapshot>();
  private chain: Promise<void> = Promise.resolve();

  constructor(options: { queue: BiosignalQueue; session: BiosignalCaptureSession; createId?: () => string; now?: () => number; playGroupId?: () => string | null }) {
    this.queue = options.queue; this.session = options.session;
    this.now = options.now ?? Date.now; this.playGroupId = options.playGroupId ?? (() => null);
  }
  get pendingCount(): number { return this.pending.length; }

  /** 분석 콜백에서 동기 호출. 무거운 일은 flush에서 한다. */
  emit(signal: Signal, data: Record<string, unknown>, context: EmitContext): void {
    const window = context.window;
    if (!window) return;
    if (this.pending.length >= MAX_PENDING) { this.unresolved += 1; return; }   // 가득 찬 경우도 조용히 버리지 않고 센다
    const sequence = this.sequences.get(signal) ?? 0;
    this.sequences.set(signal, sequence + 1);
    const result: FeatureResult = { signal, data };
    const payloads = derivedPayloads(result);
    const bytes = JSON.stringify(payloads).length + 4000;
    this.pending.push({ signal, sequence, alias: `FEAT-${signal.toUpperCase()}-${short(window.streamId)}-${String(sequence).padStart(8, '0')}`, result, window,
      windowIndex: context.windowIndex, extras: context.extras ?? {}, computedAtUs: (BigInt(this.now()) * 1000n).toString(), emittedMs: this.now(), payloads, bytes });
  }

  /** 원창이 봉인된 항목만 묶는다. force=true(종료)에서는 가능한 범위로 묶고, 전혀 못 찾으면 unresolved로 센다. */
  flush(force = false): Promise<void> {
    this.chain = this.chain.then(() => this.run(force)).catch(error => { console.error('feature 묶음 실패 — 항목 보존', error); });
    return this.chain;
  }

  private sources(p: Pending): { windows: SourceWindow[]; complete: boolean } {
    const w = p.window, ranges = this.session.sealedOverlap(w);
    const rel = (i: number) => sampleTimeUs(i, { numerator: w.rate, denominator: 1 }, 0, w.anchorRelUs);
    let covered = 0;
    const windows = ranges.map(r => {
      const first = Math.max(r.first, w.first), end = Math.min(r.end, w.end);
      covered += end - first;
      return { signal: w.signal, stream_alias: `STREAM-${short(w.streamId)}`, segment_alias: `SEG-${short(w.segmentId)}`, raw_artifact_id_alias: r.alias, raw_sha256: r.sha256,
        first_sample_index: first, end_sample_index_exclusive: end, time_range: { from_us: rel(first), to_us: rel(end - 1) }, valid_sample_count: end - first };
    });
    return { windows, complete: covered >= w.end - w.first };
  }

  private async algorithm(signal: Signal): Promise<AlgorithmSnapshot> {
    let snapshot = this.algorithms.get(signal);
    if (!snapshot) {
      const parameters = ALGORITHM_PARAMETERS[signal];
      const hash = await sha256(new TextEncoder().encode(JSON.stringify({ id: `mb-web-${signal}`, version: ALGORITHM_VERSIONS[signal], parameters })).buffer as ArrayBuffer);
      snapshot = { algorithm_id: `mb-web-${signal}`, algorithm_version: ALGORITHM_VERSIONS[signal], parameters_hash: hash, parameters, filter_version: ALGORITHM_VERSIONS[signal], build: 'web' };
      this.algorithms.set(signal, snapshot);
      const payload = new TextEncoder().encode(JSON.stringify(snapshot));
      const buffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
      await this.queue.enqueueArtifact({ artifact_alias: `ALGO-${signal.toUpperCase()}-${hash.slice(0, 8)}`, artifact_kind: 'algorithm', stream_id: null, segment_id: null, signal, sequence: 0,
        row_count: 1, content_encoding: 'identity', schema_version: 'algorithm-v1', checksum: await sha256(buffer), size_bytes: buffer.byteLength, content_type: 'application/json' }, buffer);
    }
    return snapshot;
  }

  private async run(force: boolean): Promise<void> {
    const groups = new Map<string, Pending[]>();
    const keep: Pending[] = [];
    for (const p of this.pending) {
      const { windows, complete } = this.sources(p);
      if (!complete && !force) { keep.push(p); continue; }
      if (!windows.length) { this.unresolved += 1; continue; }
      const key = `${p.signal}|${p.window.streamId}|${p.window.segmentId}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    this.pending = keep;
    for (const items of groups.values()) {
      // 10초 미만·소량이면 다음 flush로 미룬다(종료 시 force).
      const bytes = items.reduce((sum, p) => sum + p.bytes, 0);
      const age = this.now() - Math.min(...items.map(p => p.emittedMs));
      if (!force && age < BUNDLE_MAX_AGE_MS && bytes < BUNDLE_SOFT_BYTES) { this.pending.push(...items); continue; }
      try { await this.bundle(items); } catch (error) { this.pending.push(...items); throw error; }
    }
  }

  private async bundle(items: Pending[]): Promise<void> {
    const first = items[0], signal = first.signal, w = first.window;
    const algorithm = await this.algorithm(signal);
    const groupKey = `${signal}|${w.streamId}|${w.segmentId}`;
    const derivedSeq = this.derivedBundles.get(groupKey) ?? 0, featureSeq = this.featureBundles.get(groupKey) ?? 0;
    const suffix = `${signal.toUpperCase()}-${short(w.streamId)}-${short(w.segmentId)}`;
    const derivedAlias = `DERIVED-${suffix}-${String(derivedSeq).padStart(6, '0')}`;
    const derivedText = items.map(p => JSON.stringify({ feature_id_alias: p.alias, first_sample_index: p.window.first, fields: p.payloads })).join('\n') + '\n';
    const derivedBytes = await gzip(derivedText);
    const derivedSha = await sha256(derivedBytes);
    await this.queue.enqueueArtifact({ artifact_alias: derivedAlias, artifact_kind: 'raw_derived', stream_id: w.streamId, segment_id: w.segmentId, signal, sequence: derivedSeq,
      row_count: items.length, content_encoding: 'gzip', schema_version: 'raw-derived-v1', checksum: derivedSha, uncompressed_sha256: await sha256(new TextEncoder().encode(derivedText).buffer as ArrayBuffer),
      size_bytes: derivedBytes.byteLength, content_type: 'application/gzip' }, derivedBytes);
    this.derivedBundles.set(groupKey, derivedSeq + 1);

    const records: FeatureRecord[] = items.map(p => {
      const { windows } = this.sources(p);
      const lastIndex = p.window.end - 1;
      const measuredUtc = sampleTimeUs(lastIndex, { numerator: p.window.rate, denominator: 1 }, 0, p.window.anchorUtcUs);
      const rel = sampleTimeUs(lastIndex, { numerator: p.window.rate, denominator: 1 }, 0, p.window.anchorRelUs);
      return buildFeatureRecord({ result: p.result, sequence: p.sequence, featureAlias: p.alias, playGroupId: this.playGroupId(), windowIndex: p.windowIndex,
        tRelMs: Number(BigInt(rel)) / 1000, computedAtUs: p.computedAtUs, measuredAtUs: measuredUtc, algorithm, sourceWindows: windows, firstSample: p.window.first, extras: p.extras,
        // 같은 묶음 안의 어느 줄인지 구별되도록 field_path에 feature_id_alias를 접두한다.
        ref: (path, count) => ({ artifact_id_alias: derivedAlias, sha256: derivedSha, field_path: `${p.alias}/${path}`, first_sample_index: p.window.first, sample_count: count, availability: 'available', unavailable_reason: null }) }).record;
    });
    const text = records.map(r => JSON.stringify(r)).join('\n') + '\n';
    const bytes = await gzip(text);
    const meta: ArtifactMeta = { artifact_alias: `FEATURES-${suffix}-${String(featureSeq).padStart(6, '0')}`, feature_id_aliases: records.map(r => r.feature_id_alias), artifact_kind: 'feature',
      stream_id: w.streamId, segment_id: w.segmentId, signal, sequence: featureSeq, first_sequence: records[0].sequence, last_sequence: records[records.length - 1].sequence, row_count: records.length,
      content_encoding: 'gzip', schema_version: 'feature-v1', checksum: await sha256(bytes), uncompressed_sha256: await sha256(new TextEncoder().encode(text).buffer as ArrayBuffer),
      size_bytes: bytes.byteLength, time_range: { from_us: records[0].source_windows[0].time_range.from_us, to_us: records[records.length - 1].source_windows.at(-1)!.time_range.to_us }, content_type: 'application/gzip' };
    await this.queue.enqueueArtifact(meta, bytes);
    this.featureBundles.set(groupKey, featureSeq + 1);
    this.session.noteFeatureSequence(signal, records[records.length - 1].sequence);
  }
}
