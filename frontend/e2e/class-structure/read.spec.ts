import { caseManifest } from './cases';
import { expect, installApiFixtures, test, type QaRole } from './fixtures';

const appCases = caseManifest.filter((entry) => entry.classification !== 'X');
const screens = [...new Map(appCases.map((entry) => [entry.screen_id, entry])).values()];

for (const screen of screens) {
  test(`${screen.screen_id} ${screen.role} 경로가 읽기 화면을 제공한다`, async ({ page }) => {
    await installApiFixtures(page, screen.role as QaRole);
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) {
        mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    await page.goto(screen.app_url);
    await expect(page).toHaveURL(new RegExp(`${screen.app_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[?#])`));
    await expect(page.getByRole('heading').first(), '화면 구현이 없거나 제목을 렌더링하지 않아 접근 검증이 실패했습니다.').toBeVisible();
    expect(mutations, '읽기 화면에서 쓰기 요청이 발생했습니다.').toEqual([]);
  });
}

test('타인 ID와 미존재 ID의 404 응답 형식·문구가 동일하다', async ({ page }) => {
  await installApiFixtures(page, 'host', 'not-found');
  const responses = await page.evaluate(async () => Promise.all(['other-user-id', 'missing-id'].map(async (id) => {
    const response = await fetch(`/api/v1/classes/${id}`);
    return { status: response.status, body: await response.text() };
  })));
  expect(responses[0]).toEqual(responses[1]);
  expect(responses[0].status).toBe(404);
});

test('5종 읽기 응답 fixture에서 0·false·null·누락·빈 배열을 구분한다', async ({ page }) => {
  await installApiFixtures(page, 'host');
  await page.goto('http://127.0.0.1:4173/');
  const detail = await page.evaluate(async () => (await fetch('/api/v1/classes/class-1')).json()) as { capacity: number; record_audio: boolean; location_address: string | null };
  expect(detail.capacity).toBe(0);
  expect(detail.record_audio).toBe(false);
  expect(detail.location_address).toBeNull();
  const emptyPage = await page.context().newPage();
  await installApiFixtures(emptyPage, 'member', 'empty');
  await emptyPage.goto('http://127.0.0.1:4173/');
  const list = await emptyPage.evaluate(async () => (await fetch('/api/v1/classes')).json());
  expect(list).toEqual({ classes: [], total: 0 });
  await emptyPage.close();
});
