import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { BiosignalQueue, type CaptureScope } from '../src/lib/biosignal/durable-queue';
import { BiosignalCaptureSession } from '../src/lib/biosignal/capture-session';
import { FeatureCollector } from '../src/lib/biosignal/feature-collector';
import { parseRawPacket } from '../src/lib/biosignal/raw-capture';
import type { ArtifactMeta, RawMeta } from '../src/lib/api/biosignal';

const scope: CaptureScope = { accountId: 'a', sessionId: 's', participantId: 'p', deviceAlias: 'LINK-BAND' };
let uuid = 0;
const createId = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`;
function eegPackets(count: number) {
  return Array.from({ length: count }, (_, n) => {
    const bytes = new Uint8Array(4 + 50 * 7);
    new DataView(bytes.buffer).setUint32(0, Math.round(n * 0.2 * 32768), true);
    const mono = String(1_000_000 + n * 200_000);
    return parseRawPacket('eeg', new DataView(bytes.buffer), String(1_780_000_000_000_000n + BigInt(mono)), mono);
  });
}
const eegResult = (n = 500) => ({
  filteredData: Array.from({ length: n }, (_, i) => ({ timestamp: 1000 + i * 4, fp1: i, fp2: -i })),
  signalQuality: { overall: 90, fp1: 90, fp2: 90, sqi: [1] }, bandPowers: { delta: 1, theta: 1, alpha: 1, beta: 1, gamma: 1 },
  brainState: { currentState: 'neutral', confidence: 0.5, stateHistory: [] }, frequencySpectrum: { frequencies: [1], ch1Power: [1], ch2Power: [1], timestamp: 1 },
  indices: { focusIndex: 1, relaxationIndex: 1, stressIndex: 1, hemisphericBalance: 0, cognitiveLoad: 1, emotionalStability: 1, totalPower: 1, totalNeuralActivity: 2, faa: 0.1 },
  rawAnalysis: { ch1SQI: [1], ch2SQI: [1], overallSQI: [1] },
});
async function setup() {
  const queue = new BiosignalQueue(scope, 'tab-a');
  const session = new BiosignalCaptureSession({ queue, createId });
  await session.start();
  const collector = new FeatureCollector({ queue, session, createId });
  return { queue, session, collector };
}
const artifacts = async (queue: BiosignalQueue) => (await queue.objects()).filter(o => o.kind !== 'raw');
beforeEach(() => { uuid = 0; globalThis.indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

describe('SDD244 T09 FeatureCollector', () => {
  it('모든 emit을 raw 청크에 연결된 feature JSONL+raw-derived 객체로 묶고 sha로 상호 참조한다', async () => {
    const { queue, session, collector } = await setup();
    for (const p of eegPackets(50)) session.receive(p);     // 2500샘플 → raw 청크 0 봉인
    await session.flush();
    const win = session.sampleWindow('eeg', 500)!;
    for (let i = 0; i < 3; i++) collector.emit('eeg', eegResult(), { window: win, windowIndex: i });   // 같은 창을 3번 emit(중첩)
    await collector.flush(true);
    const all = await artifacts(queue);
    const feature = all.find(o => o.kind === 'feature')!, derived = all.find(o => o.kind === 'raw_derived')!;
    const meta = feature.meta as ArtifactMeta;
    expect(meta).toMatchObject({ content_encoding: 'gzip', row_count: 3, schema_version: 'feature-v1', signal: 'eeg' });
    expect(meta.feature_id_aliases).toHaveLength(3);
    const text = gunzipSync(Buffer.from(feature.payload)).toString();
    expect(createHash('sha256').update(Buffer.from(feature.payload)).digest('hex')).toBe(meta.checksum);
    expect(createHash('sha256').update(text).digest('hex')).toBe(meta.uncompressed_sha256);
    const lines = text.trim().split('\n').map(l => JSON.parse(l));
    expect(lines.map(l => l.sequence)).toEqual([0, 1, 2]);
    expect(new Set(lines.map(l => l.feature_id_alias)).size).toBe(3);   // 중첩 emit도 덮어쓰기 없이 3건
    const rawMeta = (await queue.objects()).find(o => o.kind === 'raw')!.meta as RawMeta;
    expect(lines[0].source_windows[0]).toMatchObject({ raw_artifact_id_alias: rawMeta.chunk_alias, raw_sha256: rawMeta.checksum, first_sample_index: 2000, end_sample_index_exclusive: 2500, valid_sample_count: 500 });
    expect(lines[0].eeg.filteredData).toMatchObject({ artifact_id_alias: derived.alias, sha256: derived.meta.checksum });
    expect(lines[0].scalars).toMatchObject({ total_neural_activity: 2, faa: 0.1 });
    expect(JSON.stringify(lines[0])).not.toContain('"fp2":-1');
    const derivedLines = gunzipSync(Buffer.from(derived.payload)).toString().trim().split('\n').map(l => JSON.parse(l));
    expect(derivedLines).toHaveLength(3);
    expect(derivedLines[0].fields.filteredData).toHaveLength(500);
    expect(all.some(o => o.kind === 'algorithm')).toBe(true);
  });

  it('원창이 아직 봉인 전이면 보류하고, 봉인 뒤에 묶는다', async () => {
    const { queue, session, collector } = await setup();
    for (const p of eegPackets(52)) session.receive(p);     // 2600샘플: 청크0(2500)만 봉인, 100샘플은 journal
    await session.flush();
    collector.emit('eeg', eegResult(), { window: session.sampleWindow('eeg', 500)!, windowIndex: 0 });
    await collector.flush(false);
    expect(collector.pendingCount).toBe(1);
    expect((await artifacts(queue)).filter(o => o.kind === 'feature')).toHaveLength(0);
    await session.close('user_end');
    await collector.flush(true);
    expect(collector.pendingCount).toBe(0);
    const feature = (await artifacts(queue)).find(o => o.kind === 'feature')!;
    const line = JSON.parse(gunzipSync(Buffer.from(feature.payload)).toString().trim());
    expect(line.source_windows).toHaveLength(2);        // 청크0 일부 + 청크1(봉인된 부분 청크)
    expect(line.source_windows.reduce((s: number, w: { valid_sample_count: number }) => s + w.valid_sample_count, 0)).toBe(500);
  });

  it('수집 중이 아니면(밴드 미연결·세그먼트 없음) emit은 아무것도 만들지 않는다', async () => {
    const { queue, session, collector } = await setup();
    expect(session.sampleWindow('eeg', 500)).toBeNull();
    collector.emit('eeg', eegResult(), { window: null, windowIndex: 0 });
    await collector.flush(true);
    expect(await artifacts(queue)).toHaveLength(0);
    expect(collector.pendingCount).toBe(0);
  });

  it('raw 청크가 전혀 없는 창은 강제 flush에서도 조용히 사라지지 않고 unresolved로 센다', async () => {
    const { session, collector } = await setup();
    for (const p of eegPackets(2)) session.receive(p);      // 100샘플, 봉인 전
    await session.flush();
    collector.emit('eeg', eegResult(100), { window: session.sampleWindow('eeg', 100)!, windowIndex: 0 });
    await expect(collector.flush(true)).rejects.toThrow('feature_source_pending');
    expect(collector.unresolved).toBe(1);
    expect(collector.pendingCount).toBe(1);
  });
});

describe('SDD244 업로드 계약 — presign 422 방지', () => {
  // 서버 ArtifactPresignChunk: size_bytes ≤ 1 MiB, feature_id_aliases ≤ 2000 (backend/app/schemas/biosignal.py)
  const SERVER_MAX_BYTES = 1_048_576, SERVER_MAX_ALIASES = 2000;
  const noisy = (n: number) => { const r = eegResult(n); r.filteredData = r.filteredData.map(d => ({ ...d, fp1: Math.random() * 1e3, fp2: Math.random() * 1e3 })); return r; };

  it('flush가 오래 밀려 emit이 쌓여도 모든 artifact가 서버 크기·alias 상한 안에서 묶인다', async () => {
    const { queue, session, collector } = await setup();
    for (const p of eegPackets(50)) session.receive(p);
    await session.flush();
    const win = session.sampleWindow('eeg', 500)!;
    for (let i = 0; i < 150; i++) collector.emit('eeg', noisy(500), { window: win, windowIndex: i });   // 업로드 pump 지연 동안 누적
    await collector.flush(true);
    const all = await artifacts(queue);
    const sizes = all.map(o => (o.meta as ArtifactMeta).size_bytes);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(SERVER_MAX_BYTES);
    for (const o of all) {
      const m = o.meta as ArtifactMeta;
      expect(o.payload.byteLength).toBe(m.size_bytes);
      expect((m.feature_id_aliases ?? []).length).toBeLessThanOrEqual(SERVER_MAX_ALIASES);
    }
    // 쪼개도 150건 모두 어떤 feature 묶음에 빠짐없이 들어 있다
    const featureRows = all.filter(o => o.kind === 'feature').reduce((n, o) => n + (o.meta as ArtifactMeta).row_count, 0);
    expect(featureRows).toBe(150);
    expect(all.filter(o => o.kind === 'raw_derived').length).toBeGreaterThan(1);
  });
});

describe('SDD244 업로드 계약 — time_range 역전 422 방지', () => {
  it('emit 순서가 창 순서와 뒤바뀌어도(분석 중첩 완료 순서) time_range 는 from ≤ to 다', async () => {
    const { queue, session, collector } = await setup();
    const packets = eegPackets(50);
    for (const p of packets.slice(0, 40)) session.receive(p);     // 2000샘플
    await session.flush();
    const early = session.sampleWindow('eeg', 500)!;               // 1500..2000
    for (const p of packets.slice(40)) session.receive(p);        // 2500샘플 → 청크 봉인
    await session.flush();
    const late = session.sampleWindow('eeg', 500)!;                // 2000..2500
    collector.emit('eeg', eegResult(), { window: late, windowIndex: 1 });    // 늦은 창이 먼저 emit
    collector.emit('eeg', eegResult(), { window: early, windowIndex: 0 });   // 이른 창이 나중에 emit
    await collector.flush(true);
    for (const o of (await artifacts(queue)).filter(a => a.kind === 'feature')) {
      const range = (o.meta as ArtifactMeta).time_range!;
      expect(BigInt(range.from_us) <= BigInt(range.to_us)).toBe(true);   // 서버 TimeRange.ordered 가 어기면 422
    }
  });
});
