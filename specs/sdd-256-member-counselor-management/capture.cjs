// 합성 API + 빌드 산출물(vite preview) 헤드리스 캡처. 실서버·실데이터 미사용.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(path.resolve(__dirname, '../../frontend/node_modules/playwright'));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const out = path.join(__dirname, 'screens');
const A = { id: 'a', name: '김가온', profile_image: null, org_name: '마음쉼 센터(예시)', status: 'active' };
const B = { id: 'b', name: '이나래', profile_image: null, org_name: null, status: 'active' };
const user = (counselors) => ({ id: 'syn-client', email: 'client@example.test', name: '샘플 회원', role: 'client', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors });
(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = [];
  for (const [w, h] of [[390, 844], [1440, 1000]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    let list = [A];
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript((u) => { localStorage.setItem('mb_user', JSON.stringify(u)); }, user([A]));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url()); const p = url.pathname; const m = route.request().method();
      if (url.origin === BASE || !p.startsWith('/api') && !/\/(auth|client|classes|sessions|reports|chat|notifications|dashboard|devices|users)\b/.test(p)) return route.continue();
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (p.endsWith('/auth/refresh')) return json({ access_token: 'syn', token_type: 'bearer' });
      if (p.endsWith('/auth/me')) return json(user(list));
      if (p.endsWith('/client/counselors')) {
        if (m === 'POST') { const body = JSON.parse(route.request().postData() || '{}'); if (body.code === 'ZZZZZZ') return json({ detail: '유효하지 않은 상담사 코드입니다' }, 404); list = [A, B]; return json(B, 201); }
        return json(list);
      }
      if (p.endsWith('/devices/web-push/public-key')) return json({ public_key: null });
      if (/users\/me\/consents/.test(p)) { const c = { agreed: false, version: null }; return json({ tos: c, privacy: c, sensitive: c, eeg: c, research: c }); }
      if (/chat\/blocks/.test(p)) return json({ blocks: [] });
      if (/chat\/rooms/.test(p)) return json({ rooms: [] });
      if (/notifications\/preferences/.test(p)) return json({ email: {}, in_app: {}, push: {} });
      if (/notifications/.test(p)) return json({ notifications: [], total: 0, unread: 0 });
      if (/reports/.test(p)) return json({ reports: [], total: 0 });
      if (/sessions/.test(p)) return json({ sessions: [], total: 0 });
      if (/classes/.test(p)) return json({ classes: [], total: 0 });
      return json({});
    });
    const tag = `${w}`;
    await page.goto(BASE + '/app'); await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, `home-${tag}.png`), fullPage: true });
    const addBtn = page.getByRole('button', { name: /상담사 추가/ }).first();
    const homeBtn = await addBtn.count();
    await addBtn.click(); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `home-sheet-${tag}.png`) });
    const input = page.locator('[role=dialog] input');
    await input.fill('ZZZZZZ'); await page.locator('[role=dialog] button[type=submit]').click(); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `home-sheet-error-${tag}.png`) });
    await input.fill('001131'); await page.locator('[role=dialog] button[type=submit]').click(); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `home-sheet-success-${tag}.png`) });
    const added = await page.locator('[role=dialog]').innerText();
    await page.locator('[role=dialog]').getByRole('button', { name: '완료' }).click(); await page.waitForTimeout(300);
    const homeHasB = (await page.locator('body').innerText()).includes('이나래');
    list = [A, B];
    await page.goto(BASE + '/app/profile'); await page.waitForTimeout(2000);
    await page.locator('summary', { hasText: '상담사 관리' }).click(); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `settings-${tag}.png`), fullPage: true });
    const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, minBtn: Math.min(...[...document.querySelectorAll('details[open] button')].map((b) => b.getBoundingClientRect().height)) }));
    results.push({ width: w, homeAddButtons: homeBtn, successText: added.replace(/\s+/g, ' ').slice(0, 80), homeShowsNewAfterAdd: homeHasB, ...metrics, errors });
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, 'qa.json'), JSON.stringify({ kind: 'synthetic-api-headless', results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
