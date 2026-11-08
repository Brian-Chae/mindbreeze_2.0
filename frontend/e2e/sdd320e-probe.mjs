// SDD-320 E — 미리보기 서버(5181) 읽기 전용 측정. 로그인 후 화면별 computed style/캡처. 저장·생성·삭제 동작은 누르지 않는다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [role, width, outDir, ...paths] = process.argv.slice(2);
const creds = role === 'coach' ? ['counselor@test.com', 'test1234'] : ['test1@test.com', 'qwer1234'];
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: +width, height: +width >= 1024 ? 900 : 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.route('**/*', (route) => {
  const m = route.request().method();
  const u = route.request().url();
  if (/\/api\//.test(u) && !['GET', 'HEAD', 'OPTIONS'].includes(m) && !/auth\/(login|refresh)/.test(u)) return route.abort('blockedbyclient');
  return route.continue();
});
await page.goto(`http://127.0.0.1:5181/${role === 'coach' ? 'login' : 'login?role=client'}`);
await page.waitForTimeout(1500);
if (role === 'coach') { await page.locator('button', { hasText: /^코치$/ }).first().click(); await page.waitForTimeout(500); }
await page.fill('input[type=email]', creds[0]);
await page.fill('input[type=password]', creds[1]);
await page.locator('input[type=password]').press('Enter');
await page.waitForTimeout(3500);
for (const p of paths) {
  await page.goto(`http://127.0.0.1:5181${p}`);
  await page.waitForTimeout(2500);
  const name = p.replace(/[\/?=&]/g, '_') || 'root';
  const data = await page.evaluate(() => {
    const cs = (el) => { if (!el) return null; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { font: s.fontFamily.slice(0, 40), size: s.fontSize, weight: s.fontWeight, lh: s.lineHeight, ls: s.letterSpacing, bg: s.backgroundColor, bgi: s.backgroundImage.slice(0, 60), radius: s.borderRadius, pad: s.padding, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) }; };
    return { url: location.pathname, h1: document.querySelector('h1')?.textContent, h1s: cs(document.querySelector('h1')), aside: cs(document.querySelector('aside')), main: cs(document.querySelector('main')), cls: document.documentElement.className, overflowX: document.documentElement.scrollWidth - innerWidth };
  });
  await page.screenshot({ path: path.join(outDir, `${name}-${width}.png`) });
  console.log(JSON.stringify(data));
}
await browser.close();
