// SDD-279 T6 — 실제 컴포넌트 레이아웃 측정. 사용: node measure-impl.cjs (vite dev 가 5279 에서 떠 있어야 함)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../frontend/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const URL = process.env.URL || 'http://localhost:5279/design/class-flow?screen=FH02c&case=later';
const OUT = path.join(__dirname, 'shots-impl'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = []; const failures = [];
  for (const [w, h] of [[1440, 900], [1280, 900], [1024, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__ready === true); await page.waitForSelector('.fh-when3');
    const m = await page.evaluate(() => {
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const groups = [...document.querySelectorAll('.fh-when3 > .fh-group')];
      const labels = groups.map((g) => rect(g.querySelector('.fl-label')));
      const controls = groups.map((g) => rect(g.querySelector('.fh-stepper, .fh-timebtn, .fh-timesel')));
      const targets = [...document.querySelectorAll('.fh-when3 button, .fh-when3 select')].filter((e) => e.getBoundingClientRect().width).map((e) => ({ name: e.getAttribute('aria-label') || e.textContent.trim(), ...rect(e) }));
      const trig = document.querySelector('.fh-timebtn');
      return {
        labelTexts: groups.map((g) => g.querySelector('.fl-label').textContent),
        columnWidths: groups.map((g) => rect(g).width),
        labelYDelta: Math.max(...labels.map((r) => r.y)) - Math.min(...labels.map((r) => r.y)),
        controlHeights: controls.map((r) => r.height),
        controlHeightDelta: Math.max(...controls.map((r) => r.height)) - Math.min(...controls.map((r) => r.height)),
        overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        smallTargets: targets.filter((t) => t.width < 43.99 || t.height < 43.99),
        clipped: [...document.querySelectorAll('.fh-when3 .fh-stepper b, .fh-when3 .fh-timebtn span')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent),
        triggerFontPx: trig ? parseFloat(getComputedStyle(trig).fontSize) : null,
        mode: trig ? 'popover' : 'select',
      };
    });
    m.viewport = { w, h }; m.errors = errors;
    if (m.mode === 'popover') {
      await page.screenshot({ path: path.join(OUT, `closed-${w}.png`) });
      await page.click('.fh-timebtn');
      await page.waitForSelector('.fh-timepop');
      m.popover = await page.evaluate(() => {
        const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, right: r.right, bottom: r.bottom }; };
        const t = rect(document.querySelector('.fh-timebtn')); const p = rect(document.querySelector('.fh-timepop'));
        const opt = document.querySelector('.fh-timeopt'); const tab = document.querySelector('.fh-timetab[aria-pressed="true"]');
        const selOpt = document.querySelector('.fh-timeopt[aria-selected="true"]');
        const cs = (e) => getComputedStyle(e);
        const targets = [...document.querySelectorAll('.fh-timepop button')].map((e) => rect(e));
        return {
          triggerWidth: t.width, popoverWidth: p.width, widthRatio: p.width / t.width, leftAligned: Math.abs(p.left - t.x),
          withinViewport: p.left >= 0 && p.right <= innerWidth && p.bottom <= document.documentElement.scrollHeight,
          viewportRightGap: innerWidth - p.right,
          optionFontPx: parseFloat(cs(opt).fontSize), tabFontPx: parseFloat(cs(tab).fontSize),
          selectedTab: { bg: cs(tab).backgroundColor, border: cs(tab).borderColor },
          selectedItem: { bg: cs(selOpt).backgroundColor, border: cs(selOpt).borderColor },
          minTargetPx: Math.min(...targets.flatMap((r) => [r.width, r.height])),
          overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        };
      });
      if (w === 1440) await page.screenshot({ path: path.join(OUT, 'open-1440.png') });
      await page.keyboard.press('Escape');
    } else {
      await page.screenshot({ path: path.join(OUT, `closed-${w}.png`) });
    }
    const pop = m.popover;
    m.pass = m.overflowX === 0 && m.controlHeightDelta <= 1 && (w < 768 || m.labelYDelta <= 1) && m.smallTargets.length === 0 && m.clipped.length === 0 && errors.length === 0
      && (!pop || (pop.widthRatio >= 0.9 && pop.widthRatio <= 1.1 && pop.withinViewport && pop.optionFontPx >= m.triggerFontPx && pop.tabFontPx >= m.triggerFontPx && pop.minTargetPx >= 43.99 && pop.overflowX === 0
        && (pop.selectedTab.bg !== pop.selectedItem.bg)));
    if (!m.pass) failures.push(m);
    results.push(m);
    if (w === 390) { await page.screenshot({ path: path.join(OUT, '390.png'), fullPage: true }); }
    await page.close();
  }
  fs.writeFileSync(path.join(__dirname, 'verify-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), url: URL, method: 'Chrome headless + Playwright / vite dev 하니스 / getBoundingClientRect', results, failures }, null, 2));
  console.log(JSON.stringify(results.map((r) => ({ vp: r.viewport, mode: r.mode, cols: r.columnWidths.map(Math.round), labelDy: r.labelYDelta, ctlH: r.controlHeights, ctlDelta: r.controlHeightDelta, small: r.smallTargets.length, ovf: r.overflowX, pop: r.popover && { ratio: +r.popover.widthRatio.toFixed(3), tw: Math.round(r.popover.triggerWidth), pw: Math.round(r.popover.popoverWidth), inVp: r.popover.withinViewport, fonts: [r.triggerFontPx, r.popover.optionFontPx, r.popover.tabFontPx], tab: r.popover.selectedTab, item: r.popover.selectedItem, minT: r.popover.minTargetPx }, pass: r.pass })), null, 1));
  await browser.close(); if (failures.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
