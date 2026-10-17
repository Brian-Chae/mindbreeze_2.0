// host-a 전 화면×케이스×4뷰포트 캡처 + 적합성(fit) 측정
// 사용: node tools/host-a-capture.mjs [--baseline] [--only=FH01,FH04] [--no-shot]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measureFit } from './host-a-measure-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { chromium } = createRequire(path.resolve(root, '../../frontend/package.json'))('playwright');
const args = process.argv.slice(2);
const baseline = args.includes('--baseline');
const noShot = args.includes('--no-shot');
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const PORT = process.env.PORT || 5303;
const URL = (q) => `http://localhost:${PORT}/class-flow-redesign/host-a.html?${q}`;
const VPS = ['390x844', '834x1194', '1194x834', '1280x720'];

const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
const idxPage = await (await browser.newContext()).newPage();
await idxPage.goto(URL('index=1'));
const INDEX = await idxPage.evaluate(() => window.__INDEX);
await idxPage.close();

fs.mkdirSync(path.join(root, 'shots/host-a'), { recursive: true });
const rows = [];
for (const vp of VPS) {
  const [w, h] = vp.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const it of INDEX) {
    if (only.length && !only.includes(it.screen)) continue;
    await page.goto(URL(`screen=${it.screen}&case=${it.case}`));
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(150);
    const m = await page.evaluate(measureFit);
    rows.push({ screen: it.screen, case: it.case, vp, type: it.type, ...m });
    if (!noShot) await page.screenshot({ path: path.join(root, 'shots/host-a', `${it.screen}-${it.case}-${vp}.png`) });
  }
  await ctx.close();
}
await browser.close();

// 원본 소스 grep
const src = fs.readFileSync(path.join(root, 'host-a.html'), 'utf8');
const glyphRe = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2022}\u{2023}\u{25A0}-\u{25FF}×✓✕←→‹›•●○]/u;
const forbRe = /세션|수업|참여하기|오픈|그래도 시작|LB |1:N|QR|OTP|게스트|6자리|귀|회원 전용|초대 기반 입장|초대받은 회원만|초대한 회원만|로그인한 계정으로 입장|30일 보관|관리자가 삭제를 지시|동의하고 계속하기|대기 그만하기|대시보드로 이동|LINK BAND 연결이 필요|필수 클래스라|입장할 수 없어요|회원이 LINK BAND를 연결해야|알림 받음|전달되지 않았어요|발송 완료|발송 실패|정원 10 고정|그룹은 최대 10명/;
const srcGlyph = src.split('\n').filter((l) => glyphRe.test(l)).length;
const srcForb = src.split('\n').filter((l) => forbRe.test(l)).length;
const srcHttp = (src.match(/https?:\/\//g) || []).length;

const CATS = [['scroll', '페이지 스크롤'], ['small', '11px 이하 글자'], ['overlap', '요소 겹침'], ['outside', '이탈'], ['clip', '잘림'], ['touch', '터치 44 미만'], ['empty', '빈 영역'], ['glyph', '이모지·글리프'], ['forbidden', '금지 용어'], ['eyebrow', '영문 대문자 아이브로우']];
const cnt = {}; for (const [k] of CATS) cnt[k] = rows.reduce((a, r) => a + r[k].length, 0);
cnt.srcGlyph = srcGlyph; cnt.srcForb = srcForb; cnt.srcHttp = srcHttp;
const failRows = rows.filter((r) => CATS.some(([k]) => r[k].length));
const total = rows.length;
const baseFile = path.join(root, 'fit/.host-a-fit-baseline.json');
if (baseline) fs.writeFileSync(baseFile, JSON.stringify({ cnt, failRows: failRows.length, total }, null, 1));
const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : null;

const L = [];
L.push('MIND BREEZE 2.0 · 클래스 사전 흐름 시안 host-a(FH01~FH04) — 적합성(fit) 측정');
L.push('파일: designs/class-flow-redesign/host-a.html · 측정: tools/host-a-capture.mjs (+ tools/host-a-measure-lib.mjs) · 서버: python3 -m http.server 5303 --directory designs');
L.push(`대상: 화면 ${new Set(INDEX.map((i) => i.screen)).size}종(FH01·FH02a~e·FH03·FH04) · 케이스 ${INDEX.length}개 × 뷰포트 4종 = ${total}개 조합`);
L.push('판정: 페이지 스크롤 0 · 11px 이하 0 · 겹침 0 · 이탈 0 · 잘림 0 · 터치≥44 · 빈 영역 0 · 이모지·글리프 0 · 금지 용어 0 · 영문 대문자 아이브로우 0 (내부 스크롤은 목록·셸 본문 영역만 허용)');
L.push('');
L.push('항목                    | 수정 전 | 수정 후');
L.push('------------------------|--------|--------');
for (const [k, n] of CATS) L.push(`${n.padEnd(22)} | ${String(base ? base.cnt[k] : '-').padStart(6)} | ${String(cnt[k]).padStart(6)}`);
L.push(`${'소스 grep 글리프(행)'.padEnd(21)} | ${String(base ? base.cnt.srcGlyph : '-').padStart(6)} | ${String(srcGlyph).padStart(6)}`);
L.push(`${'소스 grep 금지 용어(행)'.padEnd(20)} | ${String(base ? base.cnt.srcForb : '-').padStart(6)} | ${String(srcForb).padStart(6)}`);
L.push(`${'외부 http 리소스'.padEnd(21)} | ${String(base ? base.cnt.srcHttp : '-').padStart(6)} | ${String(srcHttp).padStart(6)}`);
L.push(`${'위반 조합 수'.padEnd(22)} | ${String(base ? base.failRows : '-').padStart(6)} | ${String(failRows.length).padStart(6)}  (전체 ${total})`);
const pass = failRows.length === 0 && srcGlyph === 0 && srcForb === 0 && srcHttp === 0;
L.push('');
L.push(`전체 판정: ${pass ? 'PASS' : 'FAIL'}`);
L.push('');
const scr = rows.filter((r) => r.scrollers.length);
L.push(`내부 스크롤이 실제로 생기는 조합: ${scr.length}개 (허용 영역만: .sh-scroll 셸 본문 / .w-list 목록 / .w-plist 초대 목록)`);
const kinds = {}; for (const r of scr) for (const s of r.scrollers) kinds[s.split(':')[0]] = (kinds[s.split(':')[0]] || 0) + 1;
L.push('  영역별: ' + Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join(' '));
L.push('');
if (failRows.length) {
  L.push('=== 위반 목록 ===');
  for (const r of failRows) for (const [k, n] of CATS) for (const d of r[k]) L.push(`FAIL | ${r.screen}-${r.case} | ${r.vp} | ${n} | ${d}`);
  L.push('');
}
L.push('=== 전체 일람표 (화면-케이스 | 뷰포트 | scrollH/vh | 위반 항목 수 | 판정) ===');
for (const r of rows) {
  const n = CATS.reduce((a, [k]) => a + r[k].length, 0);
  L.push(`${(r.screen + '-' + r.case).padEnd(22)} | ${r.vp.padEnd(8)} | ${(r.scrollH + '/' + r.vh).padEnd(10)} | ${String(n).padStart(2)} | ${n ? 'FAIL' : 'PASS'}`);
}
fs.writeFileSync(path.join(root, 'fit/host-a-fit.txt'), L.join('\n') + '\n');
console.log(L.slice(0, 28).join('\n'));
