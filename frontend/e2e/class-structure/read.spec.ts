import { readFileSync } from 'node:fs';
import { caseManifest } from './cases';
import { expect, installApiFixtures, prepareRole, test, type QaRole } from './fixtures';

const appCases = caseManifest.filter((entry) => entry.classification !== 'X');
const screens = [...new Map(appCases.map((entry) => [entry.screen_id, entry])).values()];

for (const screen of screens) {
  test(`${screen.screen_id} ${screen.role} 경로가 읽기 화면을 제공한다`, async ({ page }) => {
    await installApiFixtures(page, screen.role as QaRole);
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/') && !request.url().endsWith('/api/v1/auth/refresh') && !['GET', 'HEAD'].includes(request.method())) {
        mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    await prepareRole(page, screen.role as QaRole);
    await page.goto(screen.app_url);
    await expect(page).toHaveURL(screen.app_url);
    const area = screen.screen_id.startsWith('CN') ? 'counseling' : 'meditation';
    await expect(page.locator(`[data-area="${area}"]`).first(), '로그인·리다이렉트 화면을 구조 화면 통과로 세지 않습니다.').toBeVisible();
    expect(mutations, '읽기 화면에서 쓰기 요청이 발생했습니다.').toEqual([]);
  });
}

test('타인 ID와 미존재 ID의 404 응답 형식·문구가 동일하다', async ({ page }) => {
  await installApiFixtures(page, 'host', 'not-found');
  await page.goto('http://127.0.0.1:5441/');
  const responses = await page.evaluate(async () => Promise.all(['other-user-id', 'missing-id'].map(async (id) => {
    const response = await fetch(`/api/v1/classes/${id}`);
    return { status: response.status, body: await response.text() };
  })));
  expect(responses[0]).toEqual(responses[1]);
  expect(responses[0].status).toBe(404);
});

test('호스트·회원 역할 경계가 서로의 읽기 화면을 차단한다', async ({ browser }) => {
  for (const [role, path] of [['host', '/app/classes'], ['member', '/classes']] as const) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5441' });
    const page = await context.newPage();
    await installApiFixtures(page, role);
    await prepareRole(page, role);
    await page.goto(path);
    await expect(page).not.toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(page.locator('[data-area="meditation"]')).toHaveCount(0);
    await context.close();
  }
});

test('레거시 목록·생성·회원 목록이 새 경로로 이동한다', async ({ browser }) => {
  const cases = [
    { role: 'host' as const, from: '/sessions', to: '/classes' },
    { role: 'host' as const, from: '/sessions/new', to: '/classes/new' },
    { role: 'host' as const, from: '/sessions/session-2', to: '/classes/class-1/sessions/session-2' },
    { role: 'member' as const, from: '/app/sessions', to: '/app/classes' },
  ];
  for (const route of cases) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5441' });
    const page = await context.newPage();
    await installApiFixtures(page, route.role);
    await prepareRole(page, route.role);
    await page.goto(route.from);
    await expect(page).toHaveURL(new RegExp(`${route.to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await context.close();
  }
});

test('코치 미연결 회원도 홈·내 클래스·내 상담 읽기 화면에 진입한다', async ({ browser }) => {
  for (const path of ['/app', '/app/classes', '/app/counseling']) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5441' });
    const page = await context.newPage();
    await installApiFixtures(page, 'member-unlinked');
    await prepareRole(page, 'member-unlinked');
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    if (path === '/app/counseling') {
      await expect(page.getByText('내 상담', { exact: true }).nth(1)).toBeVisible();
    } else {
      await expect(page.getByRole('heading').first()).toBeVisible();
    }
    await context.close();
  }
});

test('명상·상담 공개 문구가 기존 금지어 목록을 지킨다', async ({ browser }) => {
  const common = JSON.parse(readFileSync(new URL('../class-flow/banned/common.json', import.meta.url), 'utf8')) as string[];
  const meditation = JSON.parse(readFileSync(new URL('../class-flow/banned/meditation.json', import.meta.url), 'utf8')) as string[];
  const counseling = JSON.parse(readFileSync(new URL('../class-flow/banned/counseling.json', import.meta.url), 'utf8')) as string[];
  const areas = [
    { role: 'host' as const, path: '/classes', selector: '.cs-structure-scroll', terms: [...common, ...meditation] },
    { role: 'host' as const, path: '/classes/class-1', selector: '.cs-structure-scroll', terms: [...common, ...meditation] },
    { role: 'member' as const, path: '/app/classes', selector: '.cs-structure-scroll', terms: [...common, ...meditation] },
    { role: 'member' as const, path: '/app/classes/class-1', selector: '.cs-structure-scroll', terms: [...common, ...meditation] },
    { role: 'host' as const, path: '/counseling', selector: '.cs-structure-scroll', terms: [...common, ...counseling] },
    { role: 'host' as const, path: '/counseling/temporary-relationship-1', selector: '.cs-structure-scroll', terms: [...common, ...counseling] },
    { role: 'member' as const, path: '/app/counseling', selector: '.cs-structure-scroll', terms: [...common, ...counseling] },
    { role: 'member' as const, path: '/app/counseling/temporary-relationship-1', selector: '.cs-structure-scroll', terms: [...common, ...counseling] },
  ];
  for (const area of areas) {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5441' });
    const page = await context.newPage();
    await installApiFixtures(page, area.role);
    await prepareRole(page, area.role);
    await page.goto(area.path);
    const content = page.locator(area.selector);
    await expect(content, `${area.path} 콘텐츠 영역`).toBeVisible();
    const text = await content.innerText();
    const matches = area.terms.flatMap((pattern) => {
      const regex = new RegExp(pattern, 'giu');
      return [...text.matchAll(regex)].map((match) => `${pattern} → ${match[0]}`);
    });
    expect(matches, `${area.path} 금지어: ${matches.join(', ')}`).toEqual([]);
    await context.close();
  }
});

test('5종 읽기 응답 fixture에서 0·false·null·누락·빈 배열을 구분한다', async ({ page }) => {
  await installApiFixtures(page, 'host');
  await page.goto('http://127.0.0.1:5441/');
  const detail = await page.evaluate(async () => (await fetch('/api/v1/classes/class-1')).json()) as { capacity: number; record_audio: boolean; location_address: string | null };
  expect(detail.capacity).toBe(0);
  expect(detail.record_audio).toBe(false);
  expect(detail.location_address).toBeNull();
  const emptyPage = await page.context().newPage();
  await installApiFixtures(emptyPage, 'member', 'empty');
  await emptyPage.goto('http://127.0.0.1:5441/');
  const list = await emptyPage.evaluate(async () => (await fetch('/api/v1/classes')).json());
  expect(list).toEqual({ classes: [], total: 0 });
  await emptyPage.close();
});
