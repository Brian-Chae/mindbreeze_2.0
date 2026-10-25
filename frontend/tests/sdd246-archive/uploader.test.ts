import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { ApiError } from '../../src/lib/api/client';
import { createBiosignalApi, type ArtifactMeta, type BiosignalTransport } from '../../src/lib/api/biosignal';
import { BiosignalQueue, MAX_ATTEMPTS } from '../../src/lib/biosignal/durable-queue';
import { UPLOAD_CONCURRENCY, uploadBiosignalQueue } from '../../src/lib/biosignal/upload-queue';

const scope = { accountId: 'a', sessionId: 's', participantId: 'p', deviceAlias: 'band' };
const bytes = new Uint8Array([1, 2, 3]).buffer;
const sum = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
const meta = (alias = 'FEAT-1', extra: Partial<ArtifactMeta> = {}): ArtifactMeta => ({ artifact_alias: alias, artifact_kind: 'feature', stream_id: null, segment_id: null, signal: null, sequence: 0, row_count: 1, schema_version: 'feature-v1', checksum: sum, size_bytes: 3, ...extra });

let now = 1_000_000;
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); now = 1_000_000; });
afterEach(() => vi.restoreAllMocks());

async function setup(alias = 'FEAT-1', extra: Partial<ArtifactMeta> = {}) {
  const queue = new BiosignalQueue(scope, 'tab', () => now);
  await queue.acquire();
  await queue.enqueueArtifact(meta(alias, extra), bytes);
  return queue;
}
type Script = { presign?: (n: number, body: unknown) => unknown; ack?: (n: number) => unknown };
function transport(script: Script = {}) {
  let presigns = 0, acks = 0;
  const post = vi.fn(async (path: string, body: unknown) => {
    const req = body as { chunks: { artifact_alias?: string }[] };
    if (path.endsWith('presign')) {
      const n = presigns++; const r = script.presign?.(n, body); if (r instanceof Error) throw r;
      return (r as object | undefined) ?? { chunks: [{ artifact_id: 'srv', artifact_alias: req.chunks[0].artifact_alias, artifact_kind: 'feature', sequence: 0, object_key: 'k', checksum: sum, size_bytes: 3, upload_url: 'https://s3/put', upload_headers: { 'x-amz-checksum-sha256': 'sig' }, upload_status: 'pending', expires_in_sec: 60 }] };
    }
    const n = acks++; const r = script.ack?.(n); if (r instanceof Error) throw r;
    return (r as object | undefined) ?? { chunks: [{ artifact_id: 'srv', artifact_alias: 'FEAT-1', artifact_kind: 'feature', upload_status: 'uploaded', checksum: sum, size_bytes: 3, verified_at_us: '10', failure_reason: null }] };
  });
  return { post, t: { get: async <T>() => ({} as T), post: post as BiosignalTransport['post'] }, counts: () => ({ presigns, acks }) };
}
const run = (queue: BiosignalQueue, tr: ReturnType<typeof transport>, put: (u: string, b: ArrayBuffer, h: Record<string, string>) => Promise<void> = async () => {}, opts: Parameters<typeof uploadBiosignalQueue>[5] = { archiveV3: true }) =>
  uploadBiosignalQueue(queue, createBiosignalApi({}, tr.t), put, () => true, () => now, opts);

describe('SDD246 uploader — PUT 단계', () => {
  it('PUT 서명 만료 403은 같은 호출 안에서 새 presign으로 재시도해 성공한다(dead_letter 아님)', async () => {
    const queue = await setup(); const tr = transport(); let n = 0;
    const s = await run(queue, tr, async () => { if (n++ === 0) throw new ApiError(403, 'expired', null); });
    expect(s.acked).toBe(1); expect(tr.counts().presigns).toBe(2);
    expect(await queue.objects()).toHaveLength(0); expect(await queue.receipts()).toHaveLength(1);
  });
  it('PUT 403이 계속되어도 영구 실패/권한 중단이 아니라 backoff로 남는다', async () => {
    const queue = await setup(); const tr = transport();
    await run(queue, tr, async () => { throw new ApiError(403, 'expired', null); });
    const [o] = await queue.objects();
    expect(o.state).toBe('pending'); expect(o.retryAfter).toBeGreaterThan(now); expect(o.payload.byteLength).toBe(3);
  });
  it.each([500, 503, 429, 408])('PUT %s는 backoff — MAX_ATTEMPTS를 넘겨도 pending 유지', async status => {
    const queue = await setup(); const tr = transport();
    for (let i = 0; i < MAX_ATTEMPTS + 5; i++) { now += 200_000; await run(queue, tr, async () => { throw new ApiError(status, 'x', null); }); }
    const [o] = await queue.objects(); expect(o.state).toBe('pending'); expect(o.attempts).toBeGreaterThan(MAX_ATTEMPTS);
  });
  it('네트워크 단절(TypeError)이 길어도 pending 유지, 복구 후 전송된다', async () => {
    const queue = await setup(); const tr = transport();
    for (let i = 0; i < 12; i++) { now += 200_000; await run(queue, tr, async () => { throw new TypeError('offline'); }); }
    expect((await queue.objects())[0].state).toBe('pending');
    now += 200_000; expect((await run(queue, tr)).acked).toBe(1);
  });
});

describe('SDD246 uploader — API 단계', () => {
  it('presign API 403(동의·권한)은 halt: 보존하고 같은 라운드의 나머지 전송도 중단한다', async () => {
    const queue = await setup();
    for (let i = 2; i <= 8; i++) await queue.enqueueArtifact(meta(`FEAT-${i}`, { sequence: i }), bytes);
    const tr = transport({ presign: () => new ApiError(403, 'no', { detail: { code: 'archive_rejected', reason: 'consent_withdrawn' } }) });
    const s = await run(queue, tr);
    expect(s.halted).toBe('consent_withdrawn');
    expect(tr.counts().presigns).toBeLessThanOrEqual(UPLOAD_CONCURRENCY); // 동시 in-flight 이후 나머지 객체는 시도하지 않는다
    const objs = await queue.objects(); expect(objs).toHaveLength(8); expect(objs.every(o => o.payload.byteLength === 3)).toBe(true);
    expect(objs.some(o => o.state === 'dead_letter' && o.lastError === 'consent_withdrawn')).toBe(true);
  });
  it('409 hash 충돌은 격리(dead_letter)하고 다시 presign하지 않는다', async () => {
    const queue = await setup(); const tr = transport({ presign: () => new ApiError(409, 'c', { detail: { code: 'artifact_conflict' } }) });
    await run(queue, tr); now += 500_000; await run(queue, tr);
    expect(tr.counts().presigns).toBe(1); expect((await queue.objects())[0]).toMatchObject({ state: 'dead_letter', lastError: 'artifact_conflict', stage: 'presign' });
  });
  it('422는 격리, 413은 분할 후보로 표시', async () => {
    const q1 = await setup(); await run(q1, transport({ presign: () => new ApiError(422, 's', null) }));
    expect((await q1.objects())[0]).toMatchObject({ state: 'dead_letter' });
    globalThis.indexedDB = new IDBFactory();
    const q2 = await setup(); await run(q2, transport({ presign: () => new ApiError(413, 'big', null) }));
    expect((await q2.objects())[0]).toMatchObject({ state: 'dead_letter', splitCandidate: true });
  });
  it('pending_time_review 409는 time_review로 격리 — 완료로 세지 않고 재전송하지 않는다', async () => {
    const queue = await setup(); const tr = transport({ presign: () => new ApiError(409, 't', { detail: { code: 'pending_time_review', reason: 'straddles_cutoff' } }) });
    const s = await run(queue, tr); now += 500_000; await run(queue, tr);
    expect(s.timeReview).toBe(1); expect(tr.counts().presigns).toBe(1);
    expect((await queue.objects())[0]).toMatchObject({ state: 'time_review', lastError: 'straddles_cutoff' });
    expect(await queue.receipts()).toHaveLength(0);
  });
});

describe('SDD246 uploader — PUT 성공 + ACK 유실', () => {
  it('ACK 응답이 유실(네트워크)되면 pending 유지, 다음 라운드 재presign→재ACK로 수렴(receipt 1건)', async () => {
    const queue = await setup(); let puts = 0;
    const tr = transport({ ack: n => (n === 0 ? new TypeError('ack lost') : undefined) });
    const put = async () => { puts++; };
    await run(queue, tr, put);
    expect((await queue.objects())[0].state).toBe('pending'); expect(await queue.receipts()).toHaveLength(0);
    now += 200_000; const s = await run(queue, tr, put);
    expect(s.acked).toBe(1); expect(await queue.receipts()).toHaveLength(1); expect(await queue.objects()).toHaveLength(0);
    expect(puts).toBeLessThanOrEqual(2); // 같은 바이트 재 PUT(내용 주소 key라 멱등)
  });
  it('서버가 이미 uploaded(upload_url=null)면 PUT 없이 ACK만 재확인', async () => {
    const queue = await setup(); const put = vi.fn(async () => {});
    const tr = transport({ presign: () => ({ chunks: [{ artifact_id: 'srv', artifact_alias: 'FEAT-1', artifact_kind: 'feature', sequence: 0, object_key: 'k', checksum: sum, size_bytes: 3, upload_url: null, upload_headers: {}, upload_status: 'uploaded', expires_in_sec: 0 }] }) });
    expect((await run(queue, tr, put)).acked).toBe(1); expect(put).not.toHaveBeenCalled();
  });
  it('ACK 5xx도 backoff — 사본 삭제 금지', async () => {
    const queue = await setup(); await run(queue, transport({ ack: () => new ApiError(503, 'x', null) }));
    expect((await queue.objects())[0]).toMatchObject({ state: 'pending', stage: 'verify' });
  });
});

describe('SDD246 uploader — 로컬 봉인 검증·종료 사후전송', () => {
  it('저장된 payload가 meta.checksum과 다르면(로컬 손상) PUT/presign 없이 격리한다', async () => {
    const queue = new BiosignalQueue(scope, 'tab', () => now); await queue.acquire();
    await queue.enqueueArtifact(meta('FEAT-BAD', { checksum: 'c'.repeat(64) }), bytes);
    const tr = transport(); const put = vi.fn(async () => {});
    await run(queue, tr, put);
    expect(tr.counts().presigns).toBe(0); expect(put).not.toHaveBeenCalled();
    expect((await queue.objects())[0]).toMatchObject({ state: 'dead_letter', lastError: 'local_seal_mismatch' });
  });
  it('capture_stream_id와 단조 구간을 presign에 싣는다(종료 후 사후전송 판정용)', async () => {
    const queue = await setup('FEAT-1', { time_range: { from_us: '1000000', to_us: '2000000' } }); const tr = transport();
    await run(queue, tr, async () => {}, { archiveV3: true, captureStreamId: 'stream-1', originMonotonicUs: '5000000' });
    const body = tr.post.mock.calls[0][1] as { capture_stream_id: string; chunks: ArtifactMeta[] };
    expect(body.capture_stream_id).toBe('stream-1');
    expect(body.chunks[0].monotonic_range).toEqual({ from_us: '6000000', to_us: '7000000' });
  });
  it('close deadline(24h)이 지난 항목은 네트워크 없이 사유와 함께 보존(삭제 없음)', async () => {
    const queue = await setup(); const tr = transport();
    const s = await run(queue, tr, async () => {}, { archiveV3: true, captureStreamId: 's1', closeDeadlineMs: now - 1 });
    expect(s.deadlinePassed).toBe(1); expect(tr.counts().presigns).toBe(0);
    expect((await queue.objects())[0]).toMatchObject({ state: 'dead_letter', lastError: 'close_deadline_passed' });
  });
  it('archiveV3 off(현행)는 8회 실패 시 dead_letter — 하위호환', async () => {
    const queue = await setup(); const tr = transport({ presign: () => new ApiError(500, 'x', null) });
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) { now += 200_000; await run(queue, tr, async () => {}, {}); }
    expect((await queue.objects())[0].state).toBe('dead_letter');
  });
});
