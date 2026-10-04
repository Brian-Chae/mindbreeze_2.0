// SDD-101 C3 후속 — 청크 업로드 재시도 정책 테스트
// 핵심: 네트워크 오류(TypeError)를 재시도해야 유실 청크가 줄어든다(기존엔 즉시 실패).

import { beforeEach, expect, it, vi } from 'vitest';
import { uploadFormWithRetry } from '../src/lib/api/upload-helper';

vi.mock('../src/lib/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data: unknown) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  tokenStorage: { getAccess: vi.fn(() => null) },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

it('네트워크 오류(TypeError)는 재시도 후 성공한다', async () => {
  fetchMock
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chunk_index: 0, received_bytes: 10, total_chunks: 1 }),
    });

  const res = await uploadFormWithRetry<{ chunk_index: number }>('http://x/video/chunk', new FormData());

  expect(res.chunk_index).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(2); // 1차 실패 + 1차 재시도 성공
});

it('4xx(ApiError)는 재시도하지 않는다', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({ detail: '영상 녹화가 시작되지 않았습니다' }),
  });

  await expect(uploadFormWithRetry('http://x/video/chunk', new FormData())).rejects.toThrow();

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('5xx(ApiError)는 재시도한다', async () => {
  fetchMock
    .mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ detail: 'bad gateway' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chunk_index: 0, received_bytes: 10, total_chunks: 1 }),
    });

  const res = await uploadFormWithRetry<{ chunk_index: number }>('http://x/video/chunk', new FormData());

  expect(res.chunk_index).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
