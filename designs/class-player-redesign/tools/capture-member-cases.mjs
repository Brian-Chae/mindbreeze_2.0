// 회원 시안 케이스(M01~M21) 캡처·측정 — Playwright는 frontend/node_modules 것을 읽기 전용으로 사용
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { measure } from './member-measure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.resolve(root, '../../frontend/package.json'));
const { chromium } = require('playwright');

const IDS = Array.from({ length: 21 }, (_, i) => 'M' + String(i + 1).padStart(2, '0'));
const BASE_VP = ['390x844', '1280x720'];
const CORE = { M01: 1, M05: 1, M06: 1, M10: 1 };
const EXTRA_VP = ['834x1194', '1194x834'];
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const url = (id) => pathToFileURL(path.join(root, 'member.html')).href + `?case=${id}`;

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--hide-scrollbars'] });
const results = [];
for (const vp of [...BASE_VP, ...EXTRA_VP]) {
  const [w, h] = vp.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const id of IDS) {
    if (only && !only.has(id)) continue;
    
    await page.goto(url(id));
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { a.pause(); a.currentTime = 500; } }));
    const m = await page.evaluate(measure);
    results.push({ id, vp, ...m });
    await page.screenshot({ path: path.join(root, 'shots', 'cases', `member-${id}-${vp}.png`) });
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(root, 'shots', 'cases', 'member-cases-fit.json'), JSON.stringify(results, null, 1));

const html = fs.readFileSync(path.join(root, 'member.html'), 'utf8');
const bad = html.split('\n').filter((l) => /들이|내쉬|breathe|함께 호흡/.test(l)).length;
const L = [];
L.push('MIND BREEZE 2.0 · 회원 클래스 진행 화면 — 케이스(M01~M21) 측정 리포트');
L.push('파일: designs/class-player-redesign/member.html?case=Mxx · 측정: tools/capture-member-cases.mjs (+ tools/member-measure.mjs)');
L.push('판정: scrollH<=innerH & scrollW<=innerW, ≤11px 0, 겹침·이탈·잘림 0, 터치<44 0, 빈 영역 0, 시트 내부 넘침 0');
L.push('');
L.push('케이스 | 뷰포트   | scrollH/innerH | scrollW/innerW | ≤11px | 겹침 | 이탈 | 잘림 | 시트넘침 | 터치<44 | 빈영역 | 배경노출 | 판정');
L.push('-------|----------|----------------|----------------|-------|------|------|------|----------|---------|--------|----------|-----');
let allOk = true;
for (const r of results) {
  const pass = r.ok && r.small === 0 && !r.overlaps.length && !r.outside.length && !r.clipped.length && !r.sheetOverflow.length && !r.small44.length && !r.empties.length;
  if (!pass) allOk = false;
  L.push(`${r.id.padEnd(6)} | ${r.vp.padEnd(8)} | ${(r.scrollH + '/' + r.vh).padEnd(14)} | ${(r.scrollW + '/' + r.vw).padEnd(14)} | ${String(r.small).padEnd(5)} | ${String(r.overlaps.length).padEnd(4)} | ${String(r.outside.length).padEnd(4)} | ${String(r.clipped.length).padEnd(4)} | ${String(r.sheetOverflow.length).padEnd(8)} | ${String(r.small44.length).padEnd(7)} | ${String(r.empties.length).padEnd(6)} | ${(r.bgVisible * 100).toFixed(1).padStart(5)}%   | ${pass ? 'PASS' : 'FAIL'}`);
}
L.push('');
L.push(`호흡 지시 grep: grep -c "들이\\|내쉬\\|breathe\\|함께 호흡" member.html = ${bad}  (${bad === 0 ? 'PASS' : 'FAIL'})`);
L.push(`전체 판정: ${allOk && bad === 0 ? 'PASS' : 'FAIL'}  (${results.length}개 조합)`);
const details = results.filter((r) => r.overlaps.length || r.outside.length || r.clipped.length || r.sheetOverflow.length || r.small44.length || r.empties.length || r.small || !r.ok);
if (details.length) {
  L.push('', '--- 상세(실패 항목) ---');
  for (const r of details) L.push(`[${r.id} ${r.vp}] 겹침=${r.overlaps.join(',') || '-'} 이탈=${r.outside.join(',') || '-'} 잘림=${r.clipped.join(' | ') || '-'} 시트넘침=${r.sheetOverflow.join(',') || '-'} 터치<44=${r.small44.join(',') || '-'} 빈영역=${r.empties.join(' | ') || '-'} ≤11px=${r.smallList.join(',') || '-'}`);
}
fs.writeFileSync(path.join(root, 'shots', 'cases', 'member-cases-fit.txt'), L.join('\n') + '\n');
console.log(L.join('\n'));
