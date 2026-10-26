// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as client from '../src/lib/api/client';
const { apiClient, tokenStorage } = client;
const reply = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  localStorage.clear();
  tokenStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => reply({ unread: 1 })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('동일 URL의 동시 조회와 30초 내 재조회를 HTTP 한 건으로 합친다', async () => {
  await Promise.all([apiClient.get('/notifications/unread-count'), apiClient.get('/notifications/unread-count')]);
  await apiClient.get('/notifications/unread-count');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('만료 및 다른 검색 조건은 새로 조회한다', async () => {
  vi.useFakeTimers();
  await apiClient.get('/notifications?limit=5');
  await apiClient.get('/notifications?limit=200');
  vi.advanceTimersByTime(30_001);
  await apiClient.get('/notifications?limit=5');
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('일반 화면 데이터는 캐시하지 않는다', async () => {
  await apiClient.get('/classes'); await apiClient.get('/classes');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('실패한 응답은 보관하지 않는다', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  await expect(apiClient.get('/chat/rooms')).rejects.toThrow('offline');
  await apiClient.get('/chat/rooms');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('한 소비자의 취소는 공유 조회를 중단하지 않는다', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const first = apiClient.get('/classes/instructor-candidates', { signal: controller.signal });
  const second = apiClient.get('/classes/instructor-candidates');
  controller.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  finish(reply({ instructors: [] }));
  await expect(second).resolves.toEqual({ instructors: [] });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('계정 변경과 토큰 폐기 시 이전 캐시를 사용하지 않는다', async () => {
  await apiClient.get('/chat/rooms');
  localStorage.setItem('mb_user', JSON.stringify({ id: 'next' }));
  await apiClient.get('/chat/rooms');
  tokenStorage.clear();
  await apiClient.get('/chat/rooms');
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('변경 요청 전후 공통 데이터를 무효화한다', async () => {
  await apiClient.get('/notifications/unread-count');
  await apiClient.put('/notifications/read-all');
  await apiClient.get('/notifications/unread-count');
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('무효화 뒤 이전 진행 요청과 그 응답을 재사용하지 않는다', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = apiClient.get('/notifications/unread-count');
  tokenStorage.clear();
  const current = await apiClient.get('/notifications/unread-count');
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  finish(reply({ unread: 99 }));
  await rejected;
  expect(current).toEqual({ unread: 1 });
  expect(await apiClient.get('/notifications/unread-count')).toEqual({ unread: 1 });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('이벤트와 겹친 정상 응답은 실패 없이 최신 조회에 합류한다', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = apiClient.get('/notifications/unread-count');
  client.invalidateSharedReads('notifications');
  const fresh = apiClient.get('/notifications/unread-count');
  finish(reply({ unread: 99 }));
  expect(await old).toEqual({ unread: 1 });
  expect(await fresh).toEqual({ unread: 1 });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('채팅 이벤트는 진행 중 강사 후보와 알림을 폐기하지 않는다', async () => {
  await apiClient.get('/classes/instructor-candidates');
  await apiClient.get('/notifications/unread-count');
  client.invalidateSharedReads('chat');
  await apiClient.get('/classes/instructor-candidates');
  await apiClient.get('/notifications/unread-count');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('최초 연결은 진행 중 seed만 공유하고 완료된 seed는 재검증한다', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = apiClient.get('/notifications/unread-count');
  client.invalidateSharedReads('notifications', true);
  const shared = apiClient.get('/notifications/unread-count');
  finish(reply({ unread: 3 }));
  await Promise.all([old, shared]);
  expect(fetch).toHaveBeenCalledTimes(1);
  client.invalidateSharedReads('notifications', true);
  expect(await apiClient.get('/notifications/unread-count')).toEqual({ unread: 1 });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('다음 조회가 없어도 계정 전환 전에 시작한 응답은 버린다', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = apiClient.get('/notifications/unread-count');
  localStorage.setItem('mb_user', JSON.stringify({ id: 'other' }));
  const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  finish(reply({ unread: 99 }));
  await rejected;
});

it.each([
  '/sessions/s1/live-metrics', '/sessions/s1', '/sessions/s1/entry-state',
])('실시간 %s는 동시 요청도 반복 폴링도 캐시하지 않는다', async path => {
  let sequence = 0;
  vi.mocked(fetch).mockImplementation(async () => reply({ sequence: ++sequence }));
  expect(await Promise.all([apiClient.get(path), apiClient.get(path)]))
    .toEqual([{ sequence: 1 }, { sequence: 2 }]);
  expect(await apiClient.get(path)).toEqual({ sequence: 3 });
  expect(fetch).toHaveBeenCalledTimes(3);
});
