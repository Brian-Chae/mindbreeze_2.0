// SDD-320 E — 코치 화면 PC/모바일 본문 폭·넘침·44px 미만 조작 요소 측정(읽기 전용)
import { chromium } from 'playwright';
import fs from 'node:fs';
const [role, width, outDir, ...urls] = process.argv.slice(2);
const creds = role === 'coach' ? ['counselor@test.com', 'test1234'] : ['test1@test.com', 'qwer1234'];
const b = await chromium.launch({ channel: 'chrome', headless: true });
const stateFile = `${process.env.HOME}/.hermes/cache/scratch/e/state-${role}.json`;
const c = await b.newContext({ ...(fs.existsSync(stateFile) ? { storageState: stateFile } : {}), viewport: { width: +width, height: +width >= 1024 ? 900 : 844 }, deviceScaleFactor: +width >= 1024 ? 1 : 2 });
const p = await c.newPage();
await p.goto('http://127.0.0.1:5181/dashboard'); await p.waitForTimeout(2500);
if (/login/.test(p.url())) {
  for (let i = 0; i < 3 && /login/.test(p.url()); i++) {
    await p.goto(`http://127.0.0.1:5181/login${role === 'coach' ? '' : '?role=client'}`); await p.waitForTimeout(1800);
    if (role === 'coach') await p.locator('button', { hasText: /^코치$/ }).first().click();
    await p.fill('input[type=email]', creds[0]); await p.fill('input[type=password]', creds[1]);
    await p.locator('input[type=password]').press('Enter'); await p.waitForTimeout(5000);
  }
}
if (!/login/.test(p.url())) await c.storageState({ path: stateFile });
else { console.log('LOGIN_FAILED'); process.exit(2); }
for (const u of urls) {
  await p.goto(`http://127.0.0.1:5181${u}`); await p.waitForTimeout(4000);
  const m = await p.evaluate(() => {
    const sc = document.querySelector('.mobile-menu-swipe-page') || document.querySelector('[data-mobile-swipe-page]');
    const kids = sc ? [...sc.querySelectorAll(':scope > *, :scope > * > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0) : [];
    const widest = kids.reduce((a, r) => Math.max(a, r.width), 0);
    const small = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select')].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.height < 44 || r.width < 44) && r.y < innerHeight * 3; }).length;
    return { h1: document.querySelector('h1')?.textContent?.slice(0, 16), h1px: document.querySelector('h1') && getComputedStyle(document.querySelector('h1')).fontSize, widest: Math.round(widest), ovf: document.documentElement.scrollWidth - innerWidth, smallList: [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && r.y < innerHeight * 3; }).slice(0, 4).map((e) => e.outerHTML.slice(0, 170).replace(/\s+/g,' ') + ' ::' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 12) || e.className.toString().slice(0, 30)) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)), small, scroll: sc ? Math.round(sc.getBoundingClientRect().width) : null, cls: document.documentElement.className.includes('u2-coach') };
  });
  console.log(u, JSON.stringify(m));
  const name = u.replace(/[\/?=&]/g, '_');
  await p.screenshot({ path: `${outDir}/${role}${name}-${width}.png`, fullPage: false });
}
await b.close();
