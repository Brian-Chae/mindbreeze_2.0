// 상담사 화면 좌우 대칭·비율 측정 (균형.md S1~S10, CS1~CS5)
// 사용: node tools/measure-symmetry-counselor.mjs before|after
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = path.resolve(HERE, '..');
const require = createRequire(path.resolve(D, '../../frontend/package.json'));
const { chromium } = require('playwright');

const which = process.argv[2] === 'before' ? 'before' : 'after';
const OUT = `${D}/shots/cases/counselor-symmetry${which === 'before' ? '-before' : ''}.txt`;
const VPS = [[390, 844], [834, 1194], [1194, 834], [1280, 720]];
const IDS = Array.from({ length: 18 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);
const EXTRA = [
  ['C01', 'sheet-chat', '&sheet=chat'], ['C01', 'sheet-media', '&sheet=media'], ['C01', 'detail', '&detail=3'],
  ['C01', 'n6', '&n=6'], ['C01', 'n12', '&n=12'], ['C01', 'n7', '&n=7'], ['C01', 'cam-big', '&cam=big'], ['C01', 'table', '&table=1'],
  ['C04', 'sheet-media', '&sheet=media'], ['C05', 'sheet-media', '&sheet=media'], ['C18', 'sheet-chat', '&sheet=chat'], ['C02', 'sheet-hands', '&sheet=hands'],
];
const jobs = [];
for (const id of IDS) for (const vp of VPS) jobs.push({ id, variant: '', q: '', vp });
for (const [id, variant, q] of EXTRA) for (const vp of VPS) jobs.push({ id, variant, q, vp });

const measure = () => {
  const vw = innerWidth, vh = innerHeight;
  const q = s => document.querySelector(s);
  const vis = e => { if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const R = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
  const res = [];
  const add = (rule, name, value, ok, unit = 'px') => res.push({ rule, name, value: typeof value === 'number' ? Math.round(value * 10) / 10 : value, ok, unit });
  const TOL = 2;

  if (document.body.classList.contains('ending')) {
    const c = R(q('.ecard'));
    add('S1', '종료화면 카드 가로중심', Math.abs(c.cx - vw / 2), Math.abs(c.cx - vw / 2) <= TOL);
    add('S2', '종료화면 카드 좌우여백', Math.abs(c.left - (vw - c.right)), Math.abs(c.left - (vw - c.right)) <= TOL);
    add('S1', '종료화면 카드 세로중심', Math.abs(c.cy - vh / 2), Math.abs(c.cy - vh / 2) <= vh * 0.08);
    return res;
  }
  const modal = q('#modal');
  if (modal && !modal.hidden) {
    const c = R(q('.mcard'));
    add('S1', '종료확인 모달 가로중심', Math.abs(c.cx - vw / 2), Math.abs(c.cx - vw / 2) <= TOL);
  }

  const top = R(q('.top'));
  const col = R(q('.col'));
  const sheetEl = q('#sheet');
  const sheetOpen = !sheetEl.hidden && vis(sheetEl);
  const sheetInFlow = sheetOpen && getComputedStyle(sheetEl).position !== 'fixed';
  const axis = col.cx;
  const mainW = col.width;

  // S3 상단 바
  const close = R(q('#btn-close')), end = R(q('#btn-end')), ttl = R(q('.ttl'));
  const lm = close.left - top.left, rm = top.right - end.right;
  add('S3', '상단바 좌/우 바깥여백 차', Math.abs(lm - rm), Math.abs(lm - rm) <= TOL);
  add('S3', '상단바 좌/우 버튼 높이 차', Math.abs(close.height - end.height), Math.abs(close.height - end.height) <= TOL);
  add('S3', '상단바 제목 중앙', Math.abs(ttl.cx - top.cx), Math.abs(ttl.cx - top.cx) <= TOL);
  add('S2', '상단바 좌우여백', Math.abs(top.left - (vw - top.right)), Math.abs(top.left - (vw - top.right)) <= TOL);

  // 메인 컬럼 블록
  const blocks = [];
  const addBlock = (name, sel, mustCenter = true) => { const e = typeof sel === 'string' ? q(sel) : sel; if (vis(e)) blocks.push({ name, r: R(e), mustCenter }); };
  addBlock('배너', '#banner'); addBlock('헤드 행', '#head'); addBlock('칩 줄', '#chipline'); addBlock('그리드 영역', '#gridscroll'); addBlock('도크', '.dock');
  for (const b of blocks) {
    add('S2', `${b.name} 좌우여백(메인영역 기준)`, Math.abs((b.r.left - col.left) - (col.right - b.r.right)), Math.abs((b.r.left - col.left) - (col.right - b.r.right)) <= TOL);
    add('S1', `${b.name} 가로중심 = 메인축`, Math.abs(b.r.cx - axis), Math.abs(b.r.cx - axis) <= TOL);
  }
  // S8 배너·헤드·칩 줄 같은 폭
  const w8 = blocks.filter(b => ['배너', '헤드 행', '칩 줄'].includes(b.name));
  if (w8.length > 1) { const ws = w8.map(b => b.r.width); add('S8', `배너·헤드·칩 줄 폭 편차(${w8.map(b => b.name).join('/')})`, Math.max(...ws) - Math.min(...ws), Math.max(...ws) - Math.min(...ws) <= TOL); }
  // S9 본문 컬럼 최대폭
  const head = blocks.find(b => b.name === '헤드 행');
  if (head) add('S9', '본문 컬럼 폭(≤1040)', head.r.width, head.r.width <= 1040);
  // S10 간격 스케일
  const flow = [['상단바', top], ...blocks.filter(b => b.name !== '그리드 영역' || true).map(b => [b.name, b.r])].sort((a, b) => a[1].top - b[1].top);
  const okSet = [8, 16, 24, 32, 40, 48];
  for (let i = 0; i < flow.length - 1; i++) { const g = flow[i + 1][1].top - flow[i][1].bottom; if (g < 0) continue; add('S10', `간격 ${flow[i][0]}→${flow[i + 1][0]}`, g, okSet.includes(Math.round(g))); }
  add('S10', '화면 좌우 바깥여백', top.left, okSet.includes(Math.round(top.left)));
  add('S10', '화면 상단 바깥여백', top.top, okSet.includes(Math.round(top.top)));

  // S6 도크 균등
  const dock = R(q('.dock')); const items = [...document.querySelectorAll('.dock .dk')].filter(vis).map(R);
  if (items.length > 1) {
    const ws = items.map(i => i.width), gaps = items.slice(1).map((i, k) => i.left - items[k].right);
    add('S6', '도크 항목 폭 편차', Math.max(...ws) - Math.min(...ws), Math.max(...ws) - Math.min(...ws) <= TOL);
    add('S6', '도크 항목 간격 편차', Math.max(...gaps) - Math.min(...gaps), Math.max(...gaps) - Math.min(...gaps) <= TOL);
    add('S6', '도크 안쪽 좌우여백 차', Math.abs((items[0].left - dock.left) - (dock.right - items.at(-1).right)), Math.abs((items[0].left - dock.left) - (dock.right - items.at(-1).right)) <= TOL);
    const need = Math.min(mainW * 0.92, 560);
    add('S6', `도크 폭 ≥ min(메인폭×0.92, 560)=${Math.round(need)}`, dock.width, dock.width >= need - 1);
  }

  // S5 시트
  if (sheetOpen) {
    const s = R(sheetEl);
    const portrait = vw < vh; const sideAllowed = vw >= 1000 && !portrait;
    if (!sideAllowed) {
      add('S5', '세로형/모바일: 사이드 시트 금지(시트 인플로우 아님)', sheetInFlow ? '사이드' : '바텀', !sheetInFlow, '');
      add('S5', '바텀 시트 좌우여백 차', Math.abs(s.left - (vw - s.right)), Math.abs(s.left - (vw - s.right)) <= TOL);
      add('S5', '바텀 시트 최대폭 ≤ 640', s.width, s.width <= 640 + 1);
      add('S5', '바텀 시트 화면 하단 밀착', Math.abs(s.bottom - vh), Math.abs(s.bottom - vh) <= 16);
    } else {
      add('S5', '가로형: 사이드 시트 사용', sheetInFlow ? '사이드' : '바텀', sheetInFlow, '');
      add('S5', '사이드 시트: 메인영역 좌 여백 = 시트 우 여백', Math.abs(col.left - (vw - s.right)), Math.abs(col.left - (vw - s.right)) <= TOL);
      add('S5', '사이드 시트: 메인영역-시트 겹침 없음', Math.max(0, col.right - s.left), col.right <= s.left + 0.5);
    }
  }

  // CS1·CS2 타일 그리드
  const sc = R(q('#gridscroll'));
  const tiles = [...document.querySelectorAll('#grid .tile')].filter(vis);
  const solo = !!q('.solo');
  if (tiles.length) {
    const rows = new Map();
    tiles.forEach(t => { const r = R(t); const k = Math.round(r.top); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(r); });
    let worst = 0, worstLast = 0; const keys = [...rows.keys()].sort((a, b) => a - b);
    keys.forEach((k, i) => { const rs = rows.get(k); const l = Math.min(...rs.map(r => r.left)) - sc.left, r = sc.right - Math.max(...rs.map(r => r.right)); const d = Math.abs(l - r); if (i === keys.length - 1) worstLast = d; worst = Math.max(worst, d); });
    add('CS1', '그리드 각 행 좌우여백 차(최대)', worst, worst <= TOL);
    add('CS2', '마지막 행 좌우여백 차', worstLast, worstLast <= TOL);
    const n = tiles.length; const cols = rows.get(keys[0]).length;
    const tw = tiles[0].getBoundingClientRect().width;
    const minW = vw < 600 ? 140 : 170; const gapPx = vw < 600 ? 8 : 14;
    const cap = Math.min(vw < 600 ? 2 : (vw < 1000 ? 4 : 5), Math.max(2, Math.floor((sc.width - 6 + gapPx) / (minW + gapPx))));
    const divisors = []; for (let c = 2; c <= cap; c++) if (n % c === 0) divisors.push(c);
    const okCols = divisors.length ? n % cols === 0 : true;
    if (n >= 4 && !document.querySelector('.tbl')) add('CS2', `열 수 ${cols}열 · ${n}명 · 균등분배 가능 열 ${divisors.join('/') || '없음'}`, n % cols === 0 ? '나누어떨어짐' : `마지막 행 ${n % cols}개`, okCols, '');
  }

  // CS3 헤드 행
  const strip = q('#mstrip'), slot = q('#selfview') || q('#sumpanel');
  if (vis(strip) && vis(slot)) {
    const a = R(strip), b = R(slot), h = R(q('#head'));
    add('CS3', '헤드 행 띠/슬롯 높이 차', Math.abs(a.height - b.height), Math.abs(a.height - b.height) <= TOL);
    add('CS3', '헤드 행 띠/슬롯 상단 정렬 차', Math.abs(a.top - b.top), Math.abs(a.top - b.top) <= TOL);
    const total = a.width + b.width; const ratio = a.width / total * 100; const target = vw < 600 ? 62 : 66;
    add('CS3', `띠:슬롯 비율 ${Math.round(ratio)}:${Math.round(100 - ratio)} (목표 ${target}:${100 - target})`, Math.abs(ratio - target), Math.abs(ratio - target) <= 3, '%p');
    add('CS3', '헤드 행 바깥 좌/우 여백 차(띠 좌 / 슬롯 우)', Math.abs((a.left - h.left) - (h.right - b.right)), Math.abs((a.left - h.left) - (h.right - b.right)) <= TOL);
    add('CS3', '슬롯 크기 ≥ 띠 높이의 90%(구석에 뜬 작은 박스 금지)', b.height, b.height >= a.height * 0.9);
  }

  // CS4 칩 줄
  const chips = [...document.querySelectorAll('#chipline > .grp')].filter(vis).map(R);
  const more = q('#chipline .more');
  if (vis(more)) chips.push(R(more));
  if (chips.length) {
    const cl = R(q('#chipline')); const l = Math.min(...chips.map(c => c.left)), r = Math.max(...chips.map(c => c.right));
    add('CS4', '칩 묶음 중심 = 칩 줄 중심', Math.abs((l + r) / 2 - cl.cx), Math.abs((l + r) / 2 - cl.cx) <= TOL);
    add('S1', '칩 묶음 가로중심 = 메인축', Math.abs((l + r) / 2 - axis), Math.abs((l + r) / 2 - axis) <= TOL);
  }

  // CS5 1:1 카드
  if (solo) {
    const wrap = R(q('.solo'));
    add('CS5', '1:1 카드 묶음 가로중심 = 메인축', Math.abs(wrap.cx - axis), Math.abs(wrap.cx - axis) <= TOL);
    const minis = [...document.querySelectorAll('.solo .mini')].map(R);
    if (minis.length === 6) {
      const ws = minis.map(m => m.width), hs = minis.map(m => m.height);
      add('CS5', '6지표 카드 크기 편차(w/h)', Math.max(Math.max(...ws) - Math.min(...ws), Math.max(...hs) - Math.min(...hs)), Math.max(...ws) - Math.min(...ws) <= TOL && Math.max(...hs) - Math.min(...hs) <= TOL);
      const row1 = minis.slice(0, 3), row2 = minis.slice(3);
      const g1 = [row1[1].left - row1[0].right, row1[2].left - row1[1].right, row2[1].left - row2[0].right, row2[2].left - row2[1].right];
      add('CS5', '6지표 3×2 격자 가로 간격 편차', Math.max(...g1) - Math.min(...g1), Math.max(...g1) - Math.min(...g1) <= TOL);
      const aligned = [0, 1, 2].every(i => Math.abs(row1[i].left - row2[i].left) <= TOL);
      add('CS5', '6지표 2행 열 정렬(3×2)', aligned ? 0 : 1, aligned, '');
    }
    const tr = q('.solo .trend'), ck = q('.solo .qas');
    if (vis(tr) && vis(ck)) { const a = R(tr), b = R(ck); add('CS5', '5분 추이 / 체크인 카드 폭 차', Math.abs(a.width - b.width), Math.abs(a.width - b.width) <= TOL); }
  }
  return res;
};

const browser = await chromium.launch({ channel: 'chrome' });
const lines = []; const per = {}; let total = 0, fails = 0; const failRows = [];
for (const j of jobs) {
  const [w, h] = j.vp;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`file://${D}/counselor.html?case=${j.id}${j.q}`);
  await page.waitForTimeout(350);
  const res = await page.evaluate(measure);
  for (const r of res) {
    total++; const key = r.rule; per[key] = per[key] || { pass: 0, fail: 0 };
    if (r.ok) per[key].pass++; else { per[key].fail++; fails++; failRows.push({ ...j, vpn: `${w}x${h}`, r }); }
    lines.push(`${(j.id + (j.variant ? '·' + j.variant : '')).padEnd(16)} ${(w + 'x' + h).padEnd(9)} ${r.rule.padEnd(4)} ${r.name.padEnd(58)} ${String(r.value).padStart(8)}${r.unit} ${r.ok ? 'PASS' : 'FAIL'}`);
  }
  await ctx.close();
}
await browser.close();

const failCases = new Set(failRows.map(f => `${f.id}${f.variant ? '·' + f.variant : ''}|${f.vpn}`));
const head = [];
head.push(`MIND BREEZE 2.0 · 상담사 좌우 대칭·비율 측정 (${which === 'before' ? '수정 전' : '수정 후'}) — 균형.md S1~S10, CS1~CS5`);
head.push('측정: Playwright(Google Chrome), getBoundingClientRect. 허용오차 ±2px(비율 ±3%p). 기준축 = 사이드 시트를 뺀 메인 영역(.col) 가로 중심.');
head.push('적용 제외: S7(링 세로 중앙)·S4(PiP 짝)·MS*는 회원 화면 규칙이며 상담사는 CS3(헤드 행 띠:셀프뷰)로 대체.');
head.push('');
head.push('■ 요약');
head.push(`- 측정 조합 ${jobs.length}개(18케이스×4뷰포트 + 변형 ${EXTRA.length}종×4뷰포트), 검사 항목 ${total}건, 위반 ${fails}건, 위반이 있는 조합 ${failCases.size}개`);
for (const k of Object.keys(per).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) head.push(`  ${k.padEnd(4)} 검사 ${String(per[k].pass + per[k].fail).padStart(4)}  위반 ${String(per[k].fail).padStart(4)}`);
const byVp = {}; failRows.forEach(f => { byVp[f.vpn] = (byVp[f.vpn] || 0) + 1; });
head.push('  뷰포트별 위반: ' + VPS.map(v => `${v[0]}x${v[1]}=${byVp[v.join('x')] || 0}`).join(', '));
head.push('');
if (failRows.length) {
  head.push('■ 위반 대표(규칙별 첫 3건)');
  const seen = {}; for (const f of failRows) { seen[f.r.rule] = (seen[f.r.rule] || 0) + 1; if (seen[f.r.rule] <= 3) head.push(`  ${f.r.rule} ${f.id}${f.variant ? '·' + f.variant : ''} ${f.vpn}: ${f.r.name} = ${f.r.value}${f.r.unit}`); }
  head.push('');
}
head.push('■ 일련표 (케이스 · 뷰포트 · 규칙 ID · 항목 · 측정값 · 결과)');
fs.writeFileSync(OUT, head.join('\n') + '\n' + lines.join('\n') + '\n');
console.log(head.slice(0, 22).join('\n'));
