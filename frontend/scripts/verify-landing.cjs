/** SDD-063: 실제 브라우저에서 랜딩 경로·모바일 메뉴·샘플 리포트·지연 로딩 검증. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseUrl = process.env.LANDING_URL || 'http://127.0.0.1:5176';
const output = process.env.LANDING_EVIDENCE || '/tmp/sdd063-evidence';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'chrome' });
  const errors = [];
  const results = [];
  try {
    for (const width of [360, 390, 768, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      const requested = [];
      page.on('request', (request) => requested.push(request.url()));
      await page.goto(baseUrl);
      await page.getByRole('heading', { level: 1, name: '마음을 돌보는 일, 변화가 보이도록.' }).waitFor();
      const initialJs = requested.filter((url) => url.endsWith('.js'));
      assert.ok(!initialJs.some((url) => /ReportSample|NarrativeSections|SessionLive|recharts/.test(url)), '랜딩 최초 진입 시 리포트·측정 화면을 로드하지 않는다');
      const toggle = page.locator('button[aria-controls="landing-navigation"]');
      if (width < 1280) {
        await toggle.click();
        assert.equal(await page.getByRole('button', { name: '메뉴 닫기', exact: true }).getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        assert.ok(await toggle.evaluate((el) => el === document.activeElement));
        await toggle.click();
      }
      const actions = page.getByRole('navigation', { name: '서비스 시작', exact: true });
      assert.equal(await actions.getByRole('link').count(), 3);
      for (const [name, href] of [['클래스 바로 참여', '/join'], ['로그인', '/login'], ['회원가입', '/register']]) {
        assert.equal(await actions.getByRole('link', { name, exact: true }).getAttribute('href'), href);
      }
      const nav = page.getByRole('navigation', { name: '메인 메뉴', exact: true });
      assert.equal(await nav.getByRole('link').count(), 4);
      for (const [label, id] of [['서비스', 'service'], ['LINK BAND', 'link-band'], ['리포트', 'reports'], ['고객센터', 'support']]) {
        if (width < 1280 && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        await nav.getByRole('link', { name: label, exact: true }).click();
        assert.equal(new URL(page.url()).hash, `#${id}`);
        await page.waitForFunction((target) => Math.abs(document.getElementById(target).getBoundingClientRect().top - 96) < 8, id);
        if (width < 1280) assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      }
      const question = page.locator('summary').filter({ hasText: 'LINK BAND가 없어도 사용할 수 있나요?' });
      await question.click();
      assert.ok(await question.evaluate((el) => el.parentElement.open));
      await question.click();
      const trigger = page.getByRole('button', { name: '샘플 리포트 열어보기' });
      await trigger.click();
      await page.getByRole('dialog').waitFor();
      assert.equal(await page.locator('[data-testid="narrative-sections"]').count(), 1);
      assert.ok(await page.getByText('디자인 미리보기 · 예시 데이터', { exact: true }).isVisible());
      if (width > 900) {
        await page.getByRole('dialog').getByRole('link', { name: /몸의 변화/ }).click();
        assert.ok(await page.locator('#body').evaluate((el) => el === document.activeElement));
      } else {
        await page.locator('#body').scrollIntoViewIfNeeded();
      }
      assert.ok(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth));
      await page.screenshot({ path: path.join(output, `loop5-report-${width}.png`) });
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.ok(await trigger.evaluate((el) => el === document.activeElement));
      await trigger.click();
      await page.getByRole('dialog').getByRole('button', { name: '샘플 리포트 닫기' }).click();
      assert.ok(await trigger.evaluate((el) => el === document.activeElement));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '가로 넘침 없음');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `loop5-${width}.png`), fullPage: true });
      for (const [label, route] of [['클래스 바로 참여', '/join'], ['로그인', '/login'], ['회원가입', '/register']]) {
        await page.goto(baseUrl);
        if (width < 1280) await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
        await page.getByRole('navigation', { name: '서비스 시작', exact: true }).getByRole('link', { name: label, exact: true }).click();
        await page.waitForURL(`**${route}`);
        await page.getByRole('heading', { level: 1 }).first().waitFor();
      }
      results.push({ width, result: 'PASS', initialJs });
      await page.close();
    }
    // 분리된 리포트 청크를 못 받아도 랜딩을 계속 사용할 수 있어야 한다.
    const offlinePage = await browser.newPage();
    offlinePage.setDefaultTimeout(10000);
    await offlinePage.route(/ReportSamplePage-.*\.js$/, (route) => route.abort());
    await offlinePage.goto(baseUrl);
    await offlinePage.getByRole('button', { name: '샘플 리포트 열어보기' }).click();
    await offlinePage.getByRole('alert').waitFor();
    await offlinePage.getByRole('alert').getByRole('button', { name: '닫기' }).click();
    assert.ok(await offlinePage.getByRole('heading', { level: 1 }).isVisible());
    await offlinePage.close();
    assert.deepEqual(errors, [], '브라우저 런타임 오류 없음');
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ passed: results.length, viewports: results.map((r) => r.width), errors }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
