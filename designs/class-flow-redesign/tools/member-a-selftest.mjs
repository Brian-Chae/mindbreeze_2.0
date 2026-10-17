// 대칭 측정기가 실제로 위반을 잡는지 확인하는 자가 검증 — 일부러 어긋나게 만든 DOM 에서 위반이 나와야 한다.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { symMeasure } from './member-a-lib.mjs';
const D = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.resolve(D, '../../frontend/package.json'))('playwright');
const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
const BASE = 'http://localhost:5301/class-flow-redesign/member-a.html';
const cases = [
  ['FM05', 'member', 834, 1194, () => { document.querySelector('.fl-body > .fl-col').style.transform = 'translateX(10px)'; document.querySelector('.fl-top-l').style.marginLeft = '8px'; }],
  ['FM01', 'open', 390, 844, () => { document.querySelector('.w-col').style.marginLeft = '0'; document.querySelector('.w-col').style.maxWidth = '300px'; document.querySelector('.sh-tabbar > a').style.flex = '2'; document.querySelector('.w-hc').style.gap = '13px'; }],
  ['FM02', 'apply', 834, 1194, () => { const s = document.querySelector('.w-sheet'); s.style.marginLeft = '40px'; s.style.width = '700px'; }],
  ['FM10', 'notyet', 390, 844, () => { const c = document.querySelector('.w-tc'); c.style.marginLeft = '40px'; document.querySelector('.fl-body').style.paddingBottom = '200px'; }],
];
for (const [id, c, w, h, mutate] of cases) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto(`${BASE}?screen=${id}&case=${c}`);
  await page.waitForFunction(() => window.__ready === true);
  const before = (await page.evaluate(symMeasure)).filter((k) => !k.pass).length;
  await page.evaluate(mutate);
  const after = (await page.evaluate(symMeasure)).filter((k) => !k.pass);
  console.log(`${id}/${c}@${w}x${h}: 원본 위반 ${before} → 일부러 어긋낸 뒤 위반 ${after.length} [${[...new Set(after.map((k) => k.rule))].join(',')}]`);
}
await browser.close();
