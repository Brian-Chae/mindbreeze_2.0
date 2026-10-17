// 회원 시안 좌우 대칭·비율 균형 측정 (균형.md §2 S1~S10, MS1~MS3)
// 사용: node tools/measure-symmetry-member.mjs [출력파일=shots/cases/member-symmetry.txt]
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { chromium } = createRequire(path.resolve(root, '../../frontend/package.json'))('playwright');
const outFile = path.resolve(root, process.argv[2] || 'shots/cases/member-symmetry.txt');
const VPS = ['390x844', '834x1194', '1194x834', '1280x720'];
const IDS = Array.from({ length: 21 }, (_, i) => 'M' + String(i + 1).padStart(2, '0'));
// 시트가 열린 상태에서의 대칭도 검사 (사이드/바텀 시트 분기 · 내 상태 2×3 격자)
const SHEET_VARIANTS = [
  ['M01', 'status'], ['M01', 'chat'], ['M01', 'signal'], ['M01', 'sound'], ['M01', 'device'],
  ['M02', 'chat'], ['M05', 'status'], ['M05', 'chat'], ['M05', 'sound'], ['M06', 'device'], ['M18', 'status'],
];
const RULE_NAMES = { S1: '단독 요소 중심축', S2: '좌우 여백 동일', S3: '상단 바 좌우 대칭', S4: 'PiP 짝 가운데', S5: '시트 분기(태블릿 세로=바텀)', S6: '도크·미디어 줄 균등', S7: '링 세로 중앙', S8: '박스 최대폭 동일', S9: '중앙 컬럼 max-width', S10: '8배수 간격', MS1: '오프라인 컬럼 구조', MS2: '6지표 격자 균등', MS3: '전체 화면 정중앙' };

function measureSym() {
  const vw = innerWidth, vh = innerHeight, checks = [];
  const add = (rule, val, pass) => checks.push({ rule, val, pass });
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
  const R = (sel) => { const el = [...document.querySelectorAll(sel)].find(vis); return el ? box(el) : null; };
  const RA = (sel) => [...document.querySelectorAll(sel)].filter(vis).map(box);
  const f = (n) => (Math.round(n * 10) / 10).toString();

  const sheet = R('.sheet');
  const side = !!sheet && sheet.w < vw * 0.6;
  const bottomSheet = !!sheet && !side;
  const regionL = 0, regionR = side ? sheet.x : vw, axis = (regionL + regionR) / 2;
  const pad = parseFloat(getComputedStyle(document.getElementById('app')).paddingLeft);
  const fullview = R('.fullview .fv-card');
  const named = { 링: R('.ring'), 안내칩: R('.guide'), 추이: R('.trend'), 안내박스: R('.stack .info-card') || R('.hero .info-card'), 현장카드: R('.hero-side .side-card'), 배너: R('.banner'), 시간필: R('.title-pill'), 네트워크카드: R('.net-down') };
  const dock = R('.dock'), media = R('.media-row');

  if (!fullview) {
    // S1
    for (const [k, b] of Object.entries(named)) if (b) add('S1', `${k} Δ${f(b.cx - axis)}`, Math.abs(b.cx - axis) <= 2);
    if (dock) add('S1', `도크 Δ${f(dock.cx - axis)}`, Math.abs(dock.cx - axis) <= 2);
    if (media) add('S1', `미디어줄 Δ${f(media.cx - axis)}`, Math.abs(media.cx - axis) <= 2);
    // S2
    for (const [k, b] of [['도크', dock], ['미디어줄', media], ['배너', named.배너]]) if (b) { const l = b.x - regionL, r = regionR - b.r; add('S2', `${k} 좌${f(l)}/우${f(r)}`, Math.abs(l - r) <= 2); }
    if (bottomSheet) { const l = sheet.x - regionL, r = regionR - sheet.r; add('S2', `바텀시트 좌${f(l)}/우${f(r)}`, Math.abs(l - r) <= 2); }
    // S3
    const leave = R('.topbar > .circle-btn'), conn = R('.conn');
    if (leave && conn) {
      const l = leave.x - regionL, r = regionR - conn.r;
      add('S3', `여백 좌${f(l)}/우${f(r)} · 높이 ${f(leave.h)}/${f(conn.h)}`, Math.abs(l - r) <= 2 && Math.abs(leave.h - conn.h) <= 2);
    }
    // S4
    const pips = RA('.pip, .mypip').sort((a, b) => a.x - b.x);
    if (pips.length) {
      const ux = Math.min(...pips.map((p) => p.x)), ur = Math.max(...pips.map((p) => p.r)), cx = (ux + ur) / 2;
      let ok = Math.abs(cx - axis) <= 2, val = `묶음 Δ${f(cx - axis)}`;
      if (pips.length === 2) {
        const [a, b] = pips;
        const same = Math.abs(a.w - b.w) <= 2 && Math.abs(a.h - b.h) <= 2, aligned = Math.abs(a.y - b.y) <= 2, side2 = b.x >= a.r - 0.5;
        ok = ok && same && aligned && side2; val += ` · 크기 ${f(a.w)}×${f(a.h)}/${f(b.w)}×${f(b.h)} · 상단차 ${f(Math.abs(a.y - b.y))}`;
      }
      add('S4', val, ok);
    }
    // S5
    if (sheet) {
      if (vw < vh) add('S5', `세로형 ${side ? '사이드시트(위반)' : '바텀시트'}`, !side);
      else if (vw >= 768) add('S5', `가로형 ${side ? '사이드시트' : '바텀시트'}`, true);
      if (bottomSheet) add('S5', `바텀시트 폭 ${f(sheet.w)} (≤640)`, sheet.w <= 642);
    }
    // S6
    for (const [k, b, sel] of [['도크', dock, '.dock > .dk'], ['미디어줄', media, '.media-row > .mbtn']]) {
      if (!b) continue;
      const items = RA(sel).sort((p, q) => p.x - q.x);
      if (items.length < 2) { add('S6', `${k} 항목 ${items.length}개`, true); continue; }
      const ws = items.map((i) => i.w), gaps = items.slice(1).map((i, n) => i.x - items[n].r);
      const inL = items[0].x - b.x, inR = b.r - items[items.length - 1].r;
      const wide = b.w >= Math.min(regionR - regionL - 2 * pad, 640) - 4;
      const ok = Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...gaps) - Math.min(...gaps) <= 2 && Math.abs(inL - inR) <= 2 && wide;
      add('S6', `${k} 폭${f(b.w)} 항목폭 ${f(Math.min(...ws))}~${f(Math.max(...ws))} 간격 ${f(Math.min(...gaps))}~${f(Math.max(...gaps))} 안쪽 ${f(inL)}/${f(inR)}`, ok);
    }
    // S7 — 링은 (상단 바 또는 배너 아래) ~ (미디어 줄/도크/바텀 시트 위) 사이의 세로 중앙
    if (named.링) {
      const top = Math.max(R('.topbar').b, named.배너 ? named.배너.b : 0);
      const bot = Math.min(...[media && media.y, dock && dock.y, bottomSheet && sheet.y].filter((v) => typeof v === 'number'));
      const dv = named.링.cy - (top + bot) / 2, tol = (bot - top) * 0.08;
      add('S7', `링 중심 Δ${f(dv)} (허용 ±${f(tol)}) · 위${f(named.링.y - top)}/아래${f(bot - named.링.b)}`, Math.abs(dv) <= tol);
    }
    // S8
    const wb = [['배너', named.배너], ['안내칩', named.안내칩], ['추이', named.추이], ['안내박스', named.안내박스], ['현장카드', named.현장카드]].filter(([, b]) => b);
    if (wb.length > 1) { const ws = wb.map(([, b]) => b.w); add('S8', wb.map(([k, b]) => `${k}${f(b.w)}`).join(' '), Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...ws) <= 482); }
    // S9
    if (vw >= 768) {
      const cols = [['도크', dock], ['미디어줄', media], ['링', named.링], ...wb, ['바텀시트', bottomSheet ? sheet : null]].filter(([, b]) => b);
      const over = cols.filter(([, b]) => b.w > 642).map(([k, b]) => `${k}${f(b.w)}`);
      add('S9', over.length ? `초과: ${over.join(' ')}` : `최대 ${f(Math.max(...cols.map(([, b]) => b.w)))} ≤640`, !over.length);
    }
    // S10
    const stack = [['링', named.링], ['안내칩', named.안내칩], ['추이/안내박스', named.추이 || named.안내박스], ['현장카드', named.현장카드]].filter(([, b]) => b).sort((p, q) => p[1].y - q[1].y);
    const okSet = (g) => [8, 16, 24, 32, 40, 48].some((s) => Math.abs(g - s) <= 1);
    if (stack.length > 1) {
      // 링에 붙은 간격과 카드끼리 간격을 구분: 각각 8배수 집합 안이고, 같은 종류끼리는 같은 값
      const pairs = stack.slice(1).map(([k, b], n) => ({ ringAdj: k === '링' || stack[n][0] === '링', g: b.y - stack[n][1].b }));
      const same = (a) => a.length < 2 || Math.max(...a) - Math.min(...a) <= 1;
      const ringG = pairs.filter((x) => x.ringAdj).map((x) => x.g), cardG = pairs.filter((x) => !x.ringAdj).map((x) => x.g);
      add('S10', `링 인접 ${ringG.map(f).join('/') || '-'} · 카드 사이 ${cardG.map(f).join('/') || '-'}`, pairs.every((x) => okSet(x.g)) && same(ringG) && same(cardG));
    }
    const pips2 = RA('.pip, .mypip').sort((a, b) => a.x - b.x);
    if (pips2.length === 2) add('S10', `PiP 사이 ${f(pips2[1].x - pips2[0].r)}`, okSet(pips2[1].x - pips2[0].r));
    if (media && dock) add('S10', `미디어줄→도크 ${f(dock.y - media.b)}`, okSet(dock.y - media.b));
    // MS1
    if (document.getElementById('app').dataset.place === 'offline') {
      const hiddenBySheet = bottomSheet && wb.length === 0; // 모바일 바텀 시트가 열리면 카드를 접는 것이 설계
      const spread = wb.length ? Math.max(...wb.map(([, b]) => b.w)) - Math.min(...wb.map(([, b]) => b.w)) : 0;
      const ok = !RA('.pip, .mypip, .media-row').length && !!named.링 && (hiddenBySheet || (wb.length >= 3 && spread <= 2));
      add('MS1', hiddenBySheet ? '영상·마이크 없음 · 바텀 시트로 카드 접힘' : `영상·마이크 없음 · 링+박스 ${wb.length}장 폭 편차 ${f(spread)}`, ok);
    }
    // MS2
    const cells = RA('.mcell');
    if (cells.length === 6) {
      const ws = cells.map((c) => c.w), hs = cells.map((c) => c.h);
      const xs = [...new Set(cells.map((c) => Math.round(c.cx)))].sort((a, b) => a - b), ys = [...new Set(cells.map((c) => Math.round(c.cy)))].sort((a, b) => a - b);
      const dx = xs.slice(1).map((x, i) => x - xs[i]), pitchOk = dx.length < 2 || Math.max(...dx) - Math.min(...dx) <= 2;
      add('MS2', `셀 ${f(Math.min(...ws))}~${f(Math.max(...ws))}×${f(Math.min(...hs))}~${f(Math.max(...hs))} · 열 간격 ${dx.join('/')}`, Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...hs) - Math.min(...hs) <= 2 && pitchOk && xs.length === 3 && ys.length === 2);
    }
    // MS3 — 네트워크 끊김
    if (named.네트워크카드) {
      const top = R('.topbar').b, bot = Math.min(...[media && media.y, dock && dock.y].filter((v) => typeof v === 'number')), dv = named.네트워크카드.cy - (top + bot) / 2;
      add('MS3', `끊김 카드 Δx${f(named.네트워크카드.cx - axis)} Δy${f(dv)}`, Math.abs(named.네트워크카드.cx - axis) <= 2 && Math.abs(dv) <= (bot - top) * 0.08);
    }
  } else {
    const dx = fullview.cx - vw / 2, dy = fullview.cy - vh / 2;
    add('MS3', `전체화면 카드 Δx${f(dx)} Δy${f(dy)}`, Math.abs(dx) <= 2 && Math.abs(dy) <= 4);
    add('S9', `카드 폭 ${f(fullview.w)} ≤640`, fullview.w <= 642);
  }
  return checks;
}

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--hide-scrollbars'] });
const rows = [];
for (const vp of VPS) {
  const [w, h] = vp.split('x').map(Number);
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  const targets = [...IDS.map((id) => [id, null]), ...SHEET_VARIANTS];
  for (const [id, sheet] of targets) {
    await page.goto(pathToFileURL(path.join(root, process.env.MEMBER_HTML || 'member.html')).href + `?case=${id}` + (sheet ? `&sheet=${sheet}` : ''));
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(350);
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { a.pause(); a.currentTime = 500; } }));
    const checks = await page.evaluate(measureSym);
    for (const c of checks) rows.push({ id: sheet ? `${id}+${sheet}` : id, vp, ...c });
  }
  await page.context().close();
}
await browser.close();

const fails = rows.filter((r) => !r.pass);
const L = [];
L.push('MIND BREEZE 2.0 · 회원 화면 좌우 대칭·비율 균형 측정 (균형.md §2 S1~S10, MS1~MS3)');
L.push(`측정: tools/measure-symmetry-member.mjs · 대상: M01~M21 × 4뷰포트 + 시트 열림 변형 ${SHEET_VARIANTS.length}종 × 4뷰포트 · 총 검사 ${rows.length}건`);
L.push(`위반 ${fails.length}건 / 전체 ${rows.length}건`);
L.push('');
L.push('규칙별 위반 건수:');
for (const k of Object.keys(RULE_NAMES)) { const t = rows.filter((r) => r.rule === k); L.push(`  ${k.padEnd(4)} ${RULE_NAMES[k].padEnd(22)} 위반 ${String(t.filter((r) => !r.pass).length).padStart(3)} / ${t.length}`); }
L.push('');
L.push('뷰포트별 위반 건수: ' + VPS.map((v) => `${v}=${fails.filter((r) => r.vp === v).length}`).join('  '));
L.push('');
if (fails.length) { L.push('=== 위반 목록 ==='); for (const r of fails) L.push(`FAIL | ${r.id.padEnd(11)} | ${r.vp.padEnd(8)} | ${r.rule.padEnd(4)} | ${r.val}`); L.push(''); }
L.push('=== 전체 일람표 (케이스 | 뷰포트 | 규칙 | 측정값 | 판정) ===');
for (const r of rows) L.push(`${r.id.padEnd(11)} | ${r.vp.padEnd(8)} | ${r.rule.padEnd(4)} | ${r.val} | ${r.pass ? 'PASS' : 'FAIL'}`);
fs.writeFileSync(outFile, L.join('\n') + '\n');
console.log(L.slice(0, 22).join('\n'));
const m10 = rows.filter((r) => r.id === 'M10' && r.vp === '834x1194');
console.log(`\n[834x1194 M10] 검사 ${m10.length}건 중 위반 ${m10.filter((r) => !r.pass).length}건: ` + m10.filter((r) => !r.pass).map((r) => r.rule).join(','));
