// 회원 시안 캡처·측정 스크립트 (Playwright는 frontend/node_modules 것을 읽기 전용으로 사용)
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { measure } from './member-measure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.resolve(root, '../../frontend/package.json'));
const { chromium } = require('playwright');

const VIEWPORTS = [[390, 844], [834, 1194], [1194, 834], [1280, 720]];
// 스크린샷 4상태 + 추가 측정 상태
const SHOT_STATES = { base: '', status: '?sheet=status', chat: '?sheet=chat', noband: '?band=off' };
const EXTRA_STATES = { signal: '?sheet=signal', sound: '?sheet=sound', device: '?sheet=device', 'noband-status': '?band=off&sheet=status', 'noband-device': '?band=off&sheet=device', 'nopip': '?pip=off' };
const url = (qs) => pathToFileURL(path.join(root, 'member.html')).href + qs;

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--hide-scrollbars'] });
const results = [];
for (const [w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name, qs] of [...Object.entries(SHOT_STATES), ...Object.entries(EXTRA_STATES)]) {
    await page.goto(url(qs));
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);
    // 시트 진입 애니메이션을 끝 상태로 고정해 스크린샷을 재현 가능하게 함
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { a.pause(); a.currentTime = 500; } }));
    const m = await page.evaluate(measure);
    results.push({ vp: `${w}x${h}`, state: name, ...m });
    if (name in SHOT_STATES) {
      await page.screenshot({ path: path.join(root, 'shots', `member-${w}x${h}-${name}.png`) });
    }
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(root, 'shots', 'member-fit.json'), JSON.stringify(results, null, 1));

const L = [];
L.push('MIND BREEZE 2.0 · 회원 클래스 진행 화면 시안 — 반응형 측정 리포트');
L.push('파일: designs/class-player-redesign/member.html · 측정: tools/capture-member.mjs (Playwright Chromium, DPR 1)');
L.push('판정: scrollHeight<=innerHeight AND scrollWidth<=innerWidth, 11px 이하 텍스트 0, 겹침/뷰포트 이탈/텍스트 잘림 0');
L.push('');
L.push('뷰포트     | 상태          | scrollH/innerH | scrollW/innerW | ≤11px | 겹침 | 이탈 | 잘림 | 시트넘침 | 터치<44 | 빈영역 | 배경노출 | 판정');
L.push('-----------|---------------|----------------|----------------|-------|------|------|------|----------|---------|--------|----------|-----');
let allOk = true;
for (const r of results) {
  const pass = r.ok && r.small === 0 && !r.overlaps.length && !r.outside.length && !r.clipped.length && !r.sheetOverflow.length && !r.small44.length && !r.empties.length;
  if (!pass) allOk = false;
  L.push(`${r.vp.padEnd(10)} | ${r.state.padEnd(13)} | ${(r.scrollH + '/' + r.vh).padEnd(14)} | ${(r.scrollW + '/' + r.vw).padEnd(14)} | ${String(r.small).padEnd(5)} | ${String(r.overlaps.length).padEnd(4)} | ${String(r.outside.length).padEnd(4)} | ${String(r.clipped.length).padEnd(4)} | ${String(r.sheetOverflow.length).padEnd(8)} | ${String(r.small44.length).padEnd(7)} | ${String(r.empties.length).padEnd(6)} | ${(r.bgVisible * 100).toFixed(1).padStart(5)}%   | ${pass ? 'PASS' : 'FAIL'}`);
}
L.push('');
L.push(`전체 판정: ${allOk ? 'PASS' : 'FAIL'}  (${results.length}개 조합)`);
const details = results.filter((r) => r.overlaps.length || r.outside.length || r.clipped.length || r.sheetOverflow.length || r.small44.length || r.empties.length || r.small);
if (details.length) {
  L.push('', '--- 상세(실패 항목) ---');
  for (const r of details) L.push(`[${r.vp} ${r.state}] 겹침=${r.overlaps.join(',') || '-'} 이탈=${r.outside.join(',') || '-'} 잘림=${r.clipped.join(' | ') || '-'} 시트넘침=${r.sheetOverflow.join(',') || '-'} 터치<44=${r.small44.join(',') || '-'} 빈영역=${r.empties.join(',') || '-'} ≤11px=${r.smallList.join(',') || '-'}`);
}
fs.writeFileSync(path.join(root, 'shots', 'member-fit.txt'), L.join('\n') + '\n');
console.log(L.join('\n'));
