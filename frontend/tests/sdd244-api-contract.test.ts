import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createBiosignalApi, type ArtifactMeta, type BiosignalTransport, type CloseIntent } from '../src/lib/api/biosignal';
import { putEegRawToPresignedUrl } from '../src/lib/api/eeg-raw';
import { ApiError } from '../src/lib/api/client';
import { BiosignalQueue } from '../src/lib/biosignal/durable-queue';
import { uploadBiosignalQueue } from '../src/lib/biosignal/upload-queue';
const scope = { accountId: 'a', sessionId: 's', participantId: 'p', deviceAlias: 'b' };
const meta: ArtifactMeta = { artifact_alias: 'FEATURE-1', feature_id_aliases: ['FEAT-1','FEAT-2'], artifact_kind: 'feature', stream_id: '11111111-1111-4111-8111-111111111111', segment_id: '22222222-2222-4222-8222-222222222222', signal: 'eeg', sequence: 0, first_sequence: 0, last_sequence: 1, row_count: 2, schema_version: 'feature-v1', checksum: 'a'.repeat(64), size_bytes: 1 };
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => vi.unstubAllGlobals());
it('실제 PUT 함수는 upload_headers를 추가·변경하지 않는다', async () => {
 const fetch = vi.fn(async () => ({ ok: true })); vi.stubGlobal('fetch', fetch);
 const headers = { 'content-type': 'application/gzip', 'x-amz-checksum-sha256': 'signed', 'x-amz-server-side-encryption': 'AES256' };
 await putEegRawToPresignedUrl('https://storage/put', new ArrayBuffer(1), headers);
 expect(fetch.mock.calls[0][1].headers).toEqual(headers);
});
it.each(['chunk_identity_conflict', 'artifact_conflict', 'alias_conflict'])('409 %s는 사본을 dead_letter에 유지', async code => {
 const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire(); await queue.enqueueArtifact(meta, new ArrayBuffer(1));
 const transport: BiosignalTransport = { get: async <T>() => ({} as T), post: async () => { throw new ApiError(409, code, { code }); } };
 await uploadBiosignalQueue(queue, createBiosignalApi({}, transport), vi.fn(), () => true);
 expect((await queue.objects())[0]).toMatchObject({ state: 'dead_letter', lastError: code });
 expect((await queue.objects())[0].payload.byteLength).toBe(1);
});
it.each(['pending','failed','uploaded'])('집계 acked=1이어도 항목별 %s만으로 삭제 여부 결정', async status => {
 const queue = new BiosignalQueue(scope, 'tab'); await queue.acquire(); await queue.enqueueArtifact(meta, new ArrayBuffer(1));
 const post = vi.fn(async (path: string) => path.endsWith('presign') ? { chunks: [{ artifact_id: 'server', artifact_alias: meta.artifact_alias, checksum: meta.checksum, size_bytes: 1, upload_url: null, upload_headers: {}, upload_status: 'uploaded' }] } : { acked: 1, failed: 0, chunks: [{ artifact_id: 'server', artifact_alias: meta.artifact_alias, checksum: meta.checksum, size_bytes: 1, upload_status: status, verified_at_us: '1', failure_reason: null }] });
 const transport = { get: async <T>() => ({} as T), post: post as BiosignalTransport['post'] };
 await uploadBiosignalQueue(queue, createBiosignalApi({}, transport), vi.fn(), () => true);
 expect((post.mock.calls[0] as unknown as [string, { chunks: ArtifactMeta[] }])[1].chunks[0].feature_id_aliases).toEqual(['FEAT-1','FEAT-2']);
 expect(await queue.objects()).toHaveLength(status === 'uploaded' ? 0 : 1);
});
it('close adapter는 expected·scope 순번·lost 목록을 그대로 전송', async () => {
 const intent: CloseIntent = { event_type: 'close_intent', intent_id: 'intent', expected_artifacts: [{kind:'feature',alias:'FEATURE-1',sha256:meta.checksum}], streams: [{ stream_id: meta.stream_id!, segment_id: meta.segment_id!, signal: 'eeg', last_chunk_sequence: 2, last_feature_sequence: 1, received_samples: 30 }], snapshots: [], last_gap_sequence: 0, end_reason: 'end', closed_at_us: '100', lost_artifacts: [{ kind: 'indices', alias: 'IDX-LOST', reason: 'unrecoverable' }] };
 const post = vi.fn(async () => ({}));
 await createBiosignalApi({}, { get: async <T>() => ({} as T), post: post as BiosignalTransport['post'] }).events('s','p',[intent]);
 expect(post.mock.calls[0]).toEqual(['/sessions/s/biosignal-events',{participant_id:'p',events:[intent]},{skipAuth:false}]);
});
