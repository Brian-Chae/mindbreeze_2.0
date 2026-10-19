import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../src/lib/api/client';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const json = (status = 200) => new Response(JSON.stringify({ ok: true }), { status });
describe('요청 수명', () => {
  it('이미 취소됐으면 네트워크를 호출하지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(json()); vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(apiClient.get('/classes', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('호출자 취소가 실제 fetch를 중단하며 408로 바꾸지 않는다', async () => {
    let fetchedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      fetchedSignal = init.signal as AbortSignal;
      fetchedSignal.addEventListener('abort', () => reject(new DOMException('취소', 'AbortError')));
    })));
    const controller = new AbortController();
    const result = apiClient.get('/classes', { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    expect(fetchedSignal?.aborted).toBe(true);
    await assertion;
  });
  it('타임아웃은 기존 408을 유지한다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('취소', 'AbortError')));
    })));
    const result = apiClient.get('/classes');
    const assertion = expect(result).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(15000); await assertion;
  });
  it('공유 인증 갱신 중 취소하면 재요청하지 않는다', async () => {
    let finish!: (res: Response) => void;
    const fetcher = vi.fn().mockResolvedValueOnce(json(401)).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const result = apiClient.get('/classes', { signal: controller.signal });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    finish(new Response(JSON.stringify({ access_token: 'new-token' })));
    await Promise.resolve(); await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
it('취소되지 않은 401은 공유 갱신 뒤 새 토큰으로 한 번 재시도한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json(401)).mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh' }))).mockResolvedValueOnce(json());
  vi.stubGlobal('fetch', fetcher);
  await expect(apiClient.get('/classes', { signal: new AbortController().signal })).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh');
});
it('공개 조회는 401이어도 인증 갱신을 하지 않는다', async () => {
  const fetcher = vi.fn().mockResolvedValue(json(401)); vi.stubGlobal('fetch', fetcher);
  await expect(apiClient.get('/classes', { skipAuth: true })).rejects.toMatchObject({ status: 401 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
