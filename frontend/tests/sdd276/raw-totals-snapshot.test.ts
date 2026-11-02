// SDD-276 — 웹 raw 총량(sealed + receipt)은 업로드가 진행 중이어도 같은 청크를 두 번 세지 않는다.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { BiosignalQueue } from '../../src/lib/biosignal/durable-queue';
import { computeWebRawTotals } from '../../src/lib/biosignal/web-raw-totals';
import { mergeReport } from '../../src/lib/biosignal/expected-reporter';

let n = 0;
const scope = () => { n += 1; return { accountId: `entry:p${n}`, sessionId: `s${n}`, participantId: `p${n}`, deviceAlias: 'LINK-BAND' }; };
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

// 비회원 웹 청크: 신호별 chunk_index 는 segment 마다 0부터(ppg 는 패킷마다 새 segment 라 전부 0)
const meta = (sig: 'eeg' | 'ppg' | 'acc', seg: string, idx: number, samples: number) => ({
  chunk_alias: `RAW-${sig}-${seg}-${idx}`, checksum: `c-${sig}-${seg}-${idx}`, size_bytes: 1,
  header: { signal_type: sig, stream_id: 'st', segment_id: seg, chunk_index: idx, sample_count: samples },
});
async function seal(q: BiosignalQueue, sig: 'eeg' | 'ppg' | 'acc', seg: string, idx: number, samples: number) {
  await q.sealRaw(meta(sig, seg, idx, samples) as never, new ArrayBuffer(1), []);
}
/** 업로드 성공(서버 uploaded 행 생성)을 모사: sealed → receipt */
async function upload(q: BiosignalQueue, alias: string) {
  const object = (await q.dueBatch(10_000, Date.now())).batch.find((o) => o.alias === alias)!;
  await q.complete(object, { kind: 'raw', alias, sha256: object.meta.checksum, serverId: `srv-${alias}`, size_bytes: 1, verified_at_us: '1', meta: object.meta });
}

/** objectsMeta 를 읽은 직후(= 합계 계산 도중)에 hook 을 실행한다. hook 안의 큐 호출은 재귀하지 않도록 가드한다. */
function afterSealedRead(q: BiosignalQueue, hook: () => Promise<void>): () => void {
  const original = q.objectsMeta.bind(q);
  let inside = false;
  q.objectsMeta = async () => {
    const list = await original();
    if (!inside) { inside = true; try { await hook(); } finally { inside = false; } }
    return list;
  };
  return () => { q.objectsMeta = original; };
}

describe('SDD-276 V1 — 읽는 도중 업로드가 끝나도 이중 계산이 없다', () => {
  it('봉인 목록을 읽은 직후 한 청크가 영수증으로 넘어가도 합계는 실제 청크 수 그대로', async () => {
    const q = new BiosignalQueue(scope(), 'tab');
    await q.acquire();
    for (let i = 0; i < 5; i++) await seal(q, 'ppg', `seg${i}`, 0, 28);
    let moved = false;
    afterSealedRead(q, async () => { if (!moved) { moved = true; await upload(q, 'RAW-ppg-seg2-0'); } });
    expect(await computeWebRawTotals(q)).toEqual({ eeg: 0, ppg: 5, acc: 0 });
    await q.release();
  });

  it('업로드가 진행되는 중 반복 관측해도 한 번도 실제 총량을 넘지 않는다', async () => {
    const q = new BiosignalQueue(scope(), 'tab');
    await q.acquire();
    const total = 12;
    for (let i = 0; i < total; i++) await seal(q, 'ppg', `seg${i}`, 0, 28);
    const seen: number[] = [];
    // 관측 한 번마다 그 읽기 도중(sealed 읽은 직후) 한 청크가 업로드되도록 끼워 넣는다
    let next = 0;
    afterSealedRead(q, async () => { if (next < total) await upload(q, `RAW-ppg-seg${next++}-0`); });
    for (let i = 0; i < total + 1; i++) seen.push((await computeWebRawTotals(q)).ppg);
    expect(Math.max(...seen)).toBe(total);
    expect(seen.at(-1)).toBe(total);
    await q.release();
  });

  it('최댓값 병합을 거쳐도 보고 기대량이 서버 행 수(= 업로드된 청크 수)와 같다', async () => {
    const q = new BiosignalQueue(scope(), 'tab');
    await q.acquire();
    for (let i = 0; i < 12; i++) await seal(q, 'ppg', `p${i}`, 0, 28);
    for (let i = 0; i < 3; i++) await seal(q, 'acc', `a${i}`, 0, 300);
    for (let i = 0; i < 4; i++) await seal(q, 'eeg', 'e0', i, i === 3 ? 25 : 2500);
    let report = mergeReport(null, { feature: 1, raw: await computeWebRawTotals(q), final: false });
    const todo = ['RAW-ppg-p0-0', 'RAW-acc-a1-0', 'RAW-eeg-e0-2'];
    const restore = afterSealedRead(q, async () => { const a = todo.shift(); if (a) await upload(q, a); });
    for (let i = 0; i < 3; i++) report = mergeReport(report, { feature: 1, raw: await computeWebRawTotals(q), final: true });
    restore();
    for (const o of (await q.dueBatch(10_000, Date.now())).batch) await upload(q, o.alias);
    report = mergeReport(report, { feature: 1, raw: await computeWebRawTotals(q), final: true });
    const serverRows = { eeg: 4, ppg: 12, acc: 3 }; // 전부 uploaded 된 뒤 서버 행 수
    expect(report.raw).toEqual(serverRows);
    await q.release();
  });
});

describe('SDD-276 V3 — 비회원 시나리오: 서버 행 수 == 보고 기대량', () => {
  it('ppg 28샘플 다수 segment·acc 300샘플·eeg 가변 청크 + 레거시 v1 eeg 청크, 업로드 중 관측·재전송 후 일치', async () => {
    const q = new BiosignalQueue(scope(), 'tab');
    await q.acquire();
    const rows = { eeg: 0, ppg: 0, acc: 0 };
    for (let i = 0; i < 40; i++) { await seal(q, 'ppg', `p${i}`, 0, 28); rows.ppg += 1; }       // ppg: 매번 새 segment, index 전부 0
    for (let i = 0; i < 3; i++) { await seal(q, 'acc', `a${i}`, 0, 300); rows.acc += 1; }         // acc: 300샘플 고정, index 0
    for (let i = 0; i < 6; i++) { await seal(q, 'eeg', 'e0', i, [2500, 25, 700, 2500, 90, 1200][i]); rows.eeg += 1; } // eeg 가변
    const legacy = 30; rows.eeg += legacy;                                                         // 레거시 v1 1초 청크도 서버에서는 eeg 행
    let report = mergeReport(null, { feature: 1, raw: await computeWebRawTotals(q, legacy), final: false });
    const restore = afterSealedRead(q, async () => { for (const o of (await q.dueBatch(3, Date.now())).batch) await upload(q, o.alias); });
    for (let i = 0; i < 20; i++) report = mergeReport(report, { feature: 1, raw: await computeWebRawTotals(q, legacy), final: false });
    restore();
    const dup = (await q.receipts())[0];                                                          // 재전송: 같은 청크를 다시 ack 해도 receipt id 가 같아 늘지 않는다
    await q.complete({ id: dup.id, accountId: dup.accountId, sessionId: dup.sessionId, participantId: dup.participantId, kind: 'raw', alias: dup.alias, meta: dup.meta, payload: new ArrayBuffer(1), state: 'pending', attempts: 0, lastError: null, retryAfter: 0, createdAt: 0 } as never, { kind: 'raw', alias: dup.alias, sha256: dup.sha256, serverId: dup.serverId, size_bytes: 1, verified_at_us: '2', meta: dup.meta });
    report = mergeReport(report, { feature: 1, raw: await computeWebRawTotals(q, legacy), final: true });
    expect(report.raw).toEqual(rows);
    expect(report.final).toBe(true);
    await q.release();
  });
  it('레거시 카운터: 새 청크만 증가하고 같은 청크 재적재(멱등)·ack 삭제 뒤에도 유지', async () => {
    const { enqueueRawChunk, removeRawChunk, readLegacyRawCount } = await import('../../src/lib/session-live/raw-chunk-queue');
    const base = { sessionId: 'sL', participantId: 'pL', ownerId: null, streamId: 'raw-x', startedAt: '', endedAt: '', sampleRate: 250, channels: ['fp1', 'fp2'], unit: 'uV', schemaVersion: '1.0', checksum: 'c', byteSize: 1, contentType: 'application/octet-stream', payload: new ArrayBuffer(1) };
    expect(await readLegacyRawCount('sL', 'pL')).toBe(0);
    await enqueueRawChunk({ ...base, chunkIndex: 0 });
    await enqueueRawChunk({ ...base, chunkIndex: 1 });
    await enqueueRawChunk({ ...base, chunkIndex: 1 });
    expect(await readLegacyRawCount('sL', 'pL')).toBe(2);
    await removeRawChunk('raw-x', 0, 'sL');
    expect(await readLegacyRawCount('sL', 'pL')).toBe(2);
    expect(await readLegacyRawCount('sL', 'other')).toBe(0);
  });
});

describe('SDD-276 V2 — 기존 계약 유지', () => {
  it('superseded 는 세지 않고 dead_letter/pending 은 세며 신호별로 나눈다', async () => {
    const q = new BiosignalQueue(scope(), 'tab');
    await q.acquire();
    await seal(q, 'eeg', 's', 0, 2500); await seal(q, 'ppg', 'x', 0, 28); await seal(q, 'acc', 'y', 0, 300);
    await upload(q, 'RAW-eeg-s-0');
    const ppg = (await q.objectsMeta()).find((m) => m.alias === 'RAW-ppg-x-0')!;
    await q.fail(ppg.id, 'x', true); // dead_letter
    expect(await computeWebRawTotals(q)).toEqual({ eeg: 1, ppg: 1, acc: 1 });
    await q.release();
  });
});
