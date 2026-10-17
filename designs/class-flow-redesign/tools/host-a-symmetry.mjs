// host-a 균형 규칙(S1~S10) 측정 — node tools/host-a-symmetry.mjs [--baseline]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measureSym } from './host-a-measure-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { chromium } = createRequire(path.resolve(root, '../../frontend/package.json'))('playwright');
const baseline = process.argv.includes('--baseline');
const PORT = process.env.PORT || 5303;
const URL = (q) => `http://localhost:${PORT}/class-flow-redesign/host-a.html?${q}`;
const VPS = ['390x844', '834x1194', '1194x834', '1280x720'];
const RULES = { S1: '단독 요소 중심축', S2: '좌우 여백 동일', S3: '상단 바 좌우 대칭', S4: 'PiP 짝(해당 없음)', S5: '시트 분기', S6: '균등 분배', S7: '세로 중앙', S8: '같은 종류 박스 폭', S9: '중앙 컬럼 max-width', S10: '8배수 간격' };

const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
const idx = await (await browser.newContext()).newPage();
await idx.goto(URL('index=1'));
const INDEX = await idx.evaluate(() => window.__INDEX);
await idx.close();
const rows = [];
for (const vp of VPS) {
  const [w, h] = vp.split('x').map(Number);
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  for (const it of INDEX) {
    await page.goto(URL(`screen=${it.screen}&case=${it.case}`));
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(120);
    const cs = await page.evaluate(measureSym);
    for (const c of cs) rows.push({ id: `${it.screen}-${it.case}`, vp, ...c });
  }
  await page.context().close();
}
await browser.close();

const fails = rows.filter((r) => !r.pass);
const byRule = {}; for (const k of Object.keys(RULES)) { const t = rows.filter((r) => r.rule === k); byRule[k] = { fail: t.filter((r) => !r.pass).length, total: t.length }; }
const baseFile = path.join(root, 'fit/.host-a-sym-baseline.json');
if (baseline) fs.writeFileSync(baseFile, JSON.stringify({ byRule, fail: fails.length, total: rows.length }, null, 1));
const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : null;

const L = [];
L.push('MIND BREEZE 2.0 · host-a(FH01~FH04) 좌우 대칭·비율 균형 측정 (균형.md S1~S10)');
L.push('측정: tools/host-a-symmetry.mjs (+ tools/host-a-measure-lib.mjs) · getBoundingClientRect 기준 · 허용 오차 ±2px (S7은 높이의 8%)');
L.push(`대상: ${INDEX.length}개 케이스 × 4뷰포트 · 총 검사 ${rows.length}건 (수정 전 ${base ? base.total : '-'}건)`);
L.push(`위반: 수정 전 ${base ? base.fail : '-'}건 → 수정 후 ${fails.length}건`);
L.push('');
L.push('규칙별 위반 건수 (수정 전 → 수정 후 / 검사 건수):');
for (const k of Object.keys(RULES)) L.push(`  ${k.padEnd(4)} ${RULES[k].padEnd(22)} ${String(base ? base.byRule[k].fail : '-').padStart(4)} → ${String(byRule[k].fail).padStart(3)} / ${byRule[k].total}`);
L.push('  (S4 PiP·CS·MS 규칙은 이 시안(영상 PiP·참가자 그리드·진행 링 없음)에 해당 요소가 없어 검사 대상 아님)');
L.push('');
L.push('뷰포트별 위반 건수: ' + VPS.map((v) => `${v}=${fails.filter((r) => r.vp === v).length}`).join('  '));
L.push('');
if (fails.length) { L.push('=== 위반 목록 ==='); for (const r of fails) L.push(`FAIL | ${r.id.padEnd(22)} | ${r.vp.padEnd(8)} | ${r.rule.padEnd(4)} | ${r.val}`); L.push(''); }
L.push('=== 전체 일람표 (케이스 | 뷰포트 | 규칙 | 측정값 | 판정) ===');
for (const r of rows) L.push(`${r.id.padEnd(22)} | ${r.vp.padEnd(8)} | ${r.rule.padEnd(4)} | ${r.val} | ${r.pass ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(path.join(root, 'fit/host-a-symmetry.txt'), L.join('\n') + '\n');
console.log(L.slice(0, 22).join('\n'));
