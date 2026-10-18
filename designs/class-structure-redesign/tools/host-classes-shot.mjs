// 빠른 확인용 캡처: node tools/host-classes-shot.mjs CH01:open:390x844 CH20:table:1280x720 ... → /tmp/hc-*.png
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { chromium } = createRequire(path.resolve(root, '../../frontend/package.json'))('playwright');
const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
const port = process.env.PORT || 5311;
for (const a of process.argv.slice(2)) {
  const [screen, cs, vp] = a.split(':');
  const [w, h] = vp.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/class-structure-redesign/host-classes.html?screen=${screen}&case=${cs}`);
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `/tmp/hc-${screen}-${cs}-${vp}.png` });
  await ctx.close();
}
await browser.close();
