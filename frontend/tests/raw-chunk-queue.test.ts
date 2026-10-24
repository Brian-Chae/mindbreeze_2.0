// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { enqueueRawChunk, listPendingRawChunks, markRawChunkAttempt } from '../src/lib/session-live/raw-chunk-queue';
const payload = (streamId = 'raw', createdAt = 1) => ({ sessionId: 's1', participantId: 'p1', ownerId: 'owner', streamId, chunkIndex: 0, startedAt: '', endedAt: '', sampleRate: 250, channels: ['fp1','fp2'], unit: 'uV', schemaVersion: 'v1', checksum: streamId, byteSize: 4, contentType: 'application/octet-stream', payload: new ArrayBuffer(4), createdAt });
beforeEach(() => { vi.restoreAllMocks(); vi.stubGlobal('indexedDB', new IDBFactory()); localStorage.clear(); });
it('동일 키의 다른 payload를 성공으로 반환하지 않는다', async () => {
 await enqueueRawChunk(payload());
 await expect(enqueueRawChunk({ ...payload(), checksum: 'other' })).rejects.toThrow('충돌');
 expect((await listPendingRawChunks('s1'))[0].checksum).toBe('raw');
});
it('재시도 초과와 영구 거부는 IDB에 보존하고 진단을 영속 기록한다', async () => {
 await enqueueRawChunk(payload());
 for (let i = 0; i < 8; i++) await markRawChunkAttempt('raw',0,'denied',true);
 const [item] = await listPendingRawChunks('s1');
 expect(item.payload.byteLength).toBe(4);
 expect(item.state).toBe('quarantine');
 expect(item.retryAfter).toBeGreaterThan(Date.now());
 expect(localStorage.getItem('mindbreeze:eeg-raw-loss-events')).toContain('upload_unavailable');
});
it('다음 세션은 동일 owner만 복구하고 guest와 다른 계정은 격리한다', async () => {
 await enqueueRawChunk(payload());
 expect(await listPendingRawChunks('s2','p2','owner')).toHaveLength(1);
 expect(await listPendingRawChunks('s2','p2','other')).toHaveLength(0);
 expect(await listPendingRawChunks('s2','p2')).toHaveLength(0);
 expect(await listPendingRawChunks('s1','p1','other')).toHaveLength(0);
});
it('64MiB 상한 초과 시 가장 오래된 사본부터 손실 기록 후 제거한다', async () => {
 await enqueueRawChunk({ ...payload('old', 1), byteSize: 40 * 1024 * 1024 });
 await enqueueRawChunk({ ...payload('new', 2), byteSize: 30 * 1024 * 1024 });
 expect((await listPendingRawChunks('s1')).map(i => i.streamId)).toEqual(['new']);
 expect(localStorage.getItem('mindbreeze:eeg-raw-loss-events')).toContain('capacity_eviction');
});

it('손실 로그 저장 실패 시 기존 payload를 용량 삭제하지 않는다', async () => {
 await enqueueRawChunk({ ...payload('old'), byteSize: 40 * 1024 * 1024 });
 vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('log quota'); });
 await expect(enqueueRawChunk({ ...payload('new', 2), byteSize: 30 * 1024 * 1024 })).rejects.toThrow('log quota');
 expect((await listPendingRawChunks('s1')).map(i => i.streamId)).toEqual(['old']);
});

it('put 요청 성공 뒤 transaction abort도 enqueue 실패이며 이전 사본은 유지된다', async () => {
 await enqueueRawChunk(payload('old'));
 const put = IDBObjectStore.prototype.put;
 vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
   const request = put.call(this, value, key);
   request.addEventListener('success', () => this.transaction.abort());
   return request;
 });
 await expect(enqueueRawChunk(payload('new', 2))).rejects.toThrow('트랜잭션');
 expect((await listPendingRawChunks('s1')).map(i => i.streamId)).toEqual(['old']);
});
