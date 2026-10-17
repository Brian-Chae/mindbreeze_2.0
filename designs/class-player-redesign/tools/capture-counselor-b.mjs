// 상담사 B안 시안 캡처·측정 스크립트 (Playwright는 frontend/node_modules 것을 읽기 전용으로 사용)
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.resolve(root, '../../frontend/package.json'));
const { chromium } = require('playwright');

const VIEWPORTS = [[390, 844], [834, 1194], [1194, 834], [1280, 720]];
// 스크린샷 상태 (n12 는 그리드를 맨 아래까지 스크롤)
const SHOT_STATES = { base: '', detail: '?detail=3', chat: '?tab=chat', n12: '?n=12' };
// 측정 전용 추가 상태
const EXTRA_STATES = {
  metric: '?tab=metric', media: '?tab=media', checkin: '?tab=checkin', tools: '?tab=tools',
  'detail-off': '?detail=4', 'detail-lost': '?detail=6', 'detail-warn': '?detail=5',
  n24: '?n=24', 'cam-off': '?cam=off', 'cam-off-media': '?cam=off&tab=media',
  focus: '?metric=focus', hrv: '?metric=hrv', 'bg1': '?bg=1', 'bg10': '?bg=10',
};
const CAMOFF_SHOTS = [[390, 844], [1280, 720]];
const url = (qs) => pathToFileURL(path.join(root, 'counselor-b.html')).href + qs;

function measure() {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const one = (sel) => { const el = [...document.querySelectorAll(sel)].find(vis); return el ? box(el) : null; };
  const inter = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y));

  // 11px 이하 글자
  let small = 0; const smallList = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) <= 11) { small++; smallList.push(el.className + ':' + el.textContent.trim().slice(0, 12)); }
  }
  // 텍스트 잘림
  const clipped = [];
  for (const el of document.body.querySelectorAll('.nm,.stl,.info h1 span,.info .sub,.chip,.chip span,.tb,.mnm,.mlb,.vh h2,.back,.who,.opt,.opt small,.seg,.pill,.row .tx b,.row .tx small,.note,.wbtn,.sv-chip,.sv-lb,.range,.ring small,.ring .nb,.ml,.btn,.leg span,.qa .q,.qa .a')) {
    if (!vis(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') clipped.push(el.className + ':' + el.textContent.trim().slice(0, 14) + ` (${el.scrollWidth}>${el.clientWidth})`);
  }
  // 영역 박스
  const named = { win: '#win', panel: '#panel', tabbar: '.tabbar', xbtn: '#btn-close', endbtn: '#btn-end', self: '#self', info: '.info', mstrip: '#mstrip:not([hidden])', gridwrap: '.gridwrap' };
  const boxes = {};
  for (const [k, sel] of Object.entries(named)) { const b = one(sel); if (b) boxes[k] = b; }
  const outside = [];
  for (const [k, b] of Object.entries(boxes)) if (b.x < -0.5 || b.y < -0.5 || b.r > vw + 0.5 || b.b > vh + 0.5) outside.push(k);
  // 자식이 부모 영역을 벗어남 (셀프뷰↔창, 버튼↔창, 타일 내부, 스트립/그리드↔패널)
  const contain = (inner, outer, k) => { if (inner && outer && (inner.x < outer.x - 0.5 || inner.y < outer.y - 0.5 || inner.r > outer.r + 0.5 || inner.b > outer.b + 0.5)) outside.push(k); };
  contain(boxes.self, boxes.win, 'self⊄win'); contain(boxes.xbtn, boxes.win, 'x⊄win'); contain(boxes.endbtn, boxes.win, 'end⊄win');
  contain(boxes.info, boxes.panel, 'info⊄panel'); contain(boxes.mstrip, boxes.panel, 'strip⊄panel'); contain(boxes.gridwrap, boxes.panel, 'grid⊄panel');
  // 겹침
  const overlaps = [];
  const names = Object.keys(boxes).filter((k) => !['info', 'mstrip', 'gridwrap'].includes(k));
  const allowed = new Set(['win×self', 'win×xbtn', 'win×endbtn', 'panel×info']);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], c = names[j];
    if (allowed.has(a + '×' + c)) continue;
    const area = inter(boxes[a], boxes[c]);
    if (area > 1) overlaps.push(`${a}×${c}(${Math.round(area)}px²)`);
  }
  for (const [a, c] of [['info', 'mstrip'], ['info', 'gridwrap'], ['mstrip', 'gridwrap']]) { if (boxes[a] && boxes[c] && inter(boxes[a], boxes[c]) > 1) overlaps.push(`${a}×${c}`); }
  // 타일 ↔ 타일, 타일 ↔ 셀프뷰/탭바/창 (그리드 가시 영역과 교차하는 타일만)
  const gw = boxes.gridwrap;
  const tiles = [...document.querySelectorAll('#grid .tile')].filter(vis).map((el) => ({ el, b: box(el) }));
  const visTiles = gw ? tiles.filter((t) => t.b.b > gw.y && t.b.y < gw.b) : [];
  let selfTile = 0, tileTile = 0, tileTab = 0, tileInner = 0;
  for (let i = 0; i < visTiles.length; i++) {
    const a = visTiles[i].b;
    if (boxes.self && inter(a, boxes.self) > 1) selfTile++;
    if (boxes.tabbar && inter(a, boxes.tabbar) > 1) tileTab++;
    for (let j = i + 1; j < visTiles.length; j++) if (inter(a, visTiles[j].b) > 1) tileTile++;
    // 타일 내부 요소가 타일 밖으로 나가는지
    for (const ch of visTiles[i].el.querySelectorAll('.ring,.nm,.stl')) { const c = box(ch); if (c.x < a.x - 0.5 || c.r > a.r + 0.5 || c.y < a.y - 0.5 || c.b > a.b + 0.5) tileInner++; }
  }
  // 그리드 스크롤 / 마지막 타일
  const sc = document.querySelector('#gridscroll');
  const gridScrollable = sc && vis(sc) ? sc.scrollHeight > sc.clientHeight + 1 : null;
  const lastTile = tiles.length ? tiles[tiles.length - 1].b : null;
  // 뷰 패널 넘침 (채팅 목록은 내부 스크롤이 정상)
  const viewOverflow = [];
  const vb = document.querySelector('#view .vb');
  if (vb && vis(vb)) { if (vb.scrollHeight > vb.clientHeight + 1) viewOverflow.push(`vb ${vb.scrollHeight}>${vb.clientHeight}`); }
  const vw_ = document.querySelector('#view');
  if (vw_ && vis(vw_) && vw_.scrollHeight > vw_.clientHeight + 1) viewOverflow.push(`view ${vw_.scrollHeight}>${vw_.clientHeight}`);
  // 터치 타깃 <44
  const small44 = [];
  for (const el of document.querySelectorAll('button, input[type=range]')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) small44.push(el.className + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  // 지표 띠 ↔ 타일 라벨/색 일치
  const nameEl = document.querySelector('#mstrip-name');
  const stripKey = nameEl && nameEl.dataset.key;
  const stripColor = nameEl && getComputedStyle(nameEl.querySelector('i')).backgroundColor;
  const labels = new Set(), arcs = new Set();
  document.querySelectorAll('#grid .tile:not(.away) .ring small').forEach((e) => labels.add(e.textContent.trim()));
  document.querySelectorAll('#grid .tile:not(.away) .rc-a').forEach((e) => arcs.add(getComputedStyle(e).stroke));
  const stripSize = nameEl ? parseFloat(getComputedStyle(nameEl).fontSize) : 0;
  // 호흡 지시 문구/애니메이션
  const animating = document.getAnimations().filter((a) => a.playState === 'running').length;
  return {
    vw, vh, scrollH: de.scrollHeight, scrollW: de.scrollWidth, bodyScrollH: document.body.scrollHeight,
    ok: de.scrollHeight <= vh && de.scrollWidth <= vw,
    small, smallList, clipped, outside, overlaps, selfTile, tileTile, tileTab, tileInner, viewOverflow, small44,
    gridScrollable, grid: sc && vis(sc) ? [sc.scrollHeight, sc.clientHeight] : null, tileCount: tiles.length,
    lastTileB: lastTile && Math.round(lastTile.b), gridB: gw && Math.round(gw.b), tabTop: boxes.tabbar && Math.round(boxes.tabbar.y),
    stripKey, stripColor, labels: [...labels], arcs: [...arcs], stripSize, animating,
    win: boxes.win && [Math.round(boxes.win.w), Math.round(boxes.win.h)], panel: boxes.panel && [Math.round(boxes.panel.w), Math.round(boxes.panel.h)],
    self: boxes.self && [Math.round(boxes.self.w), Math.round(boxes.self.h)],
    tile: tiles[0] && [Math.round(tiles[0].b.w), Math.round(tiles[0].b.h)],
    cols: tiles.length ? tiles.filter((t) => Math.abs(t.b.y - tiles[0].b.y) < 2).length : 0,
    range: (document.querySelector('#range') && !document.querySelector('#range').hidden) ? document.querySelector('#range').textContent : null,
    selfText: document.querySelector('#self') ? document.querySelector('#self').textContent.replace(/\s+/g, ' ').trim() : '',
  };
}

async function open(page, qs) {
  await page.goto(url(qs));
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1350); // 링 호 전환(1.2s) 종료 대기
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} }));
}
const scrollEnd = (page) => page.evaluate(() => { const sc = document.querySelector('#gridscroll'); sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); });

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--hide-scrollbars'] });
const results = [];
fs.mkdirSync(path.join(root, 'shots', 'extra'), { recursive: true });
for (const [w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const all = { ...SHOT_STATES, ...EXTRA_STATES };
  for (const [name, qs] of Object.entries(all)) {
    await open(page, qs);
    let endInfo = null;
    if (name === 'n12' || name === 'n24') { await scrollEnd(page); await page.waitForTimeout(100); }
    const m = await page.evaluate(measure);
    results.push({ vp: `${w}x${h}`, state: name, ...m });
    if (name in SHOT_STATES) await page.screenshot({ path: path.join(root, 'shots', `counselor-b-${w}x${h}-${name}.png`) });
    if (name === 'cam-off' && CAMOFF_SHOTS.some(([a, b]) => a === w && b === h)) await page.screenshot({ path: path.join(root, 'shots', 'extra', `counselor-b-${w}x${h}-camoff.png`) });
  }
  // 시작 상태에서 ?n=8 / 12 / 24 스크롤 여부 (맨 위 상태)
  for (const n of [8, 12, 24]) {
    await open(page, `?n=${n}`);
    const m = await page.evaluate(measure);
    results.push({ vp: `${w}x${h}`, state: `top-n${n}`, ...m });
  }
  // 상호작용: 타일 탭 → 상세, 탭 재탭 → 목록 복귀
  await open(page, '');
  await page.click('#grid .tile[data-id="3"]');
  const detailOpen = await page.evaluate(() => !document.querySelector('#view').hidden && !!document.querySelector('#view .minis'));
  await page.click('#view .back');
  const backToList = await page.evaluate(() => !document.querySelector('#list').hidden);
  await page.click('.tb[data-tab="media"]');
  const mediaOpen = await page.evaluate(() => !document.querySelector('#view').hidden);
  await page.click('.tb[data-tab="media"]');
  const mediaBack = await page.evaluate(() => !document.querySelector('#list').hidden);
  // 카메라 토글로 셀프뷰 전환
  await page.click('.tb[data-tab="media"]');
  await page.click('.sw[data-act="cam"]');
  const camToggled = await page.evaluate(() => document.querySelector('#self').classList.contains('off'));
  results.push({ vp: `${w}x${h}`, state: 'interaction', detailOpen, backToList, mediaOpen, mediaBack, camToggled });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(root, 'shots', 'counselor-b-fit.json'), JSON.stringify(results, null, 1));

// ── 리포트 ──
const R = results.filter((r) => r.state !== 'interaction' && !r.state.startsWith('top-n'));
const passOf = (r) => r.ok && r.small === 0 && !r.overlaps.length && !r.outside.length && !r.clipped.length && !r.viewOverflow.length && !r.small44.length && !r.selfTile && !r.tileTile && !r.tileTab && !r.tileInner && r.animating === 0;
const L = [];
L.push('MIND BREEZE 2.0 · 상담사 클래스 진행 화면 B안(Daylight Window) — 반응형·스크롤 실측 (counselor-b.html)');
L.push('측정: tools/capture-counselor-b.mjs (Playwright + Google Chrome, DPR 1). 페이지 스크롤은 documentElement scrollHeight<=innerHeight AND scrollWidth<=innerWidth.');
L.push('');
L.push('■ 1. 전 상태 종합 (스크롤 0 · ≤11px 0 · 겹침/이탈/잘림 0 · 터치<44 0 · 셀프뷰×타일 0 · 타일 내부 이탈 0 · 실행 중 애니메이션 0)');
L.push('뷰포트     | 상태         | scrollH/innerH | scrollW/innerW | ≤11px | 겹침 | 이탈 | 잘림 | 뷰넘침 | 터치<44 | 셀프×타일 | 타일겹침 | 판정');
L.push('-----------|--------------|----------------|----------------|-------|------|------|------|--------|---------|-----------|----------|-----');
let allOk = true;
for (const r of R) {
  const p = passOf(r); if (!p) allOk = false;
  L.push(`${r.vp.padEnd(10)} | ${r.state.padEnd(12)} | ${(r.scrollH + '/' + r.vh).padEnd(14)} | ${(r.scrollW + '/' + r.vw).padEnd(14)} | ${String(r.small).padEnd(5)} | ${String(r.overlaps.length).padEnd(4)} | ${String(r.outside.length).padEnd(4)} | ${String(r.clipped.length).padEnd(4)} | ${String(r.viewOverflow.length).padEnd(6)} | ${String(r.small44.length).padEnd(7)} | ${String(r.selfTile).padEnd(9)} | ${String(r.tileTile + r.tileTab + r.tileInner).padEnd(8)} | ${p ? 'PASS' : 'FAIL'}`);
}
L.push('');
L.push(`전체 판정: ${allOk ? 'PASS' : 'FAIL'}  (${R.length}개 조합)`);
const bad = R.filter((r) => !passOf(r));
if (bad.length) {
  L.push('', '--- 상세(실패 항목) ---');
  for (const r of bad) L.push(`[${r.vp} ${r.state}] 겹침=${r.overlaps.join(',') || '-'} 이탈=${r.outside.join(',') || '-'} 잘림=${r.clipped.join(' | ') || '-'} 뷰넘침=${r.viewOverflow.join(',') || '-'} 터치<44=${r.small44.join(',') || '-'} ≤11px=${r.smallList.join(',') || '-'} 셀프×타일=${r.selfTile} 타일겹침=${r.tileTile} 타일×탭바=${r.tileTab} 타일내부=${r.tileInner} 애니=${r.animating} 스크롤=${r.scrollH}/${r.vh},${r.scrollW}/${r.vw}`);
}
L.push('');
L.push('■ 2. 그리드 내부 스크롤 (맨 위 상태) — gridScrollable = scrollHeight > clientHeight');
L.push('뷰포트     | n=8                  | n=12                  | n=24                  | 타일(폭×높이) | 열');
for (const [w, h] of VIEWPORTS) {
  const g = (n) => results.find((r) => r.vp === `${w}x${h}` && r.state === `top-n${n}`);
  const f = (r) => `${r.gridScrollable ? '참' : '거짓'} (${r.grid[0]}/${r.grid[1]})`;
  L.push(`${(w + 'x' + h).padEnd(10)} | ${f(g(8)).padEnd(20)} | ${f(g(12)).padEnd(21)} | ${f(g(24)).padEnd(21)} | ${g(8).tile.join('×').padEnd(13)} | ${g(8).cols}`);
}
L.push('→ 기대: n=8 거짓 / n=12·n=24 참 (4개 뷰포트 공통).');
L.push('');
L.push('■ 3. 맨 아래까지 스크롤했을 때 마지막 타일 도달 / 탭바 가림');
for (const st of ['n12', 'n24']) for (const [w, h] of VIEWPORTS) {
  const r = results.find((x) => x.vp === `${w}x${h}` && x.state === st);
  const reach = r.lastTileB <= r.gridB + 1, hidden = r.lastTileB > r.tabTop;
  L.push(`${(w + 'x' + h).padEnd(10)} ${st}  마지막 타일 bottom ${r.lastTileB}  그리드 영역 bottom ${r.gridB}  탭바 top ${r.tabTop}  도달 ${reach ? 'O' : 'X'}  탭바 가림 ${hidden ? '있음' : '없음'}  범위칩 "${r.range}"  페이지 스크롤 ${r.scrollH}/${r.vh}`);
}
L.push('');
L.push('■ 4. 지표 띠 ↔ 타일 라벨/색 일치 (띠 지표 점 색 == 타일 링 호 색, 타일 라벨 1종 == 띠 지표 약칭)');
let mism = 0, checked = 0;
const SHORT = { focus: '집중', relax: '이완', emotion: '감정', bpm: 'BPM', resp: '호흡', hrv: 'HRV' };
for (const r of results.filter((x) => x.stripKey && x.arcs && x.arcs.length)) {
  checked++;
  const ok = r.labels.length === 1 && r.labels[0] === SHORT[r.stripKey] && r.arcs.length === 1 && r.arcs[0] === r.stripColor;
  if (!ok) { mism++; L.push(`  불일치 [${r.vp} ${r.state}] 띠=${r.stripKey} 라벨=${r.labels} 띠색=${r.stripColor} 호색=${r.arcs}`); }
}
L.push(`불일치 ${mism}건 / 검사 ${checked}건`);
for (const st of ['base', 'focus', 'hrv']) { const r = results.find((x) => x.vp === '390x844' && x.state === st); L.push(`  390x844 ${st.padEnd(5)} 띠=${r.stripKey} 라벨=${r.labels} 띠 지표명 ${r.stripSize}px 띠색=${r.stripColor} 호색=${r.arcs}`); }
L.push('');
L.push('■ 5. 셀프뷰');
for (const [w, h] of VIEWPORTS) {
  const on = results.find((r) => r.vp === `${w}x${h}` && r.state === 'base'), off = results.find((r) => r.vp === `${w}x${h}` && r.state === 'cam-off');
  L.push(`${(w + 'x' + h).padEnd(10)} 자연 창 ${on.win.join('×')} · 셀프뷰(ON) ${on.self.join('×')} "${on.selfText}" · 셀프뷰(OFF) ${off.self.join('×')} "${off.selfText}" · 타일과 겹침 ON ${on.selfTile} / OFF ${off.selfTile}`);
}
L.push('');
L.push('■ 6. 상호작용 (Playwright 클릭)');
for (const r of results.filter((x) => x.state === 'interaction')) L.push(`${r.vp.padEnd(10)} 타일 탭→상세 ${r.detailOpen ? 'O' : 'X'} · 목록 복귀 ${r.backToList ? 'O' : 'X'} · 미디어 탭 ${r.mediaOpen ? 'O' : 'X'} · 같은 탭 재탭→목록 ${r.mediaBack ? 'O' : 'X'} · 카메라 토글→셀프뷰 꺼짐 ${r.camToggled ? 'O' : 'X'}`);
fs.writeFileSync(path.join(root, 'shots', 'counselor-b-fit.txt'), L.join('\n') + '\n');
console.log(L.join('\n'));
