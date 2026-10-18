import { caseManifest, viewports } from './cases';
import { expect, installApiFixtures, test } from './fixtures';

const comparable = caseManifest.filter((entry) => entry.classification !== 'X' && entry.viewport);

for (const viewport of viewports) {
  test.describe(`${viewport.name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const entry of comparable.filter((item) => item.viewport?.name === viewport.name)) {
      test(`${entry.screen_id}/${entry.case_id} 원본과 앱 증거를 저장한다`, async ({ page }) => {
        await installApiFixtures(page, entry.role);
        const outputBase = `e2e/class-structure/out/${entry.screen_id}-${entry.case_id}-${viewport.name}`;
        await page.goto(entry.prototype_url);
        await expect(page.locator('body')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${outputBase}-reference.png`, fullPage: true });

        await page.goto(entry.app_url);
        await expect(page).toHaveURL(new RegExp(`${new URL(entry.app_url).pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[?#])`));
        await expect(page.getByRole('heading').first(), '앱 경로·화면 미구현은 통과 처리하지 않습니다.').toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const dimensions = await page.evaluate(() => ({
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          dpr: window.devicePixelRatio,
        }));
        expect(dimensions.dpr).toBe(1);
        expect(dimensions.documentWidth, '페이지 가로 넘침').toBeLessThanOrEqual(dimensions.viewportWidth);
        expect(dimensions.documentHeight, '셸 바깥 세로 넘침').toBeLessThanOrEqual(dimensions.viewportHeight);
        await page.screenshot({ path: `${outputBase}-actual.png`, fullPage: true });
      });
    }
  });
}
