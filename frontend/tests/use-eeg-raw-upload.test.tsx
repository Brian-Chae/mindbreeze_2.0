// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/stores/authStore';
import type { User } from '../src/lib/api/auth';
import { ApiError } from '../src/lib/api/client';
import { useEegRawUpload, type UseEegRawUploadResult } from '../src/hooks/useEegRawUpload';
import type { QueuedRawChunkItem } from '../src/lib/session-live/raw-chunk-queue';
const api = vi.hoisted(() => ({ presign: vi.fn(), put: vi.fn(), ack: vi.fn() }));
const queue = vi.hoisted(() => ({ items: [] as QueuedRawChunkItem[], enqueue: vi.fn(), failList: false }));
vi.mock('../src/lib/api/eeg-raw', () => ({ requestEegRawPresign: api.presign, putEegRawToPresignedUrl: api.put, ackEegRawChunks: api.ack }));
vi.mock('../src/lib/session-live/raw-chunk-queue', () => ({
  listPendingRawChunks: async () => { if (queue.failList) throw new Error('IDB unavailable'); return [...queue.items]; },
  removeRawChunk: async () => { queue.items = []; },
  markRawChunkAttempt: async (_s: string, _i: number, _e: string, permanent = false) => { queue.items = queue.items.map(item => ({ ...item, attemptCount: item.attemptCount + 1, retryAfter: permanent || item.attemptCount + 1 >= 8 ? Date.now() + 60000 : 0 })); },
  enqueueRawChunk: queue.enqueue, sha256Hex: vi.fn(),
}));
let latest: UseEegRawUploadResult;
let root: Root;
function Probe() {
  latest = useEegRawUpload({ sessionId: 'session', participantId: 'person', flushIntervalMs: 0 });
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  useAuthStore.setState({ user: null });
  queue.failList = false;
  queue.enqueue.mockImplementation(async input => {
    const item = { ...input, id: `${input.streamId}:${input.chunkIndex}`, attemptCount: 0, lastError: null, createdAt: Date.now() };
    queue.items.push(item);
    return item;
  });
  queue.items = [];
  api.presign.mockImplementation(async (_session, body) => ({ chunks: [{ chunk_id: 'chunk', upload_url: 'https://upload.invalid', stream_id: body.chunks[0].stream_id, chunk_index: body.chunks[0].chunk_index }] }));
  api.put.mockResolvedValue(undefined);
  api.ack.mockResolvedValue({ session_id: 'session', chunks: [{ chunk_id: 'chunk', upload_status: 'uploaded', checksum: 'sum', size_bytes: 1 }] });
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
  queue.items = [{ id: 'stream:0', sessionId: 'session', participantId: 'person', streamId: 'stream', chunkIndex: 0,
    startedAt: '', endedAt: '', sampleRate: 250, channels: ['fp1', 'fp2'], unit: 'uV', schemaVersion: 'eeg-raw-v1',
    checksum: 'sum', byteSize: 1, contentType: 'application/octet-stream', payload: new ArrayBuffer(1), createdAt: 0,
    attemptCount: 0, lastError: null }];
});
afterEach(async () => { await act(async () => root.unmount()); });
async function flush() { await act(async () => { await latest.flush(); }); }
describe('raw 업로드 재시도 분류', () => {
  it.each([400, 403, 404, 409, 413, 422])('%s는 payload를 보관하고 cooldown 동안 재요청하지 않는다', async status => {
    api.presign.mockRejectedValue(new ApiError(status, '영구 오류', null));
    await flush();
    expect(queue.items).toHaveLength(1);
    expect(latest.pendingCount).toBe(1);
    await flush();
    expect(api.presign).toHaveBeenCalledTimes(1);
  });
  it.each([401, 408, 429, 500, 503, 'network'])('%s는 큐에 남겨 다음 flush에서 재시도한다', async status => {
    api.presign.mockRejectedValue(typeof status === 'number' ? new ApiError(status, '일시 오류', null) : new TypeError('네트워크 오류'));
    await flush();
    expect(queue.items[0].attemptCount).toBe(1);
    expect(latest.uploadStatus).toBe('delayed');
    await flush();
    expect(api.presign).toHaveBeenCalledTimes(2);
    expect(queue.items[0].attemptCount).toBe(2);
  });
  it.each([400, 403, 404, 409, 413, 422])('ack %s도 payload를 보관한다', async status => {
    api.ack.mockRejectedValue(new ApiError(status, '권한 없음', null));
    await flush();
    expect(queue.items).toHaveLength(1);
    await flush();
    expect(api.presign).toHaveBeenCalledTimes(1);
  });
  it('PUT 403은 청크를 유지하고 새 presign으로 재시도한다', async () => {
    api.put.mockRejectedValueOnce(new ApiError(403, '서명 만료', null));
    await flush();
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].attemptCount).toBe(1);
    expect(latest.uploadStatus).toBe('delayed');
    expect(api.ack).not.toHaveBeenCalled();
    await flush();
    expect(api.presign).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.ack).toHaveBeenCalledTimes(1);
    expect(queue.items).toHaveLength(0);
  });
});

describe('청크별 ACK 확인', () => {
  it.each([undefined, { acked: 1 }, { chunks: [] }, { session_id: 'session', chunks: [{ chunk_id: 'chunk', upload_status: 'uploaded', checksum: 'sum', size_bytes: 1 }, { chunk_id: 'chunk', upload_status: 'failed', checksum: 'sum', size_bytes: 1 }] }, { chunks: [{ chunk_id: 'other', upload_status: 'uploaded', checksum: 'sum', size_bytes: 1 }] }, { chunks: [{ chunk_id: 'chunk', upload_status: 'failed', checksum: 'sum', size_bytes: 1 }] }, { chunks: [{ chunk_id: 'chunk', upload_status: 'uploaded', checksum: 'wrong', size_bytes: 1 }] }, { chunks: [{ chunk_id: 'chunk', upload_status: 'uploaded', checksum: 'sum', size_bytes: 2 }] }])('불확실한 ACK %#는 로컬 사본을 보존한다', async response => {
    api.ack.mockResolvedValue(response ? { session_id: 'session', ...response } : response);
    await flush();
    expect(queue.items).toHaveLength(1);
  });
  it('재ACK acked=0이라도 해당 청크 uploaded 확인이면 삭제한다', async () => {
    await flush();
    expect(queue.items).toHaveLength(0);
  });
  it('최대 재시도 후에도 payload를 유지하고 cooldown 후 복구한다', async () => {
    queue.items[0].attemptCount = 7;
    api.put.mockRejectedValueOnce(new TypeError('offline'));
    await flush();
    await flush();
    expect(queue.items).toHaveLength(1);
    expect(api.presign).toHaveBeenCalledTimes(1);
    queue.items[0].retryAfter = 0;
    await flush();
    expect(queue.items).toHaveLength(0);
  });
});

describe('미영속 메모리 복구', () => {
  it('enqueue 실패 payload는 재마운트 시 같은 키로 재시도한다', async () => {
    queue.items = [];
    queue.enqueue.mockRejectedValueOnce(new Error('quota'));
    const input = { streamId: 'memory-remount', chunkIndex: 0, startedAt: '', endedAt: '', payload: new Uint8Array([7]).buffer, checksum: 'sum' };
    await act(async () => { await expect(latest.enqueueChunk(input)).rejects.toThrow('quota'); });
    await act(async () => root.render(null));
    await act(async () => root.render(<Probe />));
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue.mock.calls[1][0].payload).toEqual(input.payload);
    expect(queue.items).toHaveLength(0);
    expect(api.ack).toHaveBeenCalledTimes(1);
  });
  it('IDB 조회 실패는 빈 큐나 drain 성공으로 간주하지 않는다', async () => {
    queue.failList = true;
    let drained = true;
    await act(async () => { drained = await latest.drain(1); });
    expect(drained).toBe(false);
    expect(latest.pendingCount).toBeGreaterThan(0);
  });
});

it('presign의 stream/index가 요청 청크와 다르면 PUT·삭제하지 않는다', async () => {
 api.presign.mockResolvedValue({ chunks: [{ chunk_id: 'chunk', upload_url: 'https://upload.invalid', stream_id: 'wrong', chunk_index: 0 }] });
 await flush();
 expect(queue.items).toHaveLength(1);
 expect(api.put).not.toHaveBeenCalled();
});

it('조회 결과에 다른 owner 청크가 섞여도 요청하지 않는다', async () => {
 queue.items[0].ownerId = 'other-owner';
 await flush();
 expect(api.presign).not.toHaveBeenCalled();
 expect(queue.items).toHaveLength(1);
});
it('PUT 도중 로그인 계정이 바뀌면 새 계정으로 ACK하지 않는다', async () => {
 const user: User = { id: 'new-owner', email: 'test@example.test', name: 'test', role: 'client', verified_tier: 'unverified', onboarding_completed: true, auth_provider: 'email', counselors: [] };
 api.put.mockImplementationOnce(async () => { useAuthStore.setState({ user }); });
 await flush();
 expect(api.ack).not.toHaveBeenCalled();
 expect(queue.items).toHaveLength(1);
});
