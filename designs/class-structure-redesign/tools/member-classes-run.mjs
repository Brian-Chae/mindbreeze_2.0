// member-classes 캡처 + 측정 실행기
// 사용: python3 -m http.server 5312 --directory ".../designs" 를 띄운 뒤
//       node tools/member-classes-run.mjs [before|final] [screens=MC01,MC02]
// (서빙 루트를 designs/ 로 둔 이유: ../class-player-redesign/tokens.css 가 서빙 루트 밖이면 404)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { fitMeasure, symMeasure } from './member-classes-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const D = path.resolve(here, '..');
const { chromium } = createRequire(path.resolve(D, '../../frontend/package.json'))('playwright');
const MODE = process.argv[2] || 'final';
const ONLY = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const BASE = 'http://localhost:5312/class-structure-redesign/member-classes.html';
const VPS = ['390x844', '834x1194', '1194x834', '1280x720'];
const suffix = MODE === 'before' ? '-before' : '';
fs.mkdirSync(path.join(D, 'shots/member-classes'), { recursive: true });
fs.mkdirSync(path.join(D, 'fit'), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
const probe = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
probe.on('pageerror', (e) => errs.push(String(e)));
await probe.goto(BASE + '?index=1');
await probe.waitForFunction(() => window.__ready === true);
const REG = await probe.evaluate(() => window.__REG);
await probe.context().close();

const fitRows = [], symRows = [];
for (const vp of VPS) {
  const [w, h] = vp.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${vp}: ${e}`));
  for (const s of REG) {
    if (ONLY && !ONLY.has(s.id)) continue;
    for (const c of s.cases) {
      await page.goto(`${BASE}?screen=${s.id}&case=${c}`);
      await page.waitForFunction(() => window.__ready === true);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(120);
      const m = await page.evaluate(fitMeasure);
      const sy = await page.evaluate(symMeasure);
      fitRows.push({ id: s.id, c, vp, ...m });
      for (const k of sy) symRows.push({ id: `${s.id}/${c}`, vp, ...k });
      await page.screenshot({ path: path.join(D, 'shots/member-classes', `${s.id}-${c}-${vp}.png`) });
    }
  }
  await ctx.close();
}
await browser.close();

// 정적 grep (파일 전체)
const html = fs.readFileSync(path.join(D, 'member-classes.html'), 'utf8');
const grepCount = (re) => (html.match(re) || []).length;
const external = grepCount(/(src|href)\s*=\s*["']https?:\/\//g) + grepCount(/url\(\s*["']?https?:/g);
const breathing = grepCount(/들이쉬|내쉬|breathe|함께 호흡|들이마/g);
const BANNED_FILE = ['수업', '세션', '참여하기', '오픈', '그래도 시작', '1:N', '게스트', '호스트', '강사', '점수', '순위', '평균', '종합', '등급', '개선', '악화', '정원', '대기열', 'LB '];
const fileHits = Object.fromEntries(BANNED_FILE.map((w) => [w, html.split(w).length - 1]));
const emojiFile = (html.match(/\p{Extended_Pictographic}/gu) || []).length;
const glyphFile = (html.match(/[←-⇿•‹›×○●✓✕✗✔]/g) || []).length;
const fileHitTotal = Object.values(fileHits).reduce((a, v) => a + v, 0);
const staticFail = (external ? 1 : 0) + (breathing ? 1 : 0) + (fileHitTotal ? 1 : 0) + (emojiFile ? 1 : 0) + (glyphFile ? 1 : 0);

const bad = (r) => ({
  scroll: r.pageOk ? 0 : 1, small: r.small.length, clipped: r.clipped.length, outside: r.outside.length, overlaps: r.overlaps.length,
  touch: r.small44.length, empty: r.empties.length, glyph: r.glyph.length, banned: r.banned.length, eyebrow: r.eyebrow.length, fold: r.fold.length,
});
const CAT = { scroll: '페이지 스크롤 0', small: '11px 이하 0', clipped: '텍스트 잘림 0', outside: '이탈 0', overlaps: '겹침 0', touch: '터치 ≥44', empty: '빈 영역 0', glyph: '이모지·글리프 0', banned: '금지 용어 0', eyebrow: '영문 대문자 아이브로우 0', fold: '히어로 CTA 첫 화면 노출' };
const totals = Object.fromEntries(Object.keys(CAT).map((k) => [k, 0]));
const L = [];
let failCombos = 0;
const lines = [];
for (const r of fitRows) {
  const b = bad(r), n = Object.values(b).reduce((a, v) => a + v, 0);
  for (const k of Object.keys(b)) totals[k] += b[k];
  if (n) failCombos++;
  lines.push(`${(r.id + '/' + r.c).padEnd(26)} | ${r.vp.padEnd(8)} | ${(r.scrollH + '/' + r.vh).padEnd(9)} | 내부스크롤 ${String(r.inner).padStart(4)} | ${n ? 'FAIL' : 'PASS'}${n ? ' ' + Object.entries(b).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(',') : ''}`);
}
const nCases = new Set(fitRows.map((r) => r.id + '/' + r.c)).size;
const nScreens = new Set(fitRows.map((r) => r.id)).size;
L.push(`MIND BREEZE 2.0 · 회원 홈·내 클래스 시안 (MC01~MC07) — fit 측정 [${MODE === 'before' ? '수정 전' : '수정 후'}]`);
L.push(`측정: tools/member-classes-run.mjs (+ member-classes-lib.mjs) · 대상 ${nScreens}개 화면 · ${nCases}개 케이스 × ${VPS.length}개 뷰포트 = ${fitRows.length}개 조합 · 서버: http://localhost:5312 (서빙 루트 designs/)`);
L.push(`판정: ${failCombos === 0 && !staticFail && !errs.length ? 'PASS' : 'FAIL'} (조합 위반 ${failCombos}건 / ${fitRows.length}건, 정적 grep 위반 ${staticFail}건, 스크립트 오류 ${errs.length}건)`);
L.push('');
L.push('항목별 위반 건수 (조합 합계):');
for (const k of Object.keys(CAT)) L.push(`  ${CAT[k].padEnd(26)} ${String(totals[k]).padStart(4)}`);
L.push(`  ${'외부 http 리소스 0'.padEnd(26)} ${String(external).padStart(4)}`);
L.push(`  ${'호흡 지시 문구 grep 0'.padEnd(26)} ${String(breathing).padStart(4)}`);
L.push(`  ${'이모지 범위 파일 grep 0'.padEnd(26)} ${String(emojiFile).padStart(4)}`);
L.push(`  ${'문자 글리프 파일 grep 0'.padEnd(26)} ${String(glyphFile).padStart(4)}`);
L.push(`  ${'금지어 파일 grep(전체 소스)'.padEnd(26)} ${String(fileHitTotal).padStart(4)}  ` + Object.entries(fileHits).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' '));
L.push('');
L.push('내부 스크롤: 셸형 본문(목록·타임라인·서사)만 허용. 일람표의 `내부스크롤` 열이 넘치는 높이(px).');
L.push('');
const details = fitRows.filter((r) => Object.values(bad(r)).some(Boolean));
if (errs.length) { L.push('=== 스크립트 오류 ==='); L.push(...errs); L.push(''); }
if (details.length) {
  L.push('=== 위반 상세 ===');
  for (const r of details) {
    const parts = [];
    if (!r.pageOk) parts.push(`스크롤 ${r.scrollH}/${r.vh} x ${r.scrollW}/${r.vw}`);
    for (const [k, v] of [['11px', r.small], ['잘림', r.clipped], ['이탈', r.outside], ['겹침', r.overlaps], ['터치', r.small44], ['빈영역', r.empties], ['글리프', r.glyph], ['금지어', r.banned], ['아이브로우', r.eyebrow], ['CTA', r.fold]]) if (v.length) parts.push(`${k}: ${v.slice(0, 4).join(' ; ')}${v.length > 4 ? ` 외 ${v.length - 4}` : ''}`);
    L.push(`FAIL | ${r.id}/${r.c} | ${r.vp} | ${parts.join(' | ')}`);
  }
  L.push('');
}
L.push('=== 전체 일람표 (화면/케이스 | 뷰포트 | scrollH/innerH | 내부 스크롤 | 판정) ===');
L.push(...lines);
fs.writeFileSync(path.join(D, `fit/member-classes-fit${suffix}.txt`), L.join('\n') + '\n');

// 대칭
const RULE = { S1: '단독 요소 중심축', S2: '좌우 여백 동일', S3: '헤더 좌우 대칭', S4: 'PiP 짝 가운데(해당 없음)', S5: '시트 분기(세로형=바텀)', S6: '균등 분배', S7: '본문 세로 중앙(해당 없음)', S8: '박스 폭 동일', S9: '중앙 컬럼 max-width', S10: '8배수 간격', MS3: '전체 화면 정중앙' };
const fails = symRows.filter((r) => !r.pass);
const S = [];
S.push(`MIND BREEZE 2.0 · 회원 홈·내 클래스 시안 (MC01~MC07) — 좌우 대칭·비율 균형 측정 [${MODE === 'before' ? '수정 전' : '수정 후'}] (균형.md S1~S10, MS3)`);
S.push(`측정: tools/member-classes-run.mjs · ${new Set(symRows.map((r) => r.id)).size}개 케이스 × ${VPS.length}개 뷰포트 · 총 검사 ${symRows.length}건`);
S.push(`위반 ${fails.length}건 / 전체 ${symRows.length}건`);
S.push('');
S.push('규칙별 위반 건수:');
for (const k of Object.keys(RULE)) { const t = symRows.filter((r) => r.rule === k); S.push(`  ${k.padEnd(4)} ${RULE[k].padEnd(22)} 위반 ${String(t.filter((r) => !r.pass).length).padStart(3)} / ${t.length}`); }
S.push('');
S.push('뷰포트별 위반 건수: ' + VPS.map((v) => `${v}=${fails.filter((r) => r.vp === v).length}`).join('  '));
S.push('');
if (fails.length) { S.push('=== 위반 목록 ==='); for (const r of fails) S.push(`FAIL | ${r.id.padEnd(26)} | ${r.vp.padEnd(8)} | ${r.rule.padEnd(4)} | ${r.val}`); S.push(''); }
S.push('=== 전체 일람표 (케이스 | 뷰포트 | 규칙 | 측정값 | 판정) ===');
for (const r of symRows) S.push(`${r.id.padEnd(26)} | ${r.vp.padEnd(8)} | ${r.rule.padEnd(4)} | ${r.val} | ${r.pass ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(path.join(D, `fit/member-classes-symmetry${suffix}.txt`), S.join('\n') + '\n');

console.log(L.slice(0, 22).join('\n'));
console.log('\n' + S.slice(0, 18).join('\n'));
