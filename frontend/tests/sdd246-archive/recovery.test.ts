import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ArtifactMeta } from '../../src/lib/api/biosignal';
import { BiosignalQueue } from '../../src/lib/biosignal/durable-queue';
import { MAX_OBJECT_BYTES, recoverOversized } from '../../src/lib/biosignal/archive-recovery';
import { verifyArchiveCompleteness } from '../../src/lib/biosignal/archive-verify';
import { sha256 } from '../../src/lib/biosignal/capture-session';

const scope = { accountId: 'a', sessionId: 's', participantId: 'p', deviceAlias: 'band' };
const STREAM = '11111111-1111-4111-8111-111111111111', SEG = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

const buf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
/** 압축이 거의 안 되는 무작위 필드로 행을 만들어 gzip 후 크기가 1MiB를 넘게 한다. */
function rows(n: number) {
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed.toString(16); };
  return Array.from({ length: n }, (_, i) => ({ feature_id_alias: `FEAT-${i}`, sequence: i, noise: Array.from({ length: 40 }, rnd).join('') }));
}
async function oversized(queue: BiosignalQueue, n = 6000) {
  const data = rows(n); const text = data.map(r => JSON.stringify(r)).join('\n') + '\n';
  const gz = buf(gzipSync(Buffer.from(text)));
  const meta: ArtifactMeta = { artifact_alias: 'FEATURES-BIG-000000', feature_id_aliases: data.map(r => r.feature_id_alias), artifact_kind: 'feature', stream_id: STREAM, segment_id: SEG, signal: 'eeg',
    sequence: 0, first_sequence: 0, last_sequence: n - 1, row_count: n, content_encoding: 'gzip', schema_version: 'feature-v1', checksum: await sha256(gz),
    uncompressed_sha256: await sha256(buf(Buffer.from(text))), size_bytes: gz.byteLength, time_range: { from_us: '0', to_us: String(n * 1000) }, content_type: 'application/gzip' };
  return { meta, gz, data };
}

describe('SDD246 과대 artifact parent-alias 분할 복구', () => {
  it('1MiB 초과 feature 객체를 새 alias 자식들로 분할하고 부모는 superseded로 보존한다', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const { meta, gz, data } = await oversized(queue);
    expect(gz.byteLength).toBeGreaterThan(MAX_OBJECT_BYTES);
    await queue.enqueueArtifact(meta, gz);
    const out = await recoverOversized(queue);
    expect(out.recovered).toBe(1); expect(out.unrecoverable).toBe(0);
    const all = await queue.objects();
    const parent = all.find(o => o.alias === meta.artifact_alias)!;
    expect(parent.state).toBe('superseded'); expect(parent.payload.byteLength).toBe(gz.byteLength); // 원본 바이트 보존
    expect(parent.meta.checksum).toBe(meta.checksum);
    const kids = all.filter(o => o.parentAlias === meta.artifact_alias);
    expect(kids.length).toBeGreaterThan(1); expect(parent.splitInto).toEqual(kids.map(k => k.alias));
    const seqs = new Set<string>(); let rowsBack = 0; const ids: string[] = [];
    for (const k of kids) {
      expect(k.alias).not.toBe(meta.artifact_alias); expect(k.parentSha256).toBe(meta.checksum);
      expect(k.payload.byteLength).toBeLessThanOrEqual(MAX_OBJECT_BYTES); expect(k.meta.size_bytes).toBe(k.payload.byteLength);
      expect(k.meta.checksum).toBe(await sha256(k.payload)); expect(k.state).toBe('pending');
      expect(/^[A-Z][A-Za-z0-9_-]{0,63}$/.test(k.alias)).toBe(true);
      const m = k.meta as ArtifactMeta; seqs.add(String(m.sequence));
      const lines = gunzipSync(Buffer.from(k.payload)).toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
      expect(m.row_count).toBe(lines.length); expect(m.first_sequence).toBe(lines[0].sequence); expect(m.last_sequence).toBe(lines[lines.length - 1].sequence);
      expect(m.feature_id_aliases).toEqual(lines.map((l: { feature_id_alias: string }) => l.feature_id_alias));
      expect(m.uncompressed_sha256).toBe(await sha256(buf(gunzipSync(Buffer.from(k.payload)))));
      rowsBack += lines.length; ids.push(...lines.map((l: { feature_id_alias: string }) => l.feature_id_alias));
    }
    expect(seqs.size).toBe(kids.length); // slot(sequence) 중복 없음
    expect(rowsBack).toBe(data.length); expect(ids).toEqual(data.map(r => r.feature_id_alias)); // 행 손실·중복·순서 변경 없음
    // 자식 first/last 순번이 부모 범위를 정확히 이어 덮는다
    const ranges = kids.map(k => [(k.meta as ArtifactMeta).first_sequence!, (k.meta as ArtifactMeta).last_sequence!]).sort((a, b) => a[0] - b[0]);
    expect(ranges[0][0]).toBe(0); expect(ranges[ranges.length - 1][1]).toBe(data.length - 1);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1);
  });
  it('재실행해도 멱등 — 자식을 중복 만들지 않는다', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const { meta, gz } = await oversized(queue); await queue.enqueueArtifact(meta, gz);
    await recoverOversized(queue); const n = (await queue.objects()).length;
    expect((await recoverOversized(queue)).recovered).toBe(0); expect((await queue.objects()).length).toBe(n);
  });
  it('분할로 줄지 않는 단일 행/해석 불가 객체는 미복구로 남기고 원본을 삭제하지 않는다', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const junk = buf(new Uint8Array(MAX_OBJECT_BYTES + 10).map((_, i) => (i * 31 + 7) & 255));
    const meta: ArtifactMeta = { artifact_alias: 'FEATURES-JUNK', artifact_kind: 'feature', stream_id: STREAM, segment_id: SEG, signal: 'eeg', sequence: 5, row_count: 1, content_encoding: 'gzip', schema_version: 'feature-v1', checksum: await sha256(junk), size_bytes: junk.byteLength };
    await queue.enqueueArtifact(meta, junk);
    const out = await recoverOversized(queue);
    expect(out.unrecoverable).toBe(1);
    const [o] = await queue.objects(); expect(o.state).toBe('dead_letter'); expect(o.lastError).toBe('oversize_unrecoverable'); expect(o.payload.byteLength).toBe(junk.byteLength);
  });
  it('raw 청크는 재생성 정보가 없어 분할하지 않고 미복구로 둔다', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const fake = buf(new Uint8Array(8)); const header = { signal_type: 'eeg', stream_id: STREAM, segment_id: SEG, chunk_index: 0 } as never;
    await queue.sealRaw({ chunk_alias: 'RAW-EEG-1', header, checksum: await sha256(fake), size_bytes: MAX_OBJECT_BYTES + 1 }, fake, []).catch(() => undefined);
    const out = await recoverOversized(queue);
    expect(out.recovered).toBe(0);
  });
});

describe('SDD246 archive 완결성 검증(seal/manifest)', () => {
  const ok = { events: [], manifest_revision: 3, close_state: 'complete' as const, missing_artifacts: [] };
  it('모든 expected에 receipt+hash 일치, 서버 complete, 대기·격리 0이면 complete', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const { meta, gz } = await oversized(queue, 50); const o = await queue.enqueueArtifact(meta, gz);
    await queue.complete(o, { kind: 'feature', alias: meta.artifact_alias, sha256: meta.checksum, serverId: 'srv', size_bytes: meta.size_bytes, verified_at_us: '1' });
    const r = await verifyArchiveCompleteness(queue, ok);
    expect(r).toMatchObject({ complete: true, unresolved: [] });
  });
  it('서버가 complete라 해도 로컬 receipt가 없으면 완료로 세지 않는다', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const { meta, gz } = await oversized(queue, 50); await queue.enqueueArtifact(meta, gz);
    const r = await verifyArchiveCompleteness(queue, ok);
    expect(r.complete).toBe(false); expect(r.unresolved).toContainEqual({ alias: meta.artifact_alias, reason: 'pending' });
  });
  it('서버 missing_artifacts·time_review·dead_letter는 각각 사유와 함께 미완료', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const { meta, gz } = await oversized(queue, 50); const o = await queue.enqueueArtifact(meta, gz);
    await queue.failStaged(o.id, { reason: 'straddles_cutoff', stage: 'presign', mode: 'time_review' });
    const r = await verifyArchiveCompleteness(queue, { ...ok, close_state: 'pending_upload', missing_artifacts: [{ kind: 'indices', alias: 'IDXMISSING-0-3', sha256: '0'.repeat(64) }] });
    expect(r.complete).toBe(false);
    expect(r.unresolved).toEqual(expect.arrayContaining([{ alias: meta.artifact_alias, reason: 'time_review' }, { alias: 'IDXMISSING-0-3', reason: 'server_missing' }]));
  });
  it('receipt의 hash가 close expected와 다르면 불일치로 잡는다', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const { meta, gz } = await oversized(queue, 50); const o = await queue.enqueueArtifact(meta, gz);
    await queue.complete(o, { kind: 'feature', alias: meta.artifact_alias, sha256: 'f'.repeat(64), serverId: 'srv', size_bytes: meta.size_bytes, verified_at_us: '1' });
    const r = await verifyArchiveCompleteness(queue, ok);
    expect(r.complete).toBe(false); expect(r.unresolved).toContainEqual({ alias: meta.artifact_alias, reason: 'hash_mismatch' });
  });
  it('분할 부모(superseded)는 자식이 모두 receipt면 복구로 인정, 하나라도 없으면 미완료', async () => {
    const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire();
    const { meta, gz } = await oversized(queue); await queue.enqueueArtifact(meta, gz); await recoverOversized(queue);
    const kids = (await queue.objects()).filter(o => o.parentAlias);
    for (const k of kids.slice(0, -1)) await queue.complete(k, { kind: 'feature', alias: k.alias, sha256: k.meta.checksum, serverId: k.alias, size_bytes: k.meta.size_bytes, verified_at_us: '1' });
    expect((await verifyArchiveCompleteness(queue, ok)).complete).toBe(false);
    const last = kids[kids.length - 1]; await queue.complete(last, { kind: 'feature', alias: last.alias, sha256: last.meta.checksum, serverId: last.alias, size_bytes: last.meta.size_bytes, verified_at_us: '1' });
    expect(await verifyArchiveCompleteness(queue, ok)).toMatchObject({ complete: true, recoveredParents: [meta.artifact_alias] });
  });
});
