// 회원 시안 B 스크린샷 — 전 화면 × 케이스 × 4개 뷰포트 → shots/member-b/<화면ID>-<case>-<뷰포트>.png
// 사용: node tools/member-b-capture.mjs   (서버: python3 -m http.server 5302 --directory "<designs>")
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { chromium } = createRequire('/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/package.json')('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5302/class-flow-redesign/member-b.html';
const VPS = ['390x844', '834x1194', '1194x834', '1280x720'];
const outDir = path.join(root, 'shots/member-b');
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.png')) fs.rmSync(path.join(outDir, f));

const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
const probe = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await probe.goto(BASE);
await probe.waitForFunction(() => window.__ready === true);
const CASES = await probe.evaluate(() => window.__cases);
await probe.context().close();

let n = 0;
for (const vp of VPS) {
  const [w, h] = vp.split('x').map(Number);
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  for (const [screen, list] of Object.entries(CASES)) for (const c of list) {
    await page.goto(`${BASE}?screen=${screen}&case=${c}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { a.pause(); } }));
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(outDir, `${screen}-${c}-${vp}.png`) });
    n++;
  }
  await page.context().close();
}
await browser.close();
console.log(`스크린샷 ${n}장 → ${outDir}`);
