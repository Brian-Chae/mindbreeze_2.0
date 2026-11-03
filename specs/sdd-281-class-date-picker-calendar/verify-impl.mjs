// SDD-281 — 실제 /classes/new 2단계 측정. 실행(frontend 에서 vite --port 5291 기동 후):
//   cp ../specs/sdd-281-class-date-picker-calendar/verify-impl.mjs ./.verify-impl.tmp.mjs && node .verify-impl.tmp.mjs
// vite dev + API 는 page.route 합성 목(실제 서버·prod 접속 없음).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const here = resolve(process.cwd(), '../specs/sdd-281-class-date-picker-calendar');
const ORIGIN = 'http://127.0.0.1:5291';
const shots = resolve(here, 'shots-impl'); mkdirSync(shots, { recursive: true });
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const target = plus(today, 21);
let previews = [];
async function setup(page) {
  await page.addInitScript(u => localStorage.setItem('mb_user', JSON.stringify(u)), { id: 'u1', name: '지도사', email: 'c@test.com', role: 'counselor' });
  await page.route(/\/auth\/refresh/, r => json(r, { access_token: 'tok' }));
  await page.route(/\/classes\/instructor-candidates/, r => json(r, { instructors: [{ id: 'u1', name: '지도사' }] }));
  await page.route(/\/classes\/member-candidates/, r => json(r, { members: [], has_more: false }));
  await page.route(/\/classes\/preview-schedule/, r => { const body = r.request().postData() || ''; previews.push(body); const sd = (body.match(/"start_date":"([^"]*)"/) || [])[1] || '2026-12-21'; json(r, { rows: [{ client_key: `regular:${sd}`, seq: 1, scheduled_at: `${sd}T00:00:00Z`, host_id: 'u1', duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' }); });
  await page.route(/\/api\/v1\/.*/, r => (r.request().url().match(/auth\/refresh|instructor-candidates|member-candidates|preview-schedule/) ? r.fallback() : json(r, {})));
}
async function toStep2(page) {
  await page.goto(`${ORIGIN}/classes/new`);
  await page.getByText('처음부터 만들어요').click();
  await page.fill('[name="title"]', '마음 명상');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.waitForSelector('.w-sched'); await page.waitForTimeout(300);
}
const layout = page => page.evaluate(() => {
  const groups = [...document.querySelectorAll('.w-sched > .w-group')].slice(0, 3);
  const info = groups.map(g => { const l = g.querySelector('.fl-label').getBoundingClientRect(); const c = g.lastElementChild.getBoundingClientRect(); return { label: g.querySelector('.fl-label').textContent, w: Math.round(c.width), x: Math.round(c.x), y: Math.round(c.y), labelY: Math.round(l.y), ctlH: Math.round(c.height) }; });
  return { info, hScroll: document.documentElement.scrollWidth > innerWidth, oldStepper: !!document.querySelector('button[aria-label="시작 날짜 이전"], button[aria-label="시작 날짜 다음"]'), nativeDate: !!document.querySelector('.w-sched input[type="date"]'), dateBtn: !!document.querySelector('.cw-datebtn') };
});
const panelBox = page => page.evaluate(() => {
  const p = document.querySelector('.cw-date-sheet, .cw-date-pop'); const r = p.getBoundingClientRect();
  const cells = [...p.querySelectorAll('.cw-datecell[data-date]')].map(e => e.getBoundingClientRect());
  const card = document.querySelector('.w-card')?.getBoundingClientRect();
  const last = [...p.querySelectorAll('.cw-datefoot button')].pop()?.getBoundingClientRect();
  return { kind: p.className.includes('sheet') ? 'sheet' : 'pop', inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight + 0.5, w: Math.round(r.width), h: Math.round(r.height), bottomGap: Math.round(innerHeight - r.bottom), minCellH: Math.round(Math.min(...cells.map(c => c.height))), minCellW: +Math.min(...cells.map(c => c.width)).toFixed(1), rows: p.querySelectorAll('.cw-daterow').length, cellsInside: cells.every(c => c.bottom <= r.bottom + 0.5 && c.top >= r.top - 0.5), footInside: last ? last.bottom <= r.bottom + 0.5 : null, innerScroll: p.scrollHeight > p.clientHeight + 1, sheetMax: Math.round(innerHeight * 0.85), hScroll: document.documentElement.scrollWidth > innerWidth, cardRight: card ? Math.round(card.right) : null, popRight: Math.round(r.right) };
});
const out = { today, target, viewports: [] };
const browser = await chromium.launch();
for (const [w, h] of [[1440, 900], [1280, 720], [1024, 768], [390, 844], [360, 740], [390, 600]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage(); await setup(page); await toStep2(page);
  const rec = { w, h, closed: await layout(page) };
  const mobile = w < 768;
  await page.screenshot({ path: `${shots}/${w}x${h}-closed.png` });
  await page.click('.cw-datebtn'); await page.waitForTimeout(350);
  rec.open = await panelBox(page);
  await page.screenshot({ path: `${shots}/${w}x${h}-open.png` });
  const sameMonth = target.slice(0, 7) === today.slice(0, 7);
  if (!sameMonth) await page.click('button[aria-label="다음 달"]');
  await page.click(`[data-date="${target}"]`); await page.waitForTimeout(300);
  rec.pick = { trigger: await page.textContent('.cw-datebtn'), panelClosed: (await page.locator('[role="dialog"]').count()) === 0, taps: sameMonth ? 2 : 3 };
  if (!mobile) {
    previews = []; await page.getByRole('button', { name: '다음', exact: true }).click(); await page.waitForTimeout(1500);
    const bodies = previews.map(p => (p.match(/"start_date":"[^"]*"/) || ['(none)'])[0]);
    const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const d = new Date(`${target}T12:00:00Z`);
    rec.flow = { previewStartDates: bodies.slice(-3), nextStepMentionsDate: body.includes(`1회차 · ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`), nextStepSample: body.slice(0, 300) };
    await page.screenshot({ path: `${shots}/${w}x${h}-next-step.png` });
    await page.getByRole('button', { name: '이전', exact: true }).click().catch(() => {}); await page.waitForSelector('.w-sched');
  }
  const close = {};
  const isOpen = async () => (await page.locator('[role="dialog"]').count()) > 0;
  const reopen = async () => { if (!(await isOpen())) { await page.click('.cw-datebtn'); await page.waitForTimeout(300); } };
  const before = await page.textContent('.cw-datebtn');
  await reopen(); await page.keyboard.press('Escape'); await page.waitForTimeout(200); close.esc = !(await isOpen());
  await reopen();
  if (mobile) {
    await page.mouse.click(w / 2, 20); await page.waitForTimeout(200); close.scrim = !(await isOpen());
    await reopen(); await page.click('button[aria-label="닫기"]'); await page.waitForTimeout(200); close.closeBtn = !(await isOpen());
    await reopen(); const hb = await page.locator('.cw-date-handle').boundingBox(); await page.mouse.move(hb.x + hb.width / 2, hb.y + 8); await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2, hb.y + 120, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200); close.handleDrag = !(await isOpen());
    await reopen(); const url0 = page.url(); await page.goBack(); await page.waitForTimeout(400); close.back = !(await isOpen()); close.backStayedOnWizard = page.url() === url0 && (await page.locator('.w-sched').count()) > 0;
    await reopen(); await page.click(`[data-date="${target}"]`); await page.waitForTimeout(200); close.pick = !(await isOpen());
  } else {
    await page.mouse.click(5, h - 5); await page.waitForTimeout(200); close.outside = !(await isOpen());
    await reopen();
    const overlap = await page.evaluate(() => { const t = document.querySelector('.cw-datebtn').getBoundingClientRect(); const r = document.querySelector('.cw-date-pop').getBoundingClientRect(); return !(r.bottom <= t.top || r.top >= t.bottom || r.right <= t.left || r.left >= t.right); });
    close.popCoversTrigger = overlap;
    if (!overlap) { await page.click('.cw-datebtn'); await page.waitForTimeout(200); close.triggerToggle = !(await isOpen()); }
    await reopen(); await page.click(`[data-date="${target}"]`); await page.waitForTimeout(200); close.pick = !(await isOpen());
  }
  close.valueKept = (await page.textContent('.cw-datebtn')) === before;
  close.focusBack = await page.evaluate(() => document.activeElement?.classList.contains('cw-datebtn'));
  rec.close = close;
  await reopen();
  let found = false;
  for (let i = 0; i < 14 && !found; i += 1) {
    if (await page.locator('.cw-daterow').count() === 6) { found = true; rec.six = { month: await page.textContent('.cw-datemonth b'), ...(await panelBox(page)) }; await page.screenshot({ path: `${shots}/${w}x${h}-six-weeks.png` }); break; }
    await page.click('button[aria-label="다음 달"]');
  }
  if (!found) rec.six = { error: '6주 달을 못 찾음' };
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  rec.closedAfter = await layout(page);
  out.viewports.push(rec); await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const page = await ctx.newPage(); await setup(page);
  out.copySetup = {};
  try {
    await page.goto(`${ORIGIN}/classes/new?copy=cls1`); await page.waitForTimeout(1500);
    const has = await page.locator('.cw-datebtn').count();
    out.copySetup.hasPicker = has; out.copySetup.noOldStepper = (await page.locator('button[aria-label="새 시작 날짜 이전"]').count()) === 0;
    if (has) { await page.click('.cw-datebtn'); await page.waitForTimeout(300); out.copySetup.open = await panelBox(page); await page.screenshot({ path: `${shots}/copy-setup-open.png` }); }
    else out.copySetup.body = (await page.evaluate(() => document.body.innerText)).slice(0, 200);
  } catch (e) { out.copySetup.error = String(e); }
  await ctx.close();
}
await browser.close();
writeFileSync(`${here}/verify-impl.json`, JSON.stringify(out, null, 2));
console.log('done');
