// SDD-279 보정 — 실제 /classes/new 2단계 측정. 실행(frontend 에서 vite --port 5291 기동 후):
//   cp ../specs/sdd-279-class-start-time-picker/verify-fix.mjs ./.verify-fix.tmp.mjs && node .verify-fix.tmp.mjs
// vite dev + API 는 page.route 합성 목(실제 서버·prod 접속 없음).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const here = resolve(process.cwd(), '../specs/sdd-279-class-start-time-picker');
const ORIGIN = 'http://127.0.0.1:5291';
const shots = resolve(here, 'shots-fix'); mkdirSync(shots, { recursive: true });
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const previews = [];
async function setup(page) {
  await page.addInitScript(u => localStorage.setItem('mb_user', JSON.stringify(u)), { id: 'u1', name: '지도사', email: 'c@test.com', role: 'counselor' });
  await page.route(/\/auth\/refresh/, r => json(r, { access_token: 'tok' }));
  await page.route(/\/classes\/instructor-candidates/, r => json(r, { instructors: [{ id: 'u1', name: '지도사' }] }));
  await page.route(/\/classes\/member-candidates/, r => json(r, { members: [], has_more: false }));
  await page.route(/\/classes\/preview-schedule/, r => { previews.push(r.request().postData() || ''); json(r, { rows: [{ client_key: 'regular:2026-12-21', seq: 1, scheduled_at: '2026-12-21T00:00:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' }); });
  await page.route(/\/api\/v1\/.*/, r => (r.request().url().match(/auth\/refresh|instructor-candidates|member-candidates|preview-schedule/) ? r.fallback() : json(r, {})));
}
async function toStep2(page) {
  await page.goto(`${ORIGIN}/classes/new`);
  await page.getByText('처음부터 만들어요').click();
  await page.fill('[name="title"]', '마음 명상');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.waitForSelector('.w-sched');
  await page.waitForTimeout(300);
}
const out = { viewports: [] };
const browser = await chromium.launch();
for (const [w, h] of [[1440, 900], [1280, 720], [1024, 768], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage(); await setup(page); await toStep2(page);
  const m = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.w-sched > .w-group')].slice(0, 3);
    const info = groups.map(g => { const l = g.querySelector('.fl-label').getBoundingClientRect(); const c = g.lastElementChild.getBoundingClientRect(); return { label: g.querySelector('.fl-label').textContent, w: Math.round(c.width), x: Math.round(c.x), y: Math.round(c.y), labelY: Math.round(l.y), ctlH: Math.round(c.height) }; });
    return { info, hScroll: document.documentElement.scrollWidth > innerWidth, oldStepperOnTime: !!document.querySelector('button[aria-label="시작 시각 이전"], button[aria-label="시작 시각 다음"]'), timeBtn: !!document.querySelector('.fh-timebtn'), selects: document.querySelectorAll('.fh-timesel-s').length };
  });
  const rec = { w, h, ...m };
  if (w >= 768) {
    await page.screenshot({ path: `${shots}/${w}-closed.png` });
    await page.click('.fh-timebtn'); await page.waitForTimeout(200);
    rec.pop = await page.evaluate(() => {
      const p = document.querySelector('.fh-timepop').getBoundingClientRect(); const f = document.querySelector('.fh-timebtn').getBoundingClientRect();
      const mins = [...document.querySelectorAll('.fh-timeopt, .fh-timetab')].map(e => e.getBoundingClientRect().height);
      const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
      return { ratio: +(p.width / f.width).toFixed(2), inView: p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight, minTarget: Math.round(Math.min(...mins)), selTab: css('.fh-timetab[aria-pressed="true"]', 'backgroundColor'), unTab: css('.fh-timetab[aria-pressed="false"]', 'backgroundColor'), selOpt: css('.fh-timeopt[aria-selected="true"]', 'backgroundColor'), fontOpt: css('.fh-timeopt', 'fontSize'), fontBtn: css('.fh-timebtn', 'fontSize'), hScroll: document.documentElement.scrollWidth > innerWidth };
    });
    if (w === 1440) {
      await page.screenshot({ path: `${shots}/1440-open.png` });
      const startLabel = await page.textContent('.fh-timebtn');
      let clicks = 0;
      await page.locator('.fh-timetab', { hasText: '오전' }).click(); clicks++;
      await page.locator('[aria-label="시"] [role=option]', { hasText: /^9시$/ }).click(); clicks++;
      await page.locator('[aria-label="분"] [role=option]', { hasText: /^00분$/ }).click(); clicks++;
      const after = await page.textContent('.fh-timebtn');
      await page.getByRole('button', { name: '다음', exact: true }).click();
      await page.waitForTimeout(1500);
      const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      rec.flow = { startLabel, after, clicks, previewBodies: previews.slice(-2).map(s => (s.match(/"time":"[^"]*"/) || [s.slice(0, 120)])[0]), nextStepHas0900: /오전 9:00|09:00/.test(body), nextStepSample: body.slice(0, 500) };
      await page.screenshot({ path: `${shots}/1440-next-step.png` });
    }
  } else {
    await page.screenshot({ path: `${shots}/390-select.png` });
    const sel = page.locator('select[aria-label="시작 시각 시"]');
    const v0 = await sel.inputValue();
    await sel.selectOption('9');
    await page.locator('select[aria-label^="시작 시각 분"]').selectOption('30');
    rec.mobile = { before: v0, afterHour: await sel.inputValue(), minute: await page.locator('select[aria-label^="시작 시각 분"]').inputValue(), label: await page.evaluate(() => document.body.innerText.includes('9')) };
    await page.screenshot({ path: `${shots}/390-select-after.png` });
  }
  out.viewports.push(rec); await ctx.close();
}
await browser.close();
writeFileSync(`${here}/verify-fix.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
