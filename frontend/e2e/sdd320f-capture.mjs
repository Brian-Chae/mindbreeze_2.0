// SDD-320 F — 미리보기(5181) 읽기 전용 캡처·측정. 로그인 1회 후 storageState 재사용. 저장·생성·승인 버튼은 누르지 않고 비-GET API 는 차단한다.
// 사용: node e2e/sdd320f-capture.mjs <coach|client> <width> <outDir> <path...>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [role, width, outDir, ...paths] = process.argv.slice(2);
const creds = role === 'coach' ? ['counselor@test.com', 'test1234'] : ['test1@test.com', 'qwer1234'];
const BASE = process.env.PREVIEW_BASE || 'http://127.0.0.1:5181';
fs.mkdirSync(outDir, { recursive: true });
const statePath = path.join(outDir, `.state-${role}.json`);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mk = (storageState) => browser.newContext({ viewport: { width: +width, height: +width >= 1024 ? 900 : 844 }, serviceWorkers: 'block', storageState });
async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}/${role === 'coach' ? 'login' : 'login?role=client'}`);
  await p.waitForTimeout(1500);
  if (role === 'coach') { await p.locator('button', { hasText: /^코치$/ }).first().click(); await p.waitForTimeout(500); }
  await p.fill('input[type=email]', creds[0]);
  await p.fill('input[type=password]', creds[1]);
  await p.locator('input[type=password]').press('Enter');
  await p.waitForTimeout(3500);
  await ctx.storageState({ path: statePath });
  await p.close();
}
// 저장된 세션이 있으면 재사용하되, 만료·미복원(로그인 화면으로 이동)이면 다시 로그인한다.
let ctx = await mk(fs.existsSync(statePath) ? statePath : undefined);
{
  const probe = await ctx.newPage();
  await probe.goto(`${BASE}/${role === 'coach' ? 'dashboard' : 'app'}`);
  await probe.waitForTimeout(2500);
  const needLogin = /\/login/.test(new URL(probe.url()).pathname);
  await probe.close();
  if (needLogin) { await ctx.close(); ctx = await mk(); await login(ctx); }
}
const page = await ctx.newPage();
await page.route('**/*', (route) => {
  const m = route.request().method(); const u = route.request().url();
  if (/\/api\//.test(u) && !['GET', 'HEAD', 'OPTIONS'].includes(m) && !/auth\/(login|refresh)/.test(u)) return route.abort('blockedbyclient');
  return route.continue();
});
for (const p of paths) {
  await page.goto(`${BASE}${p}`);
  await page.waitForTimeout(2800);
  const name = p.replace(/[\/?=&]/g, '_') || 'root';
  const data = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const small = [...document.querySelectorAll('a,button,input:not([type=hidden]),select,textarea,[role=tab]')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { t: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.h < 44 || x.w < 44);
    return {
      url: location.pathname, h1: document.querySelector('h1')?.textContent, h1px: getComputedStyle(document.querySelector('h1') || document.body).fontSize,
      overflowX: document.documentElement.scrollWidth - innerWidth, small: small.slice(0, 12), smallCount: small.length,
      forbidden: /점수|종합점수|좋음|나쁨|보증/.test(document.body.innerText),
    };
  });
  await page.screenshot({ path: path.join(outDir, `${name}-${width}.png`), fullPage: false });
  console.log(JSON.stringify(data));
}
await browser.close();
