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
      await page.waitForTimeout(350); // 시트 진입 애니메이션이 끝난 화면을 보존한다.
      await page.screenshot({ path: path.join(__dirname, 'screens', `${state}-${width}.png`) });
      const metrics = await page.evaluate(() => {
        const bar = [...document.querySelectorAll('.hp-signalbar')].find(element => element.getBoundingClientRect().height > 0);
        const buttons = [...(bar?.querySelectorAll('button') ?? [])];
        const scroll = document.querySelector('[data-pz="gridscroll"]');
        if (scroll) scroll.scrollTop = scroll.scrollHeight;
        const lastTile = [...document.querySelectorAll('[data-pz="tile"]')].at(-1)?.getBoundingClientRect();
        const footer = document.querySelector('.pz-shell__dock')?.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth, dock: document.querySelectorAll('[data-pz="dk"]').length, dialogs: document.querySelectorAll('[role="dialog"]').length,
          signalButtons: buttons.length, minTouchHeight: Math.min(...buttons.map(button => button.getBoundingClientRect().height)), minPrimaryFont: Math.min(...buttons.map(button => parseFloat(getComputedStyle(button.querySelector('b')).fontSize))), minSecondaryFont: Math.min(...buttons.map(button => parseFloat(getComputedStyle(button.querySelector('small')).fontSize))),
          tileCovered: !!lastTile && !!footer && lastTile.bottom > footer.top + 1,
          blur: [...document.querySelectorAll('.pz-root *')].some(element => { const style = getComputedStyle(element); return style.backdropFilter !== 'none' || style.filter.includes('blur('); }),
          anonymousDialog: !document.querySelector('.hp-signals-sheet')?.textContent.includes('샘플 회원'),
        };
      });
      results.push({width,state,...metrics,errors:[...errors]});
    }
    await page.goto('http://127.0.0.1:5235/design/class-player?role=host&case=C13&n=6&signalsDemo=hand');
    await page.waitForFunction(() => window.__ready === true);
    const handEntry = page.locator('.hp-signalbar:visible [data-signal="hands"]');
    await handEntry.click();
    await page.getByRole('button', { name: '샘플 회원 A 손 내리기' }).click();
    if (!(await handEntry.innerText()).includes('손들기 0')) throw new Error('손 내리기 후 건수 불일치');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.matches('.hp-signalbar [data-signal="hands"]') && !document.querySelector('[role="dialog"]'));
    await page.goto('http://127.0.0.1:5235/design/class-player?role=host&case=C13&n=6&signalsDemo=toast');
    await page.waitForFunction(() => window.__ready === true);
    await page.getByRole('button', { name: /조용한 신호 4건/ }).click();
    await page.getByRole('dialog', { name: '조용한 신호' }).waitFor();
    if ((await page.getByRole('dialog').innerText()).includes('샘플 회원')) throw new Error('익명성 위반');
    await page.close();
  }
  fs.writeFileSync(path.join(__dirname, 'screens', 'validation.json'), JSON.stringify(results, null, 2)+'\n');
  await browser.close();
  console.log(JSON.stringify(results));
})();
