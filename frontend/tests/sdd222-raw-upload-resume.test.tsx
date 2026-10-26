// @vitest-environment jsdom
// SDD-222 T-J6 — useEegRawUpload 복귀 처리 (V13·V14·V17, Q3)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  resume: [] as { cb: () => void | Promise<void>; order?: number }[],
  pause: [] as { cb: () => void | Promise<void>; order?: number }[],
  pending: [] as { id: string; streamId: string; chunkIndex: number; sessionId: string; participantId: string; attemptCount: number }[],
  presign: vi.fn(),
  releasePresign: null as null | (() => void),
}));

vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { socket: 10, rawFlush: 20, ble: 30, screen: 40 },
  subscribeAppResume: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; h.resume.push(e);
    return () => { h.resume.splice(h.resume.indexOf(e), 1); };
  },
  subscribeAppPause: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; h.pause.push(e);
    return () => { h.pause.splice(h.pause.indexOf(e), 1); };
  },
}));
vi.mock('../src/lib/api/eeg-raw', () => ({
  requestEegRawPresign: (...a: unknown[]) => h.presign(...a),
  putEegRawToPresignedUrl: vi.fn(async () => undefined),
  ackEegRawChunks: vi.fn(async () => ({ session_id: 's1', chunks: [{ chunk_id: 'k', upload_status: 'uploaded', checksum: 'x', size_bytes: 4 }] })),
}));
vi.mock('../src/lib/api/class-flow', () => ({
  requestEntryEegRawPresign: vi.fn(), ackEntryEegRawChunks: vi.fn(),
}));
vi.mock('../src/lib/session-live/raw-chunk-queue', () => ({
  enqueueRawChunk: vi.fn(), sha256Hex: vi.fn(),
  listPendingRawChunks: async () => [...h.pending],
  markRawChunkAttempt: vi.fn(async () => undefined),
  removeRawChunk: vi.fn(async (stream: string, idx: number) => {
    h.pending = h.pending.filter((p) => !(p.streamId === stream && p.chunkIndex === idx));
  }),
}));

import { useEegRawUpload } from '../src/hooks/useEegRawUpload';

let root: Root;
function Harness() {
  useEegRawUpload({ sessionId: 's1', participantId: 'p1', skipAuth: true, flushIntervalMs: 0 });
  return null;
}
const mkItem = (i: number) => ({
  id: `c${i}`, streamId: 'st', chunkIndex: i, sessionId: 's1', participantId: 'p1', attemptCount: 0,
  startedAt: null, endedAt: null, sampleRate: 250, channels: ['fp1', 'fp2'], unit: 'uV',
  schemaVersion: 'v1', checksum: 'x', byteSize: 4, contentType: 'application/octet-stream', payload: new ArrayBuffer(4),
});
const fireResume = () => act(async () => { await Promise.all(h.resume.map((e) => e.cb())); await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.resume.length = 0; h.pause.length = 0; h.pending = [];
  h.presign.mockReset().mockImplementation(async (_session, body) => ({ chunks: [{ chunk_id: 'k', upload_url: 'u', stream_id: body.chunks[0].stream_id, chunk_index: body.chunks[0].chunk_index }] }));
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe('useEegRawUpload 복귀 처리', () => {
  it('V13 복귀 시 미전송 청크 N개가 즉시 순서대로 업로드되어 큐가 비워진다', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    h.pending = [0, 1, 2].map(mkItem) as never;
    expect(h.presign).not.toHaveBeenCalled();
    await fireResume();
    expect(h.presign).toHaveBeenCalledTimes(3);
    const order = h.presign.mock.calls.map((c) => (c[1] as { chunks: { chunk_index: number }[] }).chunks[0].chunk_index);
    expect(order).toEqual([0, 1, 2]);
    expect(h.pending).toHaveLength(0);
  });

  it('복귀 order 는 raw flush 단계(20)로 등록된다', async () => {
    await act(async () => root.render(<Harness />));
    expect(h.resume.map((e) => e.order)).toEqual([20]);
  });

  it('V14 flush 진행 중 복귀 이벤트가 연속 발생해도 중복 전송하지 않는다', async () => {
    let release: () => void = () => undefined;
    h.presign.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ chunks: [{ chunk_id: 'k', upload_url: 'u', stream_id: 'st', chunk_index: 0 }] });
    }));
    await act(async () => root.render(<Harness />));
    h.pending = [mkItem(0)] as never;
    await act(async () => { void h.resume[0].cb(); void h.resume[0].cb(); void h.resume[0].cb(); await vi.advanceTimersByTimeAsync(0); });
    expect(h.presign).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    expect(h.pending).toHaveLength(0);
  });

  it('Q3 오프라인(navigator.onLine=false)에서는 시도 횟수를 소모하지 않고 flush 를 건너뛰며, 온라인 복귀 후 유실 없이 전송된다', async () => {
    await act(async () => root.render(<Harness />));
    h.pending = [mkItem(0), mkItem(1)] as never;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await fireResume();
    expect(h.presign).not.toHaveBeenCalled();
    expect(h.pending).toHaveLength(2);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await fireResume();
    expect(h.presign).toHaveBeenCalledTimes(2);
    expect(h.pending).toHaveLength(0);
  });

  it('V17 백그라운드 전환 시 소켓은 건드리지 않고 raw 큐 flush 를 시도한다', async () => {
    await act(async () => root.render(<Harness />));
    h.pending = [mkItem(0)] as never;
    await act(async () => { await Promise.all(h.pause.map((e) => e.cb())); await vi.advanceTimersByTimeAsync(0); });
    expect(h.presign).toHaveBeenCalledTimes(1);
  });

  it('언마운트하면 복귀·전환 구독이 해제된다', async () => {
    await act(async () => root.render(<Harness />));
    expect(h.resume).toHaveLength(1);
    await act(async () => root.render(null));
    expect(h.resume).toHaveLength(0);
    expect(h.pause).toHaveLength(0);
  });
});
