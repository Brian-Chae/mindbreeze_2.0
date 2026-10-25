import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { BiosignalQueue, type CaptureScope } from '../src/lib/biosignal/durable-queue';
import { createBiosignalApi, type BiosignalTransport } from '../src/lib/api/biosignal';
import { uploadBiosignalQueue } from '../src/lib/biosignal/upload-queue';
import { enqueueRawChunk, listPendingRawChunks } from '../src/lib/session-live/raw-chunk-queue';

const scope: CaptureScope = { accountId: 'account-a', sessionId: 'session', participantId: 'participant', deviceAlias: 'LINK-BAND' };
const payload = new Uint8Array([1, 2, 3]).buffer;
const checksum = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
async function setup() {
  const queue = new BiosignalQueue(scope, 'tab-a');
  await queue.acquire();
  const object = await queue.enqueueArtifact({ artifact_alias: 'FEATURE-1', artifact_kind: 'feature', stream_id: null, segment_id: null, signal: null, sequence: 0, row_count: 1, content_encoding: 'identity', schema_version: 'feature-v1', checksum, size_bytes: 3, content_type: 'application/octet-stream' }, payload);
  return { queue, object };
}
function transport(mode: 'ok' | 'failed' | 'wrong' | 'null' = 'ok'): BiosignalTransport {
  return {
    async get<T>() { return {} as T; },
    async post<T>(path: string, body: unknown) {
      const request = body as { chunks: { artifact_alias?: string }[] };
      if (path.endsWith('presign')) return { session_id: 'session', participant_id: 'participant', chunks: [{ artifact_id: 'server-id', artifact_alias: request.chunks[0].artifact_alias, artifact_kind: 'feature', sequence: 0, object_key: 'key', checksum, size_bytes: 3, upload_url: mode === 'null' ? null : 'https://storage/put', upload_headers: { 'x-amz-checksum-sha256': 'signed' }, upload_status: 'pending', expires_in_sec: 60 }] } as T;
      return { session_id: 'session', acked: 1, failed: 0, chunks: [{ artifact_id: mode === 'wrong' ? 'wrong' : 'server-id', artifact_alias: 'FEATURE-1', artifact_kind: 'feature', upload_status: mode === 'failed' ? 'failed' : 'uploaded', checksum, size_bytes: 3, verified_at_us: '123456', failure_reason: mode === 'failed' ? 'storage' : null }] } as T;
    },
  };
}
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
describe('SDD244 durable queue', () => {
  it('v2 DB upgrade 뒤 legacy 큐가 같은 DB에서 그대로 열린다', async () => {
    await setup();
    await enqueueRawChunk({ sessionId: 'old', participantId: null, streamId: 'legacy', chunkIndex: 0, startedAt: '', endedAt: '', sampleRate: 250, channels: ['fp1'], unit: 'uV', schemaVersion: '1.0', checksum, byteSize: 3, contentType: '', payload });
    expect((await listPendingRawChunks('old'))[0].payload).toEqual(payload);
  });
  it('만료 인계 후 오래된 fencing token append는 거절하고 새 탭 사본을 유지한다', async () => {
    let now = 100;
    const first = new BiosignalQueue(scope, 'tab-a', () => now); await first.acquire();
    const second = new BiosignalQueue(scope, 'tab-b', () => now);
    await expect(second.acquire()).rejects.toThrow('lease');
    now = 30101; await second.acquire(); // LEASE_TTL_MS(30s) 경과 후 인계
    await expect(first.enqueueArtifact({ artifact_alias: 'A', artifact_kind: 'feature', stream_id: null, segment_id: null, signal: null, sequence: 0, row_count: 1, schema_version: 'v1', checksum, size_bytes: 3 }, payload)).rejects.toThrow('lease');
  });
  it('계정 B는 계정 A 객체를 읽거나 전송하지 못한다', async () => {
    await setup(); const other = new BiosignalQueue({ ...scope, accountId: 'account-b' }, 'tab-b'); await other.acquire();
    expect(await other.objects()).toHaveLength(0);
  });
  it.each(['failed', 'wrong'] as const)('HTTP200 %s ACK는 사본을 남긴다', async mode => {
    const { queue } = await setup();
    await uploadBiosignalQueue(queue, createBiosignalApi({}, transport(mode)), async () => {}, () => true);
    expect(await queue.objects()).toHaveLength(1); expect(await queue.receipts()).toHaveLength(0);
  });
  it('서명 헤더 PUT → verified receipt 영속 → GC 순서로 확정한다', async () => {
    const { queue } = await setup(); let put = false;
    await uploadBiosignalQueue(queue, createBiosignalApi({}, transport()), async (_url, bytes, headers) => { expect(bytes).toEqual(payload); expect(headers).toEqual({ 'x-amz-checksum-sha256': 'signed' }); put = true; }, () => true);
    expect(put).toBe(true); expect(await queue.objects()).toHaveLength(0); expect(await queue.receipts()).toHaveLength(1);
    expect((await queue.expected())[0]).toEqual({ kind: 'feature', alias: 'FEATURE-1', sha256: checksum });
  });
  it('null upload_url은 PUT 없이 ACK 재확인한다', async () => {
    const { queue } = await setup();
    await uploadBiosignalQueue(queue, createBiosignalApi({}, transport('null')), async () => { throw new Error('PUT 금지'); }, () => true);
    expect(await queue.objects()).toHaveLength(0);
  });
  it('presign await 중 계정 변경이면 PUT과 GC를 중단한다', async () => {
    const { queue } = await setup(); let active = true; const base = transport();
    const api = createBiosignalApi({}, { ...base, post: async <T,>(path: string, body: unknown) => { const result = await base.post<T>(path, body); active = false; return result; } });
    await uploadBiosignalQueue(queue, api, async () => { throw new Error('PUT 금지'); }, () => active);
    expect(await queue.objects()).toHaveLength(1);
  });
  it('8회 실패와 403/409는 삭제 없이 보관한다', async () => {
    const { queue, object } = await setup();
    for (let n = 0; n < 8; n++) await queue.fail(object.id, 'network');
    expect((await queue.objects())[0].state).toBe('dead_letter');
    expect((await queue.objects())[0].payload).toEqual(payload);
  });
});
