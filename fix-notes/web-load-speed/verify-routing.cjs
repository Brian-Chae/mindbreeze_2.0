// 실서비스 없이 production 번들의 커밋 대기와 인증 게이트를 독립 검증한다.
const { chromium } = require('../../frontend/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = [];
  for (const [variant, port] of [['before', 4178], ['after', 4180]]) {
    for (const authenticated of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.routeWebSocket('**/socket.io/**', socket => socket.close());
      await context.addInitScript(() => localStorage.setItem('mb_user', JSON.stringify({ id: 'synthetic', role: 'counselor', name: '합성', onboarding_completed: true })));
      const requests = [];
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.includes('/api/v1/')) {
          requests.push(url.pathname);
          if (url.pathname.endsWith('/auth/refresh')) {
            await new Promise(resolve => setTimeout(resolve, 50));
            return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { access_token: 'synthetic-token' } : {} });
          }
          return route.fulfill({ json: { classes: [], notifications: [], instructors: [], rooms: [], reports: [], total: 0, unread: 0 } });
        }
        if (url.hostname === 'dev.mindbreeze.looxidlabs.com') {
          if (url.pathname.includes('host-classes-page-')) await new Promise(resolve => setTimeout(resolve, 60));
          const response = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`);
          return route.fulfill({ status: response.status, contentType: response.headers.get('content-type') || 'text/plain', body: Buffer.from(await response.arrayBuffer()) });
        }
        return route.fulfill({ contentType: url.pathname.endsWith('.css') || url.hostname.includes('fonts') ? 'text/css' : 'application/javascript', body: '' });
      });
      const page = await context.newPage();
      await page.goto('https://dev.mindbreeze.looxidlabs.com/classes');
      await page.waitForTimeout(700);
      const metrics = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        const refresh = resources.find(e => e.name.endsWith('/auth/refresh'));
        const chunks = resources.filter(e => e.name.includes('/assets/host-classes-page-'));
        const api = resources.filter(e => new URL(e.name).pathname === '/api/v1/classes');
        return { refreshEnd: Math.round(refresh?.responseEnd || 0), chunksEnd: Math.round(Math.max(...chunks.map(e => e.responseEnd))), firstApi: api.length ? Math.round(Math.min(...api.map(e => e.startTime))) : null };
      });
      if (authenticated) { assert.ok(await page.getByText('아직 클래스가 없어요', { exact: true }).count()); assert.ok(requests.includes('/api/v1/classes')); }
      else { assert.equal(requests.filter(path => !path.endsWith('/auth/refresh')).length, 0); assert.ok(page.url().includes('/login')); }
      results.push({ variant, authenticated, ...metrics, gapMs: metrics.firstApi === null ? null : metrics.firstApi - Math.max(metrics.refreshEnd, metrics.chunksEnd) });
      await context.close();
    }
  }
  const before = results.find(row => row.variant === 'before' && row.authenticated);
  const after = results.find(row => row.variant === 'after' && row.authenticated);
  assert.ok(before.gapMs > 150, JSON.stringify(before));
  assert.ok(after.gapMs < 100, JSON.stringify(after));
  fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  await browser.close();
})().catch(error => { console.error(error.message); process.exit(1); });
