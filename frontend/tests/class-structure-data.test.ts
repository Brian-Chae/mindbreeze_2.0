// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// SDD-219: 상담 공개(플래그 on) 기준의 기존 동작을 검증한다.
vi.stubEnv('VITE_COUNSELING_ENABLED', 'true');
import { apiClient, ApiError, tokenStorage } from '../src/lib/api/client';
import * as api from '../src/lib/api/class-structure';
import { asClassId, asRelationshipId } from '../src/lib/class-structure/read-model';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('읽기 wrapper', () => {
  it('다섯 GET 경로와 envelope를 보존하고 쿼리를 직렬화한다', async () => {
    const payload = { classes: [], total: 0 };
    const get = vi.spyOn(apiClient, 'get').mockImplementation((path) => {
      if (path.startsWith('/classes?')) return Promise.resolve(payload);
      if (path.endsWith('/sessions')) return Promise.resolve({ sessions: [], total: 0 });
      if (path === '/counseling') return Promise.resolve({ relationships: [], total: 0 });
      return Promise.resolve(path.startsWith('/classes/') ? classFixture() : counselingFixture());
    });
    expect(await api.getClasses({ status: 'active & closed', page: 2, limit: 10 })).toBe(payload);
    await api.getClass(asClassId('a/b'));
    await api.getClassSessions(asClassId('a/b'));
    await api.getCounseling();
    await api.getCounselingDetail(asRelationshipId('r/1'));
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/classes?status=active+%26+closed&page=2&limit=10', '/classes/a%2Fb',
      '/classes/a%2Fb/sessions', '/counseling', '/counseling/r%2F1',
    ]);
  });
  it('공통 인증 오류를 wrapper에서 변조하지 않는다', async () => {
    const error = new ApiError(404, '비공개 원문', { secret: true });
    vi.spyOn(apiClient, 'get').mockRejectedValue(error);
    await expect(api.getClass(asClassId('missing'))).rejects.toBe(error);
  });
  it('취소된 요청은 전송을 시작하지 않고 진행 중 결과도 폐기한다', async () => {
    const controller = new AbortController();
    controller.abort();
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ classes: [], total: 0 });
    await expect(api.getClasses(undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(get).not.toHaveBeenCalled();
    const active = new AbortController();
    get.mockImplementation(() => new Promise(() => {}));
    const request = api.getClasses(undefined, active.signal);
    active.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

const classFixture = (patch: Partial<api.ClassDetailDto> = {}): api.ClassDetailDto => ({
  id: 'class-1', title: '마음', status: 'active', schedule_mode: 'fixed', planned_session_count: 1,
  area: 'meditation', progress: { completed: 1, total: 1 }, session_count: 1,
  next_session: null, has_open_session: false, location_type: 'online', location_address: null,
  linkband_mode: 'none', record_audio: false, capacity: 0, participant_mode: 'registered', default_duration_min: 0,
  host_view: { access_code: 'SECRET', instructors: [] }, ...patch,
});
const counselingFixture = (patch: Partial<api.CounselingDetailDto> = {}): api.CounselingDetailDto => ({
  id: 'rel-1', status: 'active', area: 'counseling', counselor: { id: 'host-1', name: null },
  client_display: '내담자 미지정', modality_default: null, session_count: 2, next_session: null,
  latest_session: null, sessions: [2, 5].map((seq) => ({ id: `s-${seq}`, seq, scheduled_at: null,
    status: 'completed', type: 'clinical', record_status: null, report_status: 'ready' })), ...patch,
});

describe('표시 adapter', () => {
  it('0·false와 누락을 구분하고 클래스 상태를 회차 완료에서 추론하지 않는다', async () => {
    const { adaptHostClass, adaptMemberClass } = await import('../src/lib/class-structure/adapters');
    const { displayField } = await import('../src/lib/class-structure/read-model');
    expect(displayField(0)).toEqual({ kind: 'value', value: 0 });
    expect(displayField(false)).toEqual({ kind: 'value', value: false });
    expect(displayField(null)).toEqual({ kind: 'no_data', label: '데이터 없음' });
    expect(displayField(undefined)).toEqual({ kind: 'no_data', label: '데이터 없음' });
    const host = adaptHostClass(classFixture());
    expect(host.status).toEqual({ kind: 'value', value: 'active' });
    expect(host.capacity).toEqual({ kind: 'value', value: 0 });
    expect(host.recordAudio).toEqual({ kind: 'value', value: false });
    expect(host.hostView).toEqual({ accessCode: { kind: 'value', value: 'SECRET' }, instructors: [] });
    const member = adaptMemberClass(classFixture());
    expect(JSON.stringify(member)).not.toContain('SECRET');
    expect(member).not.toHaveProperty('hostView');
    expect(member.attendance).toEqual({ kind: 'no_data', label: '데이터 없음' });
    expect(adaptMemberClass(classFixture({ progress: undefined })).progress).toEqual({ kind: 'no_data', label: '데이터 없음' });
    expect(adaptMemberClass(classFixture({ progress: { completed: 0 } as api.ProgressDto })).progress).toEqual({ kind: 'no_data', label: '데이터 없음' });
  });
  it('취소·누락 번호와 서버가 반환한 번호 빈칸을 그대로 보존한다', async () => {
    const { adaptClassSessions, adaptCounseling } = await import('../src/lib/class-structure/adapters');
    const rows: api.ClassSessionDto[] = [1, 3, 7, null].map((seq, index) => ({ id: `row-${index}`, seq,
      scheduled_at: null, status: index === 1 ? 'cancelled' : 'completed', session_kind: 'regular',
      host: { id: 'host-1', name: null }, host_state: null }));
    const copy = JSON.stringify(rows);
    const result = adaptClassSessions(rows);
    expect(result.map((row) => row.seq)).toEqual([...[1, 3, 7].map((value) => ({ kind: 'value', value })), { kind: 'no_data', label: '데이터 없음' }]);
    expect(result[1].status).toEqual({ kind: 'value', value: 'cancelled' });
    expect(JSON.stringify(rows)).toBe(copy);
    const counseling = adaptCounseling(counselingFixture());
    expect(counseling.title).toBe('상담 일정');
    expect(counseling.sessions.map((row) => row.seq)).toEqual([{ kind: 'value', value: 2 }, { kind: 'value', value: 5 }]);
    expect(counseling).not.toHaveProperty('personalCount');
    expect(counseling.counselorName).toEqual({ kind: 'no_data', label: '데이터 없음' });
    expect(counseling.sessions[0].reportStatus).toEqual({ kind: 'value', value: 'ready' });
    expect(counseling.sessions[0]).not.toHaveProperty('reportBody');
  });
  it('검증되지 않은 필수 ID를 링크 가능한 모델로 만들지 않는다', async () => {
    const { adaptHostClass } = await import('../src/lib/class-structure/adapters');
    expect(() => adaptHostClass(classFixture({ id: '' }))).toThrow();
  });
  it('혼합 홈은 서버 다음 일정만 비교하고 부분 실패를 보존한다', async () => {
    const { adaptMixedHome } = await import('../src/lib/class-structure/adapters');
    const classes = { status: 'success' as const, data: { classes: [classFixture({ next_session: {
      id: 'next-m', seq: 3, status: 'scheduled', scheduled_at: '2030-01-02T00:00:00Z', host: { id: 'h', name: '지도사' },
    } })], total: 40 } };
    const counseling = { status: 'success' as const, data: { relationships: [counselingFixture({ next_session: {
      id: 'next-c', seq: 5, status: 'scheduled', scheduled_at: '2030-01-01T00:00:00Z',
    } })], total: 1 } };
    const home = adaptMixedHome(classes, counseling, Date.parse('2029-01-01T00:00:00Z'));
    expect(home.next.kind === 'value' && home.next.value.sessionId).toBe('next-c');
    expect(home.nextIsComplete).toBe(false);
    expect(adaptMixedHome({ ...classes, data: { ...classes.data, total: 1 } }, counseling, 0).nextIsComplete).toBe(true);
    expect(home.classes.status === 'success' && home.classes.data.total).toBe(40);
    const partial = adaptMixedHome(classes, { status: 'error', message: '목록을 불러오지 못했어요' }, 0);
    expect(partial.counseling.status).toBe('error');
    expect(partial.nextIsComplete).toBe(false);
    expect(adaptMixedHome({ status: 'success', data: { classes: [], total: 0 } },
      { status: 'success', data: { relationships: [], total: 0 } }).next.kind).toBe('no_data');
    classes.data.classes[0].next_session!.scheduled_at = '잘못된 날짜';
    expect(adaptMixedHome(classes, { status: 'success', data: { relationships: [], total: 0 } }).next.kind).toBe('no_data');
  });
});


describe('새 경로', () => {
  it('역할별 부모·회차를 구분하고 미확인 영역을 추측하지 않는다', async () => {
    const nav = await import('../src/lib/class-structure/navigation');
    const { asSessionId } = await import('../src/lib/class-structure/read-model');
    const c = asClassId('c/1'), r = asRelationshipId('r/1'), s = asSessionId('s/1');
    expect(nav.classPath('host', c)).toBe('/classes/c%2F1');
    expect(nav.classPath('member', c)).toBe('/app/classes/c%2F1');
    expect(nav.counselingPath('host', r)).toBe('/counseling/r%2F1');
    expect(nav.counselingPath('member', r)).toBe('/app/counseling/r%2F1');
    expect(nav.classSessionPath('host', c, s)).toBe('/classes/c%2F1/sessions/s%2F1');
    expect(nav.counselingSessionPath('host', r, s)).toBe('/counseling/r%2F1/sessions/s%2F1');
    expect(nav.classSessionPath('member', c, s)).toBe('/app/classes/c%2F1?sessionId=s%2F1');
    expect(nav.counselingSessionPath('member', r, s)).toBe('/app/counseling/r%2F1?sessionId=s%2F1');
    expect(nav.sessionPath('host', s)).toBe('/sessions/s%2F1');
    expect(nav.sessionPath('member', s)).toBe('/app/sessions/s%2F1');
    expect(nav.sessionPath('host', s, { area: 'unknown', classId: c })).toBe('/sessions/s%2F1');
    expect(nav.classSessionPath('host', null, s)).toBe('/classes');
    expect(nav.counselingSessionPath('member', null, s)).toBe('/app/counseling');
    expect(nav.sessionPath('host', s, { area: 'counseling', classId: c })).toBe('/counseling');
  });
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAuthStore } from '../src/stores/authStore';
import type { User } from '../src/lib/api/auth';
import type { ReadState } from '../src/lib/class-structure/read-model';

const user = (id: string, role: User['role'] = 'client'): User => ({
  id, role, name: id, email: `${id}@example.invalid`, verified_tier: 'unverified',
  onboarding_completed: true, auth_provider: 'email', counselors: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe('읽기 hook 수명', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useAuthStore.setState({ user: user('a'), isAuthenticated: true });
    container = document.createElement('div');
    document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });
  it('목록 공유는 1회 GET이며 해제 후 캐시 없이 재조회한다', async () => {
    const hooks = await import('../src/hooks/use-class-structure');
    const request = deferred<api.ClassListResponse>();
    const get = vi.spyOn(apiClient, 'get').mockImplementation(() => request.promise);
    function Probe() { const { state } = hooks.useClasses(); return createElement('span', null, JSON.stringify(state)); }
    await act(async () => root.render(createElement('div', null, createElement(Probe), createElement(Probe))));
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve({ classes: [], total: 0 }));
    expect(container.textContent).toContain('"status":"success"');
    expect(container.textContent).toContain('"classes":[]');
    await act(async () => root.render(null));
    await act(async () => root.render(createElement(Probe)));
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('이전 계정 응답과 로그아웃 직전 응답은 새 화면을 오염시키지 않는다', async () => {
    const hooks = await import('../src/hooks/use-class-structure');
    const old = deferred<api.ClassListResponse>();
    const next = deferred<api.ClassListResponse>();
    const get = vi.spyOn(apiClient, 'get').mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
    function Probe() { const { state } = hooks.useClasses(); return createElement('span', null, JSON.stringify(state)); }
    await act(async () => root.render(createElement(Probe)));
    await act(async () => useAuthStore.setState({ user: user('b') }));
    await act(async () => old.resolve({ classes: [classFixture({ title: '이전 계정 비밀' })], total: 1 }));
    expect(container.textContent).not.toContain('이전 계정 비밀');
    await act(async () => next.resolve({ classes: [classFixture({ title: '새 계정' })], total: 1 }));
    expect(container.textContent).toContain('새 계정');
    await act(async () => useAuthStore.setState({ user: null, isAuthenticated: false }));
    expect(container.textContent).not.toContain('새 계정');
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('부모 이동 후 늦은 결과를 버리고 상세/회차 두 GET만 공유한다', async () => {
    const hooks = await import('../src/hooks/use-class-structure');
    const old = deferred<api.ClassDetailDto>();
    const get = vi.spyOn(apiClient, 'get').mockImplementation((path) => {
      if (path.endsWith('/sessions')) return Promise.resolve({ sessions: [], total: 0 });
      if (path === '/classes/old') return old.promise;
      return Promise.resolve(classFixture({ id: 'new', title: '현재 부모' }));
    });
    function Probe({ id }: { id: string }) { const { state } = hooks.useClassDetail(asClassId(id)); return createElement('span', null, JSON.stringify(state)); }
    await act(async () => root.render(createElement('div', null, createElement(Probe, { id: 'old' }), createElement(Probe, { id: 'old' }))));
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => root.render(createElement(Probe, { id: 'new' })));
    await act(async () => old.resolve(classFixture({ title: '오래된 부모' })));
    expect(container.textContent).toContain('현재 부모');
    expect(container.textContent).not.toContain('오래된 부모');
    expect(get).toHaveBeenCalledTimes(4);
  });
  it('404는 원문 없는 동일 상태이고 재시도로 성공을 회복한다', async () => {
    const hooks = await import('../src/hooks/use-class-structure');
    const get = vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new ApiError(404, '비밀 이름', { id: 'secret' }))
      .mockResolvedValue(counselingFixture());
    let retry = () => {};
    let state: ReadState<api.CounselingDetailDto> = { status: 'loading' };
    function Probe() { const result = hooks.useCounselingDetail(asRelationshipId('rel')); retry = result.retry; state = result.state; return createElement('span', null, JSON.stringify(state)); }
    await act(async () => root.render(createElement(Probe)));
    expect(state).toEqual({ status: 'not_found', message: '내용을 찾을 수 없어요' });
    expect(container.textContent).not.toContain('비밀');
    await act(async () => retry());
    expect(state.status).toBe('success');
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('역할 전환과 같은 계정으로 돌아오는 전환에서도 취소를 무시한 응답을 폐기한다', async () => {
    const hooks = await import('../src/hooks/use-class-structure');
    const first = deferred<api.ClassListResponse>();
    const second = deferred<api.ClassListResponse>();
    const third = deferred<api.ClassListResponse>();
    const signals: AbortSignal[] = [];
    vi.spyOn(api, 'getClasses').mockImplementation((_params, signal) => {
      signals.push(signal!);
      return [first, second, third][signals.length - 1].promise;
    });
    function Probe() { const { state } = hooks.useClasses(); return createElement('span', null, JSON.stringify(state)); }
    await act(async () => root.render(createElement(Probe)));
    await act(async () => useAuthStore.setState({ user: user('a', 'counselor') }));
    expect(signals[0].aborted).toBe(true);
    await act(async () => useAuthStore.setState({ user: user('a', 'client') }));
    expect(signals[1].aborted).toBe(true);
    await act(async () => third.resolve({ classes: [classFixture({ title: '새 세대' })], total: 1 }));
    await act(async () => { first.resolve({ classes: [classFixture({ title: '늦은 회원 응답' })], total: 1 }); second.reject(new Error('늦은 오류')); });
    expect(container.textContent).toContain('새 세대');
    expect(container.textContent).not.toContain('늦은');
    expect(signals).toHaveLength(3);
    await act(async () => root.render(null));
    expect(signals[2].aborted).toBe(true);
  });
  it('혼합 홈은 한쪽 오류를 유지하고 목록 두 GET 외 상세를 요청하지 않는다', async () => {
    const hooks = await import('../src/hooks/use-class-structure');
    const get = vi.spyOn(apiClient, 'get').mockImplementation((path) => path === '/classes'
      ? Promise.resolve({ classes: [classFixture(), classFixture({ id: 'second' })], total: 2 })
      : Promise.reject(new ApiError(500, '민감한 원문', null)));
    function Probe() { const home = hooks.useMixedHome(); return createElement('span', null, JSON.stringify(home)); }
    await act(async () => root.render(createElement(Probe)));
    expect(container.textContent).toContain('"status":"success"');
    expect(container.textContent).toContain('목록을 불러오지 못했어요');
    expect(container.textContent).not.toContain('민감한 원문');
    expect(get.mock.calls.map(([path]) => path)).toEqual(['/classes', '/counseling']);
  });
});

describe('필수 응답 구조 검증', () => {
  it('손상된 envelope와 빈 부모·회차 ID는 오류로 처리한다', async () => {
    const get = vi.spyOn(apiClient, 'get');
    get.mockResolvedValueOnce({ classes: [{ id: '' }], total: 1 });
    await expect(api.getClasses()).rejects.toMatchObject({ status: 502 });
    get.mockResolvedValueOnce({ classes: [], total: null });
    await expect(api.getClasses()).rejects.toMatchObject({ status: 502 });
    get.mockResolvedValueOnce({ id: null });
    await expect(api.getClass(asClassId('c'))).rejects.toMatchObject({ status: 502 });
    get.mockResolvedValueOnce({ sessions: [{ id: ' ' }], total: 1 });
    await expect(api.getClassSessions(asClassId('c'))).rejects.toMatchObject({ status: 502 });
    get.mockResolvedValueOnce({ relationships: {}, total: 0 });
    await expect(api.getCounseling()).rejects.toMatchObject({ status: 502 });
    get.mockResolvedValueOnce({ id: 'r', sessions: [{ id: '' }] });
    await expect(api.getCounselingDetail(asRelationshipId('r'))).rejects.toMatchObject({ status: 502 });
  });
});


describe('공통 인증 경로 유지', () => {
  afterEach(() => tokenStorage.clear());
  it('기존 Bearer·cookie와 401 갱신 후 GET 재시도를 그대로 사용한다', async () => {
    tokenStorage.set('old-test-token');
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-test-token' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ classes: [], total: 0 })));
    vi.stubGlobal('fetch', fetch);
    expect(await api.getClasses()).toEqual({ classes: [], total: 0 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include', headers: { Authorization: 'Bearer old-test-token' } });
    expect(fetch.mock.calls[1][0]).toMatch(/\/auth\/refresh$/);
    expect(fetch.mock.calls[2][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer new-test-token' } });
    expect(tokenStorage.getAccess()).toBe('new-test-token');
  });
  it('403은 토큰을 지우거나 refresh 요청을 추가하지 않는다', async () => {
    tokenStorage.set('retained-test-token');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '접근 불가' }), { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.getCounseling()).rejects.toMatchObject({ status: 403 });
    expect(tokenStorage.getAccess()).toBe('retained-test-token');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
