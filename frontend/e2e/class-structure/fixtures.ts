import { expect, test, type Page, type Route } from 'playwright/test';

export type QaRole = 'host' | 'member' | 'member-unlinked';
export type FixtureMode = 'normal' | 'empty' | 'missing-fields' | 'error' | 'not-found';

const hostClass = {
  id: 'class-1', title: 'MBSR 봄 클래스', status: 'active', schedule_mode: 'fixed',
  planned_session_count: 3, area: 'meditation', progress: { completed: 1, total: 3 },
  session_count: 3, next_session: { id: 'session-2', seq: 2, scheduled_at: '2026-11-20T10:00:00+09:00', status: 'scheduled', host: { id: 'host-1', name: '홍길동' } }, has_open_session: false,
};
const memberClass = { ...hostClass, host_view: undefined };
const classDetail = {
  ...hostClass, location_type: 'online', location_address: null, linkband_mode: 'none',
  record_audio: false, capacity: 0, participant_mode: 'open', default_duration_min: 60,
  host_view: { access_code: null, instructors: [{ user_id: 'host-1', name: '홍길동', role: 'lead', status: 'active' }] },
};
const classSession = { id: 'session-2', seq: 2, scheduled_at: '2026-11-20T10:00:00+09:00', status: 'scheduled', session_kind: 'meditation', host: { id: 'host-1', name: '홍길동' }, host_state: 'active' };
const counseling = {
  id: 'temporary-relationship-1', status: 'active', area: 'counseling', counselor: { id: 'counselor-1', name: '김상담' },
  client_display: '내담자 미지정', modality_default: null, session_count: 2,
  next_session: { id: 'session-3', seq: 5, scheduled_at: '2026-11-21T14:00:00+09:00', status: 'scheduled' },
  latest_session: { id: 'session-2', seq: 2, scheduled_at: '2026-11-14T14:00:00+09:00', status: 'completed' },
};
const counselingDetail = {
  ...counseling, sessions: [
    { id: 'session-2', seq: 2, scheduled_at: '2026-11-14T14:00:00+09:00', status: 'completed', type: 'individual', record_status: null, report_status: 'pending' },
    { id: 'session-3', seq: 5, scheduled_at: '2026-11-21T14:00:00+09:00', status: 'scheduled', type: 'individual', record_status: null, report_status: null },
  ],
};

export const apiFixtureData = {
  host: {
    classes: { classes: [hostClass], total: 1 }, classDetail,
    classSessions: { sessions: [classSession], total: 1 },
    counseling: { relationships: [counseling], total: 1 }, counselingDetail,
  },
  member: {
    classes: { classes: [memberClass], total: 1 }, classDetail: { ...classDetail, host_view: null },
    classSessions: { sessions: [classSession], total: 1 },
    counseling: { relationships: [counseling], total: 1 }, counselingDetail,
  },
  empty: {
    classes: { classes: [], total: 0 }, classSessions: { sessions: [], total: 0 },
    counseling: { relationships: [], total: 0 },
  },
};

export const roleFixtures: Record<QaRole, { id: string; email: string; name: string; role: 'counselor' | 'client'; verified_tier: 'verified'; onboarding_completed: boolean; auth_provider: string; counselors: Array<{ id: string; name: string; profile_image: string | null }> }> = {
  host: { id: 'qa-host', email: 'host@example.test', name: 'QA 상담사', role: 'counselor', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [] },
  member: { id: 'qa-member', email: 'member@example.test', name: 'QA 회원', role: 'client', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [{ id: 'qa-host', name: 'QA 상담사', profile_image: null }] },
  'member-unlinked': { id: 'qa-member-unlinked', email: 'unlinked@example.test', name: '미연결 QA 회원', role: 'client', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [] },
};

export const fixedClock = new Date('2026-11-17T09:00:00+09:00');

export const legacySessionFixture = { id: 'session-2', class_id: 'class-1', class_title: 'MBSR 봄 클래스', seq: 2, area: 'meditation' } as const;

type ApiRoute = { path: RegExp; key: keyof typeof apiFixtureData.host | 'classDetail' | 'classSessions' | 'counselingDetail'; emptyKey?: keyof typeof apiFixtureData.empty };
const apiRoutes: ApiRoute[] = [
  { path: /\/api\/v1\/classes\/?(?:\?.*)?$/, key: 'classes', emptyKey: 'classes' },
  { path: /\/api\/v1\/classes\/[^/]+\/sessions\/?(?:\?.*)?$/, key: 'classSessions', emptyKey: 'classSessions' },
  { path: /\/api\/v1\/classes\/[^/]+\/?(?:\?.*)?$/, key: 'classDetail' },
  { path: /\/api\/v1\/counseling\/?(?:\?.*)?$/, key: 'counseling', emptyKey: 'counseling' },
  { path: /\/api\/v1\/counseling\/[^/]+\/?(?:\?.*)?$/, key: 'counselingDetail' },
];

export async function installApiFixtures(page: Page, role: QaRole, mode: FixtureMode = 'normal'): Promise<void> {
  const dataRole = role === 'host' ? 'host' : 'member';
  await page.clock.install({ time: fixedClock });
  await page.addInitScript((fixtureRole) => {
    localStorage.setItem('mb_user', JSON.stringify(fixtureRole));
    Object.defineProperty(window, '__CLASS_STRUCTURE_QA_ROLE__', { value: fixtureRole.role, configurable: false });
  }, roleFixtures[role]);
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname.endsWith('/api/v1/auth/refresh')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'qa-access-token', token_type: 'bearer' }) });
      return;
    }
    if (route.request().method() !== 'GET' && url.pathname.startsWith('/api/v1/')) {
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ detail: '읽기 전용 검증에서 허용되지 않은 요청' }) });
      return;
    }
    if (/\/api\/v1\/sessions\/[^/]+\/?$/.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(legacySessionFixture) });
      return;
    }
    const match = apiRoutes.find((candidate) => candidate.path.test(`${url.pathname}${url.search}`));
    if (!match) {
      if (url.pathname.startsWith('/api/v1/')) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: '합성 검증에 등록되지 않은 API 경로' }) });
        return;
      }
      await route.continue();
      return;
    }
    if (mode === 'error') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'synthetic failure' }) });
      return;
    }
    if (mode === 'not-found') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not found' }) });
      return;
    }
    const selected = mode === 'empty' && match.emptyKey
      ? apiFixtureData.empty[match.emptyKey]
      : apiFixtureData[dataRole][match.key];
    const response = mode === 'missing-fields' && selected && typeof selected === 'object'
      ? Object.fromEntries(Object.entries(selected).filter(([key]) => !['total', 'progress', 'next_session', 'host_view', 'client_display'].includes(key)))
      : selected;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response ?? {}) });
  });
  await page.routeWebSocket(/^(?:ws|wss):\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/socket\.io(?:\/|\?|$)/i, (socket) => socket.close());
  await page.routeWebSocket(/^(?:ws|wss):\/\/(?!(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$))/i, (socket) => socket.close());
}

export async function prepareRole(page: Page, role: QaRole): Promise<void> {
  await page.goto('http://127.0.0.1:5441/');
  await page.evaluate((user) => localStorage.setItem('mb_user', JSON.stringify(user)), roleFixtures[role]);
  const refreshResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/refresh') && response.status() === 200);
  await page.reload();
  await refreshResponse;
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
}

export { expect, test };
