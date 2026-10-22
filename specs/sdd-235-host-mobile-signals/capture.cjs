// 실제 HostLiveView 케이스 하니스만 사용. 원격·API 요청은 차단한다.
const { chromium } = require('../../frontend/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const results = [];
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return route.abort();
      return route.continue();
    });
    for (const state of ['none', 'hand', 'signals', 'toast', 'hands-sheet', 'quiet-sheet']) {
      const demo = state === 'hands-sheet' ? 'hand' : state === 'quiet-sheet' ? 'quiet' : state;
      const sheet = state === 'hands-sheet' ? '&sheet=hands' : state === 'quiet-sheet' ? '&sheet=signals' : '';
      await page.goto(`http://127.0.0.1:5235/design/class-player?role=host&case=C13&n=6&signalsDemo=${demo}${sheet}`);
      await page.waitForFunction(() => window.__ready === true);
      await page.screenshot({ path: path.join(__dirname, 'screens', `${state}-${width}.png`) });
      const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, dock: document.querySelectorAll('[data-pz="dk"]').length, dialogs: document.querySelectorAll('[role="dialog"]').length }));
      results.push({width,state,...metrics,errors:[...errors]});
    }
    await page.close();
  }
  fs.writeFileSync(path.join(__dirname, 'screens', 'validation.json'), JSON.stringify(results, null, 2)+'\n');
  await browser.close();
  console.log(JSON.stringify(results));
})();
