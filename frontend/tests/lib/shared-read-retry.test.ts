// 계정 전환 중 거부된 공유 조회가 캐시에 남아 재시도까지 같은 거부를 받는 문제를 막는다.
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../src/lib/api/client';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('공유 조회(/chat/rooms) 계정 전환 재시도', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('조회 중 계정 범위가 바뀌어도 오류 없이 현재 계정으로 재조회한 결과를 돌려준다', async () => {
    localStorage.setItem('mb_user', JSON.stringify({ id: 'a', role: 'client' }));
    let resolveFirst: (r: Response) => void = () => {};
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>((res) => { resolveFirst = res; }))
      .mockImplementation(() => Promise.resolve(jsonResponse({ rooms: [{ id: 'r1' }] })));

    const first = apiClient.get('/chat/rooms');
    localStorage.setItem('mb_user', JSON.stringify({ id: 'b', role: 'client' })); // 응답 전에 계정 복원
    resolveFirst(jsonResponse({ rooms: [] }));
    await expect(first).resolves.toEqual({ rooms: [{ id: 'r1' }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
