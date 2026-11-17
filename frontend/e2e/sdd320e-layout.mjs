// SDD-320 E — 로그인 재시도 + 선택자 좌표 측정(읽기 전용). 사용: node e2e/sdd320e-layout.mjs <coach|client> <width> <path> <selector...>
import { chromium } from 'playwright';
const [role, width, url, ...sels] = process.argv.slice(2);
const creds = role === 'coach' ? ['counselor@test.com', 'test1234'] : ['test1@test.com', 'qwer1234'];
const b = await chromium.launch({ channel: 'chrome', headless: true });
const c = await b.newContext({ viewport: { width: +width, height: +width >= 1024 ? 900 : 844 } });
const p = await c.newPage();
for (let i = 0; i < 3 && !/\/(dashboard|app)/.test(p.url()); i++) {
  await p.goto(`http://127.0.0.1:5181/login${role === 'coach' ? '' : '?role=client'}`); await p.waitForTimeout(1800);
  if (role === 'coach') await p.locator('button', { hasText: /^코치$/ }).first().click();
  await p.fill('input[type=email]', creds[0]); await p.fill('input[type=password]', creds[1]);
  await p.locator('input[type=password]').press('Enter'); await p.waitForTimeout(4500);
}
await p.goto(`http://127.0.0.1:5181${url}`); await p.waitForTimeout(4500);
console.log(p.url());
console.log(await p.evaluate(() => { const el = document.querySelector('.ch-home'); if (!el) return 'no ch-home'; const out = [];
  const walk = (rules) => { for (const r of rules) { if (r.cssRules && r.media) { if (matchMedia(r.media.mediaText).matches) walk(r.cssRules); continue; }
    if (r.selectorText && r.style && r.style.display) { try { if (el.matches(r.selectorText)) out.push(r.selectorText + ' => ' + r.style.display); } catch {} } } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  return out.join('\n'); }));
console.log(await p.evaluate((ss) => ss.map((s) => { const e = document.querySelector(s); if (!e) return `${s} none`; const r = e.getBoundingClientRect(); return `${s} ${Math.round(r.x)},${Math.round(r.y + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)} ${getComputedStyle(e).display}`; }).join('\n'), sels));
await p.screenshot({ path: `${process.env.HOME}/.hermes/cache/scratch/e/layout-${role}-${width}.png`, fullPage: true });
await b.close();
