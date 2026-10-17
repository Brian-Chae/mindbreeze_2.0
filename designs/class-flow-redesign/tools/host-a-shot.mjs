// 빠른 확인용 캡처: node tools/host-a-shot.mjs FH01:open:390x844 FH04:ready:1280x720 ... → /tmp/ha-*.png
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { chromium } = createRequire(path.resolve(root, '../../frontend/package.json'))('playwright');
const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
const port = process.env.PORT || 5303;
for (const a of process.argv.slice(2)) {
  const [screen, cs, vp] = a.split(':');
  const [w, h] = vp.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/class-flow-redesign/host-a.html?screen=${screen}&case=${cs}`);
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `/tmp/ha-${screen}-${cs}-${vp}.png` });
  await ctx.close();
}
await browser.close();
