// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import { useEegRawUpload, type UseEegRawUploadResult } from '../src/hooks/useEegRawUpload';
import type { QueuedRawChunkItem } from '../src/lib/session-live/raw-chunk-queue';
const api = vi.hoisted(() => ({ presign: vi.fn(), put: vi.fn(), ack: vi.fn() }));
const queue = vi.hoisted(() => ({ items: [] as QueuedRawChunkItem[] }));
vi.mock('../src/lib/api/eeg-raw', () => ({ requestEegRawPresign: api.presign, putEegRawToPresignedUrl: api.put, ackEegRawChunks: api.ack }));
vi.mock('../src/lib/session-live/raw-chunk-queue', () => ({
  listPendingRawChunks: async () => [...queue.items],
  removeRawChunk: async () => { queue.items = []; },
  markRawChunkAttempt: async () => { queue.items = queue.items.map(item => ({ ...item, attemptCount: item.attemptCount + 1 })); },
  enqueueRawChunk: vi.fn(), sha256Hex: vi.fn(),
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
  queue.items = [];
  api.presign.mockResolvedValue({ chunks: [{ chunk_id: 'chunk', upload_url: 'https://upload.invalid' }] });
  api.put.mockResolvedValue(undefined);
  api.ack.mockResolvedValue(undefined);
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
  it.each([400, 403, 404, 409, 413, 422])('%s는 즉시 큐에서 제거하고 다시 요청하지 않는다', async status => {
    api.presign.mockRejectedValue(new ApiError(status, '영구 오류', null));
    await flush();
    expect(queue.items).toHaveLength(0);
    expect(latest.pendingCount).toBe(0);
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
  it.each([400, 403, 404, 409, 413, 422])('ack %s는 즉시 제거한다', async status => {
    api.ack.mockRejectedValue(new ApiError(status, '권한 없음', null));
    await flush();
    expect(queue.items).toHaveLength(0);
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
