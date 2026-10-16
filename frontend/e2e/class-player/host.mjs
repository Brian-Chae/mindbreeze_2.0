// 상담사 케이스 스크린샷 캡처 — 시안(designs/class-player-redesign/shots/cases/counselor-*.png)과 눈으로 대조할 때 쓴다.
// 사용: node e2e/class-player/host.mjs [--base=http://localhost:5175] [--ids=C01,C05] [--vp=390x844,1280x720] [--query=sheet=hands] [--out=/tmp/host-shots]
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BASE, DEFAULT_IDS, VIEWPORTS, launchBrowser, openCase, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv);
const base = args.base || DEFAULT_BASE;
const ids = typeof args.ids === 'string' ? args.ids.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_IDS.host;
const viewports = typeof args.vp === 'string'
  ? args.vp.split(',').map((v) => v.split('x').map(Number))
  : VIEWPORTS;
const query = typeof args.query === 'string' ? args.query : '';
const suffix = typeof args.tag === 'string' ? `-${args.tag}` : '';
const out = path.resolve(args.out || '/tmp/host-shots');
fs.mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
try {
  for (const [w, h] of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const id of ids) {
      await openCase(page, base, 'host', id, query);
      const file = path.join(out, `host-${id}${suffix}-${w}x${h}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
