// 자체완결 HTML 시안만 검증한다. 제품 서버·API·환경변수를 사용하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const candidates = [path.resolve(__dirname, '../../frontend/node_modules/playwright'), '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright'];
const playwrightPath = candidates.find(p => fs.existsSync(p));
if (!playwrightPath) throw new Error('기존 Playwright 설치 경로가 필요합니다. 제품 의존성은 변경하지 않습니다.');
const { chromium } = require(playwrightPath);
const out = path.join(__dirname, 'captures');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = { captured: [], checks: [], errors: [], externalRequests: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => results.errors.push(e.message));
    await page.route('**/*', route => {
      if (route.request().url().startsWith('file:')) return route.continue();
      results.externalRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href);
    await page.evaluate(() => document.fonts.ready);
    for (const role of ['client', 'counselor', 'org_admin', 'platform_admin']) {
      await page.selectOption('#role', role);
      for (const view of ['before', 'after']) {
        await page.click(`.views button[data-view="${view}"]`);
        const name = `${role}-${view}-390.png`;
        await page.screenshot({ path: path.join(out, name), fullPage: true });
        results.captured.push(name);
        const metrics = await page.evaluate(() => {
          const visible = el => el.getClientRects().length > 0;
          const overflow = [...document.querySelectorAll('body *')].filter(visible).filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
          }).map(el => ({ tag: el.tagName, className: el.className }));
          const smallTargets = [...document.querySelectorAll('button, summary, select')].filter(visible).filter(el => el.getBoundingClientRect().height < 44).map(el => el.textContent.trim());
          return { pageOverflow: document.documentElement.scrollWidth > innerWidth, overflow, smallTargets };
        });
        results.checks.push({ role, view, ...metrics });
      }
      const summaryCount = await page.locator('#after details').count();
      if (summaryCount !== 5) throw new Error(`${role}: 5그룹 불일치`);
      for (const group of await page.locator('#after summary').all()) {
        await group.click();
        await group.click();
      }
      await page.click('#after [data-go-playground]');
      if (await page.getAttribute('body', 'data-view') !== 'playground') throw new Error('체험 이동 실패');
      await page.click('[aria-label="설정으로 돌아가기"]');
      if (await page.getAttribute('body', 'data-view') !== 'after') throw new Error('설정 복귀 실패');
      results.checks.push({ role, navigationRoundTrip: true, groupCount: summaryCount });
    }
    await page.selectOption('#role', 'counselor');
    for (const view of ['nav', 'playground']) {
      await page.click(`.views button[data-view="${view}"]`);
      const name = `${view}-390.png`;
      await page.screenshot({ path: path.join(out, name), fullPage: true });
      results.captured.push(name);
    }
    await page.click('.views button[data-view="after"]');
    await page.locator('#after details').nth(1).locator('summary').click();
    const groupStates = await page.locator('#after .sw-row').evaluateAll(els => els.map(el => ({ label: el.querySelector('.lbl').textContent.trim(), value: el.querySelector('.sw').classList.contains('partial') ? '일부 켜짐' : el.querySelector('input').checked ? '켜짐' : '꺼짐' })));
    const expected = ['일부 켜짐', '켜짐', '꺼짐', '켜짐', '일부 켜짐', '켜짐'];
    if (groupStates.length !== 6 || groupStates.some((s, i) => s.value !== expected[i])) throw new Error('알림 그룹 초기값 불일치');
    results.checks.push({ groupStates });
    await page.screenshot({ path: path.join(out, 'notifications-expanded-390.png'), fullPage: true });
    results.captured.push('notifications-expanded-390.png');
    await page.locator('#after details').nth(1).locator('summary').click();
    await page.locator('#after details').nth(3).locator('summary').click();
    await page.screenshot({ path: path.join(out, 'privacy-expanded-390.png'), fullPage: true });
    results.captured.push('privacy-expanded-390.png');
    await page.getByRole('button', { name: '개인정보 동의 · 연구 동의 철회', exact: false }).click();
    await page.screenshot({ path: path.join(out, 'consents-dialog-390.png'), fullPage: false });
    results.captured.push('consents-dialog-390.png');
    await page.locator('.dialog-close').click();
    await page.locator('#after details').nth(3).locator('summary').click();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.click('.views button[data-view="all"]');
    await page.screenshot({ path: path.join(out, 'comparison-1440.png'), fullPage: true });
    results.captured.push('comparison-1440.png');
    const desktop = await page.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth > innerWidth, panels: [...document.querySelectorAll('.column')].map(el => el.getBoundingClientRect().width) }));
    results.checks.push({ viewport: 1440, ...desktop });
    await page.locator('#after [aria-label="전체 메뉴"]').click();
    if (!await page.locator('dialog').isVisible()) throw new Error('전체 메뉴 열기 실패');
    await page.locator('.dialog-close').click();
    results.checks.push({ wholeMenuDialog: true });
    const events = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-data.json'), 'utf8'));
    if (events.length !== 47 || new Set(events.map(e => e.key)).size !== 47) throw new Error('알림 47종 매핑 불일치');
    results.checks.push({ eventCount: events.length, channelControlCount: events.length * 2, emailDefaultOn: events.filter(e => e.email).length, proposedGroups: [...new Set(events.map(e => e.group))] });
    fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify(results, null, 2) + '\n');
    if (results.errors.length || results.externalRequests.length || results.checks.some(c => c.pageOverflow || c.overflow?.length || c.smallTargets?.length)) throw new Error('캡처/레이아웃 검증 결과 확인 필요');
    console.log(JSON.stringify({ captured: results.captured.length, checks: results.checks.length, errors: results.errors, externalRequests: results.externalRequests }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
