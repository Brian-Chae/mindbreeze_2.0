// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter, useLocation, useParams } from 'react-router-dom';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import SidebarNav from '../src/components/layout/SidebarNav';
import HostTabs from '../src/components/layout/BottomTabBar';
import MemberTabs from '../src/components/client/BottomTabBar';
import { term } from '../src/lib/terms';
import { resolveNotificationTarget } from '../src/lib/api/notifications';
import { useAuthStore } from '../src/stores/authStore';
import { useReportStore } from '../src/stores/reportStore';
import { useNotificationStore } from '../src/stores/notificationStore';

const routing = vi.hoisted(() => ({
  router: null as ReturnType<typeof import('react-router-dom')['createMemoryRouter']> | null,
  getSession: vi.fn(),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, createBrowserRouter: (routes: Parameters<typeof actual.createMemoryRouter>[0]) => {
    routing.router = actual.createMemoryRouter(routes);
    return routing.router;
  } };
});
vi.mock('../src/lib/api/session', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api/session')>(), getSession: routing.getSession,
}));
vi.mock('../src/lib/native/use-status-bar', () => ({ useStatusBar: () => {} }));
vi.mock('../src/lib/native/keyboard', () => ({ initNativeKeyboard: async () => {} }));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => false }));

// 실제 App 라우트·RoleGuard·리다이렉트는 유지하고 네트워크를 쓰는 말단 화면만 대체한다.
function RoutedPage({ name, role }: { name: string; role?: string }) {
  const location = useLocation();
  const params = useParams();
  return createElement('output', { 'data-testid': 'route-page' }, `${name}|${role ?? ''}|${location.pathname}|${params.id ?? ''}`);
}
vi.mock('../src/pages/LandingPage', () => ({ default: () => createElement(RoutedPage, { name: 'landing' }) }));
vi.mock('../src/pages/LoginPage', () => ({ default: () => createElement(RoutedPage, { name: 'login' }) }));
vi.mock('../src/pages/ClientLoginPage', () => ({ default: () => createElement(RoutedPage, { name: 'client-login' }) }));
vi.mock('../src/pages/NotFoundPage', () => ({ default: () => createElement(RoutedPage, { name: 'not-found' }) }));
vi.mock('../src/pages/client/ClientAppPage', () => ({ default: () => createElement(RoutedPage, { name: 'legacy-client' }) }));
vi.mock('../src/pages/classes/host-classes-page', () => ({ HostClassesPage: () => createElement(RoutedPage, { name: 'host-classes' }) }));
vi.mock('../src/pages/classes/host-class-detail-page', () => ({ HostClassDetailPage: () => createElement(RoutedPage, { name: 'host-detail' }) }));
vi.mock('../src/pages/client/member-structure-home-page', () => ({ MemberStructureHomePage: () => createElement(RoutedPage, { name: 'member-home' }) }));
vi.mock('../src/pages/client/member-classes-page', () => ({ MemberClassesPage: () => createElement(RoutedPage, { name: 'member-classes' }) }));
vi.mock('../src/pages/client/member-class-detail-page', () => ({ MemberClassDetailPage: () => createElement(RoutedPage, { name: 'member-detail' }) }));
vi.mock('../src/pages/sessions/SessionDetailPage', () => ({ default: () => createElement(RoutedPage, { name: 'session-detail' }) }));
vi.mock('../src/pages/sessions/SessionListPage', () => ({ default: () => createElement(RoutedPage, { name: 'legacy-list' }) }));
vi.mock('../src/components/class/flow/host/CreateWizardContainer', () => ({ CreateWizardContainer: () => createElement(RoutedPage, { name: 'wizard' }) }));
vi.mock('../src/pages/sessions/SessionLivePage', () => ({ default: () => createElement(RoutedPage, { name: 'live' }) }));
vi.mock('../src/pages/sessions/ClassPlayerPage', () => ({ default: () => createElement(RoutedPage, { name: 'player' }) }));
vi.mock('../src/pages/records/SessionRecordPage', () => ({ default: () => createElement(RoutedPage, { name: 'record' }) }));
vi.mock('../src/pages/class/CodeEntryPage', () => ({ default: () => createElement(RoutedPage, { name: 'join' }) }));
vi.mock('../src/pages/class/EntryPage', () => ({ default: () => createElement(RoutedPage, { name: 'enter' }) }));
vi.mock('../src/pages/clients/ClientListPage', () => ({ default: () => createElement(RoutedPage, { name: 'legacy-clients' }) }));
vi.mock('../src/pages/clients/ClientProfilePage', () => ({ default: () => createElement(RoutedPage, { name: 'client-profile' }) }));
vi.mock('../src/pages/clients/ClientInvitePage', () => ({ default: () => createElement(RoutedPage, { name: 'client-invite' }) }));
vi.mock('../src/pages/counseling/counseling-list-page', () => ({ CounselingListPage: ({ role }: { role: string }) => createElement(RoutedPage, { name: 'counseling-list', role }) }));
vi.mock('../src/pages/counseling/counseling-detail-page', () => ({ CounselingDetailPage: ({ role }: { role: string }) => createElement(RoutedPage, { name: 'counseling-detail', role }) }));

const render = (node: ReturnType<typeof createElement>, path = '/classes') => {
  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)));
  const html = container.innerHTML;
  flushSync(() => root.unmount());
  return html;
};

describe('현재 계약 보존', () => {
  it('기존 용어 키와 기본 영역을 보존한다', () => {
    expect(term('class')).toBe('클래스');
    expect(term('client', 'counseling')).toBe('내담자');
    expect(term('org-counselors')).toBe('상담사');
  });
  it('기존 알림과 회원 입장 경로를 보존한다', () => {
    expect(resolveNotificationTarget({ target_type: 'session', target_id: 's' })).toEqual({ path: '/sessions/s' });
    expect(resolveNotificationTarget({ target_type: 'session', target_id: 's', event_type: 'session_started' }, 'client')).toEqual({ path: '/class/s/enter' });
    expect(resolveNotificationTarget({ report_id: 'r' }, 'client')).toEqual({ path: '/app/reports?report=r' });
    expect(resolveNotificationTarget({ room_id: 'c', params: { message_id: 'm' } })).toEqual({ path: '/chat/c?message=m' });
    expect(resolveNotificationTarget({ target_type: 'unknown', target_id: 'x' })).toBeNull();
  });
});

describe('새 내비게이션', () => {
  it('영역별 호칭과 가산 메뉴 키를 제공한다', () => {
    expect(term('counseling')).toBe('상담');
    expect(term('my-class')).toBe('내 클래스');
    expect(term('my-counseling')).toBe('내 상담');
    expect(term('members')).toBe('구성원');
    expect(term('instructor')).toBe('지도사');
    expect(term('instructor', 'counseling')).toBe('상담사');
  });
  it('회원 사이드바는 두 영역을 항상 표시하고 active와 배지를 분리한다', () => {
    const html = render(createElement(SidebarNav, { role: 'client', notificationBadge: 3, sessionBadge: 2 }), '/app/counseling/r');
    expect(html).toContain('href="/app/classes"');
    expect(html).toContain('href="/app/counseling"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/app\/counseling"/);
    expect(html).toContain('내 상담');
    expect(html).not.toContain('/app/sessions');
  });
  it('호스트 메뉴는 홈·명상 클래스·상담을 노출한다', () => {
    const html = render(createElement(SidebarNav));
    expect(html).toContain('href="/classes"');
    expect(html).toContain('href="/counseling"');
    expect(html).not.toContain('href="/clients"');
    expect(html).toContain('명상 클래스');
  });
  it('플랫폼 관리자는 기존 업무 권한을 유지한다', () => {
    const previous = useAuthStore.getState().user;
    useAuthStore.setState({ user: { id: 'admin', role: 'platform_admin', name: '관리자' } as NonNullable<typeof previous> });
    const html = render(createElement(SidebarNav));
    expect(html).toContain('/admin/orgs');
    expect(html).not.toContain('href="/classes"');
    useAuthStore.setState({ user: previous });
  });
  it('호스트 탭은 상담·채팅과 더보기 승인 배지를 표시한다', () => {
    useReportStore.setState({ pendingReview: 4 });
    useNotificationStore.setState({ unread: 2, sessionInvites: [{ sessionId: 's', notificationId: 'n' }] });
    const html = render(createElement(HostTabs, { onMoreClick: () => {}, role: 'org_admin' }));
    expect(html).toContain('/dashboard/org');
    expect(html).toContain('/counseling');
    expect(html).toContain('/chat');
    expect(html).not.toContain('href="/reports');
    expect(html).toContain('더보기 6건');
  });
  it('회원 탭은 내 상담·리포트를 표시하고 채팅을 더보기로 옮긴다', () => {
    const html = render(createElement(MemberTabs, { onMoreClick: () => {} }), '/app/counseling');
    expect(html).toContain('내 클래스');
    expect(html).toContain('내 상담');
    expect(html).toContain('리포트');
    expect(html).not.toContain('>채팅<');
    expect(html).toContain('aria-current="page"');
  });
  it('명시적인 부모 대상만 역할별 URL로 해석한다', () => {
    expect(resolveNotificationTarget({ target_type: 'class', target_id: 'a/b' }, 'client')).toEqual({ path: '/app/classes/a%2Fb' });
    expect(resolveNotificationTarget({ target_type: 'counseling', target_id: 'r' })).toEqual({ path: '/counseling/r' });
    expect(resolveNotificationTarget({ target_type: 'class' })).toBeNull();
    expect(resolveNotificationTarget({ target_type: 'counseling', target_id: ' ' })).toBeNull();
  });
});

describe('읽기 화면 공통 상태', () => {
  it('로딩·빈 목록·오류·404를 구분하고 서버 원문을 노출하지 않는다', async () => {
    const { ReadStateView } = await import('../src/components/class/structure/read-state');
    expect(render(createElement(ReadStateView, { status: 'loading' }))).toContain('불러오는 중');
    expect(render(createElement(ReadStateView, { status: 'empty', area: 'counseling' }))).toContain('아직 상담이 없어요');
    expect(render(createElement(ReadStateView, { status: 'empty' }))).toContain('아직 클래스가 없어요');
    const error = render(createElement(ReadStateView, { status: 'error', onRetry: () => {} }));
    expect(error).toContain('목록을 불러오지 못했어요');
    expect(error).toContain('다시 시도');
    const missing = render(createElement(ReadStateView, { status: 'not_found', backTo: '/app/counseling' }));
    expect(missing).toContain('내용을 찾을 수 없어요');
    expect(missing).toContain('href="/app/counseling"');
  });
  it('재시도 클릭은 콜백을 한 번 실행한다', async () => {
    const { ReadStateView } = await import('../src/components/class/structure/read-state');
    const { vi } = await import('vitest');
    const retry = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(createElement(ReadStateView, { status: 'error', onRetry: retry })));
    container.querySelector('button')?.click();
    expect(retry).toHaveBeenCalledTimes(1);
    flushSync(() => root.unmount());
  });
  it('실제 0·false를 누락과 구분한다', async () => {
    const { ReadField } = await import('../src/components/class/structure/read-state');
    expect(render(createElement(ReadField, { value: 0 }))).toContain('0');
    expect(render(createElement(ReadField, { value: false }))).toContain('아니요');
    expect(render(createElement(ReadField, { value: null }))).toContain('데이터 없음');
    expect(render(createElement(ReadField, {}))).toContain('데이터 없음');
  });
  it('공통 상태 문구에 영역별 금지어와 개발 용어가 없다', async () => {
    const { ReadStateView } = await import('../src/components/class/structure/read-state');
    for (const area of ['meditation', 'counseling'] as const) {
      for (const status of ['loading', 'empty', 'error', 'not_found'] as const) {
        const html = render(createElement(ReadStateView, { status, area, onRetry: () => {} }));
        const text = document.createElement('div');
        text.innerHTML = html;
        expect(text.textContent).not.toMatch(/API|DTO|Phase|placeholder|shim|JSON|세션|수업|오픈/);
        if (area === 'counseling') expect(text.textContent).not.toContain('클래스');
      }
    }
  });
});


describe('읽기 전용 셸 선택', () => {
  it('회원·호스트 셸은 opt-in 스타일을 한 번만 적용한다', async () => {
    const { StructureShell } = await import('../src/components/class/structure/structure-shell');
    const { renderToStaticMarkup } = await import('react-dom/server');
    for (const role of ['host', 'member'] as const) {
      const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(StructureShell, { role, title: '상담 일정', area: 'counseling' }, '본문')));
      expect(html.match(/class="cs-structure /g)).toHaveLength(1);
      expect(html).toContain('data-area="counseling"');
      expect(html).toContain('본문');
    }
  });
  it('기존 AppShell 기본값에 새 스타일을 적용하지 않는다', async () => {
    const { default: AppShell } = await import('../src/components/layout/AppShell');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(AppShell, { title: '기존 화면', children: '본문' })));
    expect(html).not.toContain('cs-structure');
  });
});


describe('더보기 상호작용', () => {
  it('더보기로 옮긴 경로는 더보기에 활성 상태를 표시한다', () => {
    const html = render(createElement(HostTabs, { role: 'counselor', onMoreClick: () => {} }), '/reports');
    const element = document.createElement('div');
    element.innerHTML = html;
    expect(element.querySelector('button')?.getAttribute('aria-current')).toBe('page');
    expect(element.querySelector('button')?.className).toContain('text-[#5F0080]');
  });
  it('회원 채팅에서는 내 상담 탭 대신 더보기가 활성화된다', () => {
    const html = render(createElement(MemberTabs, { onMoreClick: () => {} }), '/app/chat/lucy');
    const element = document.createElement('div');
    element.innerHTML = html;
    const buttons = element.querySelectorAll('button');
    expect(buttons[buttons.length - 1].getAttribute('aria-current')).toBe('page');
    expect(buttons[buttons.length - 1].className).toContain('text-[#5F0080]');
    expect([...buttons].filter((button) => button.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });
});

describe('역할 경계 회귀', () => {
  it('기관 관리자는 기존 구성원 관리 경로를 유지한다', () => {
    const previous = useAuthStore.getState().user;
    useAuthStore.setState({ user: { id: 'org', role: 'org_admin', name: '관리자' } as NonNullable<typeof previous> });
    const html = render(createElement(SidebarNav));
    expect(html).toContain('href="/org/counselors"');
    expect(html).toContain('구성원');
    expect(html).toContain('기관 대시보드');
    expect(html).not.toContain('플레이그라운드');
    useAuthStore.setState({ user: previous });
  });
  it('플랫폼 관리자 모바일 내비는 새 목록 경로와 기존 홈 활성 상태를 유지한다', () => {
    const html = render(createElement(HostTabs, { role: 'platform_admin', onMoreClick: () => {} }), '/admin/orgs/example');
    expect(html).toContain('/admin/orgs');
    expect(html).toContain('href="/classes"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/orgs"/);
    expect(html).not.toContain('href="/counseling"');
  });
  it('RoleGuard는 회원·플랫폼 관리자의 호스트 본문을 렌더링하지 않는다', async () => {
    const { RoleGuard } = await import('../src/components/auth/RoleGuard');
    const previous = useAuthStore.getState();
    for (const role of ['client', 'platform_admin', 'counselor', 'org_admin'] as const) {
      useAuthStore.setState({ isAuthenticated: true, isInitialized: true, user: { id: role, role, name: '사용자' } as NonNullable<typeof previous.user> });
      const html = render(createElement(RoleGuard, { role: ['counselor', 'org_admin'], children: '보호된 본문' }));
      expect(html.includes('보호된 본문')).toBe(role === 'counselor' || role === 'org_admin');
    }
    useAuthStore.setState({ isAuthenticated: false });
    expect(render(createElement(RoleGuard, { role: 'counselor', children: '보호된 본문' }))).not.toContain('보호된 본문');
    useAuthStore.setState(previous);
  });
});


// App.tsx가 생성하는 실제 라우트 트리를 메모리 이력으로 실행한다.
describe('T13 실제 라우트 연결', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement;
  let previous: ReturnType<typeof useAuthStore.getState>;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    if (previous) useAuthStore.setState(previous);
    routing.getSession.mockReset();
  });
  afterAll(() => routing.router?.dispose());
  async function open(path: string, role: 'counselor' | 'org_admin' | 'client' | 'platform_admin' | null = 'counselor') {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    previous = useAuthStore.getState();
    useAuthStore.setState({ isInitialized: true, isAuthenticated: role !== null, initialize: async () => {},
      user: role ? { id: role, role, name: '사용자', counselors: [] } as NonNullable<typeof previous.user> : null });
    const { default: App } = await import('../src/App');
    await routing.router!.navigate(path);
    container = document.createElement('div');
    root = createRoot(container);
    await act(async () => root!.render(createElement(App)));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="route-page"]')).not.toBeNull());
    return container.textContent ?? '';
  }
  const hostPages = [
    ['/classes', 'host-classes'], ['/classes/new', 'wizard'],
    ['/classes/c', 'host-detail'], ['/classes/c/sessions', 'host-detail'],
    ['/classes/c/sessions/s', 'session-detail'], ['/counseling', 'counseling-list|host'],
    ['/counseling/new', 'wizard'], ['/counseling/r', 'counseling-detail|host'],
    ['/counseling/r/sessions/s', 'session-detail'],
  ];
  for (const role of ['counselor', 'org_admin'] as const) for (const [path, page] of hostPages) {
    it(`${role}: ${path} → ${page}`, async () => {
      expect(await open(path, role)).toContain(`${page}|`);
      expect(routing.router!.state.location.pathname).toBe(path);
      if (page === 'session-detail') expect(container.textContent).toContain('|s');
    });
  }
  const memberPages = [
    ['/app', 'member-home'], ['/app/classes', 'member-classes'], ['/app/classes/c', 'member-detail'],
    ['/app/counseling', 'counseling-list|member'], ['/app/counseling/r', 'counseling-detail|member'],
  ];
  for (const [path, page] of memberPages) it(`상담사 미연결 회원: ${path}`, async () => {
    expect(await open(path, 'client')).toContain(`${page}|`);
    expect(container.textContent).not.toContain('legacy-client');
  });
  for (const role of ['client', 'platform_admin', null] as const) for (const [path] of hostPages) {
    it(`${role ?? '미인증'} → 호스트 ${path} 거부`, async () => {
      expect(await open(path, role)).toContain(role === null ? 'login|' : 'landing|');
      expect(routing.router!.state.location.pathname).toBe(role === null ? '/login' : '/');
      if (role === null) expect(routing.router!.state.location.search).toBe(path.startsWith('/app') ? '?role=client' : '?role=counselor');
      expect(routing.getSession).not.toHaveBeenCalled();
    });
  }
  for (const role of ['counselor', 'org_admin', 'platform_admin', null] as const) for (const [path] of memberPages) {
    it(`${role ?? '미인증'} → 회원 ${path} 거부`, async () => {
      expect(await open(path, role)).toContain(role === null ? 'login|' : 'landing|');
      expect(routing.router!.state.location.pathname).toBe(role === null ? '/login' : '/');
      if (role === null) expect(routing.router!.state.location.search).toBe(path.startsWith('/app') ? '?role=client' : '?role=counselor');
    });
  }
  for (const path of ['/app/chat', '/app/reports', '/app/notifications', '/app/profile', '/app/sessions/s']) {
    it(`기존 회원 경로 유지: ${path}`, async () => {
      expect(await open(path, 'client')).toContain('legacy-client|');
      expect(routing.router!.state.location.pathname).toBe(path);
    });
  }
  for (const [path, page] of [['/sessions/s/live','live'], ['/sessions/s/player','player'], ['/sessions/s/record','record'], ['/join','join'], ['/class/s/enter','enter']]) {
    it(`공유 엔진·입장 유지: ${path}`, async () => {
      expect(await open(path)).toContain(`${page}|`);
      expect(routing.router!.state.location.pathname).toBe(path);
    });
  }
  for (const [from, to, role] of [
    ['/sessions','/classes','counselor'], ['/sessions/new','/classes/new','org_admin'],
    ['/app/sessions','/app/classes','client'],
  ] as const) it(`레거시 ${from} → ${to}`, async () => {
    await open(from, role);
    expect(routing.router!.state.location.pathname).toBe(to);
    expect(routing.getSession).not.toHaveBeenCalled();
  });
  for (const [path, page] of [['/clients','legacy-clients'], ['/clients/invite','client-invite'], ['/clients/person','client-profile']]) {
    it(`기존 내담자 경로 유지: ${path}`, async () => expect(await open(path)).toContain(`${page}|`));
  }
  for (const [response, target] of [
    [{ area: 'meditation', class_id: 'c' }, '/classes/c/sessions/s'],
    [{ area: 'counseling', counseling_relationship_id: 'r' }, '/counseling/r/sessions/s'],
    [{ area: 'counseling', class_id: 'must-not-infer' }, '/classes'],
    [{}, '/classes'], [null, '/classes'],
    [{ area: 'unknown', class_id: 'c' }, '/classes'],
  ] as const) it(`레거시 회차 부모 해석: ${JSON.stringify(response)}`, async () => {
    routing.getSession.mockResolvedValue(response);
    await open('/sessions/s');
    expect(routing.router!.state.location.pathname).toBe(target);
    expect(routing.getSession.mock.calls).toEqual([['s']]);
  });
  it('레거시 조회 오류는 원문 노출 없이 클래스 목록으로 복귀한다', async () => {
    routing.getSession.mockRejectedValue(new Error('서버 비밀 원문'));
    const html = await open('/sessions/s');
    expect(routing.router!.state.location.pathname).toBe('/classes');
    expect(html).not.toContain('서버 비밀 원문');
    expect(routing.getSession.mock.calls).toEqual([['s']]);
  });
  it('미인증 레거시 회차 진입에서는 조회하지 않는다', async () => {
    expect(await open('/sessions/s', null)).toContain('login|');
    expect(routing.getSession).not.toHaveBeenCalled();
  });
  it('이탈 후 늦게 도착한 레거시 응답은 다시 이동시키지 않는다', async () => {
    let finish: (value: unknown) => void = () => {};
    routing.getSession.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const opening = open('/sessions/slow');
    await vi.waitFor(() => expect(routing.getSession).toHaveBeenCalledTimes(1));
    await act(async () => { await routing.router!.navigate('/classes'); });
    await opening;
    await act(async () => { finish({ area: 'meditation', class_id: 'stale' }); });
    expect(routing.router!.state.location.pathname).toBe('/classes');
  });
  it('계정 전환 전 응답은 버리고 새 계정으로 다시 해석한다', async () => {
    let oldFinish: (value: unknown) => void = () => {};
    let newFinish: (value: unknown) => void = () => {};
    routing.getSession.mockReturnValueOnce(new Promise((resolve) => { oldFinish = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { newFinish = resolve; }));
    const opening = open('/sessions/slow');
    await vi.waitFor(() => expect(routing.getSession).toHaveBeenCalledTimes(1));
    await act(async () => { const user = useAuthStore.getState().user!; useAuthStore.setState({ user: { ...user, id: 'new-user' } }); });
    await vi.waitFor(() => expect(routing.getSession).toHaveBeenCalledTimes(2));
    await act(async () => { oldFinish({ area: 'meditation', class_id: 'old-user-class' }); });
    expect(routing.router!.state.location.pathname).toBe('/sessions/slow');
    await act(async () => { newFinish({ area: 'meditation', class_id: 'new-user-class' }); });
    await opening;
    expect(routing.router!.state.location.pathname).toBe('/classes/new-user-class/sessions/slow');
  });
  it('알 수 없는 최상위 URL은 기존 404를 유지한다', async () => {
    expect(await open('/missing-page')).toContain('not-found|');
  });
});

describe('레거시 부모 경로의 순수 해석', () => {
  it('영역과 명시 ID만 사용하고 URL 경로 조각을 인코딩한다', async () => {
    const { resolveLegacySessionPath } = await import('../src/components/routing/legacy-session-path');
    expect(resolveLegacySessionPath('s/a', { area: 'meditation', class_id: 'c/a' })).toBe('/classes/c%2Fa/sessions/s%2Fa');
    // 현재 응답에는 미제공인 관계 ID의 가산 상황을 합성 검증한다.
    expect(resolveLegacySessionPath('s', { area: 'counseling', counseling_relationship_id: 'r' })).toBe('/counseling/r/sessions/s');
  });
  it('이름·타입·class_id로 상담 관계를 추측하지 않는다', async () => {
    const { resolveLegacySessionPath } = await import('../src/components/routing/legacy-session-path');
    for (const response of [null, [], {}, { area: 'meditation', class_id: 0 }, { area: 'meditation', class_id: ' ' }, { area: 'counseling', class_id: 'c', type: 'clinical' }, { area: 'unknown', class_id: 'c' }]) {
      expect(resolveLegacySessionPath('s', response)).toBe('/classes');
    }
  });
});
