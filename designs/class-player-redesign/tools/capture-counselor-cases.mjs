// 상담사 화면 케이스(C01~C18) 캡처 + 실측.
// 사용: node tools/capture-counselor-cases.mjs [shots|measure]   (Playwright는 frontend/node_modules 것을 사용)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = path.resolve(HERE, '..');
const require = createRequire(path.resolve(D, '../../frontend/package.json'));
const { chromium } = require('playwright');

const mode = process.argv[2] || 'all';
const OUT = `${D}/shots/cases`;
fs.mkdirSync(OUT, { recursive: true });

const IDS = Array.from({ length: 18 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`);
const VP2 = [[390, 844], [1280, 720]];
const VP4 = [[390, 844], [834, 1194], [1194, 834], [1280, 720]];
const CORE = new Set(['C01', 'C04', 'C05', 'C09']);
const OFFLINE = new Set(['C04', 'C06']);
// 변형(추가 상태): [케이스, 이름, 쿼리]
const VARIANTS = [
  ['C02', 'hands', '&sheet=hands'], ['C04', 'media', '&sheet=media'], ['C08', 'help', '&sheet=permcam'],
  ['C10', 'help', '&sheet=permmic'], ['C11', 'paused', '&rec=paused'], ['C12', 'sheet', '&sheet=actions'],
  ['C14', 'sheet', '&sheet=queue'], ['C15', 'unworn', '&selfband=off'], ['C15', 'sheet', '&sheet=myband'],
  ['C16', 'down', '&net=down'], ['C17', 'ending', '&phase=ending'], ['C18', 'detail', '&detail=10'],
];

const measure = (offlineCase) => {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const R = e => e.getBoundingClientRect();
  const q = s => document.querySelector(s);
  const ending = document.body.classList.contains('ending');
  const out = { ending };

  // 11px 이하 텍스트
  const small = []; const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let nd;
  while ((nd = walker.nextNode())) { const t = nd.textContent.trim(); if (!t) continue; const el = nd.parentElement; if (!el || el.closest('script,style,svg')) continue; if (!vis(el) && getComputedStyle(el).position !== 'fixed') continue; if (parseFloat(getComputedStyle(el).fontSize) <= 11) small.push(t); }
  out.small = small.length; out.smallT = small.slice(0, 3);

  // 페이지 스크롤
  out.page = { sh: de.scrollHeight, ih: vh, sw: de.scrollWidth, iw: vw, bsh: document.body.scrollHeight, ok: de.scrollHeight <= vh && de.scrollWidth <= vw && document.body.scrollHeight <= vh && document.body.scrollWidth <= vw };

  // 블록 겹침·이탈
  const blocks = [];
  const add = (name, e) => { if (e && vis(e)) blocks.push({ name, r: R(e), e }); };
  if (!ending) {
    add('top', q('.top')); add('banner', q('#banner')); add('strip', q('#mstrip'));
    [...document.querySelectorAll('#chipline > .grp')].filter(vis).forEach((e, i) => add('chip' + i, e));
    add('more', q('#chipline .more'));
    const st = q('.stats'); if (st && st.parentElement.id === 'hl-meta') [...st.children].filter(vis).forEach((e, i) => add('stat' + i, e));
    add('slot', q('#selfview') || q('#sumpanel')); add('grid', q('#gridscroll')); add('dock', q('.dock'));
    const sheet = q('#sheet'); if (!sheet.hidden) add('sheet', sheet);
  } else add('ecard', q('.ecard'));
  out.outside = blocks.filter(b => b.r.left < -0.5 || b.r.top < -0.5 || b.r.right > vw + 0.5 || b.r.bottom > vh + 0.5).map(b => b.name);
  out.overlaps = [];
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], b = blocks[j];
    if ((a.name === 'sheet' && (b.name === 'grid' || b.name === 'dock')) || (b.name === 'sheet' && (a.name === 'grid' || a.name === 'dock'))) continue; // 바텀 시트가 그리드·도크를 덮는 것은 정상
    const px = inter(a.r, b.r); if (px > 1) out.overlaps.push(`${a.name}×${b.name}:${Math.round(px)}`);
  }
  // 보이는 타일끼리 · 타일(그리드 영역으로 잘린 부분)과 슬롯 겹침
  const sc = q('#gridscroll').getBoundingClientRect();
  const tiles = [...document.querySelectorAll('#grid .tile')];
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) if (inter(R(tiles[i]), R(tiles[j])) > 1) { out.overlaps.push('tile×tile'); i = tiles.length; break; }
  const slot = q('#selfview') || q('#sumpanel');
  if (slot) tiles.forEach(t => { const c = { left: Math.max(R(t).left, sc.left), right: Math.min(R(t).right, sc.right), top: Math.max(R(t).top, sc.top), bottom: Math.min(R(t).bottom, sc.bottom) }; if (c.right > c.left && c.bottom > c.top && inter(R(slot), c) > 1) out.overlaps.push('slot×tile'); });

  // 잘림(텍스트가 상자를 넘침)
  out.clipped = [];
  const chk = (sel, name) => document.querySelectorAll(sel).forEach(e => { if (!vis(e)) return; if (e.scrollWidth > e.clientWidth + 1) out.clipped.push(`${name}:${e.scrollWidth}>${e.clientWidth}`); });
  chk('.tile .st', 'tile-st'); chk('.tile .nm', 'tile-nm'); chk('.banner .bn-tx', 'banner'); chk('.mstrip .mtx', 'strip'); chk('.sumpanel .sp-r', 'sumrow'); chk('.sv-off', 'sv-off'); chk('.sv-lb', 'sv-lb'); chk('.ap', 'chip'); chk('.lrow', 'lrow'); chk('.ttl h1', 'title');
  const cl = q('#chipline'); if (cl) { const cr = cl.getBoundingClientRect(); [...cl.querySelectorAll(':scope > *')].filter(vis).forEach(e => { if (R(e).right > cr.right + 1) out.clipped.push('chipline-overflow'); }); }
  out.clipped = [...new Set(out.clipped)];

  // 터치 타깃
  out.tiny = []; document.querySelectorAll('button, input[type=text]').forEach(e => { if (!vis(e) || e.closest('[hidden]')) return; const r = R(e); if (r.height < 43.5 || r.width < 43.5) out.tiny.push(`${e.className || e.id}:${Math.round(r.width)}x${Math.round(r.height)}`); });
  out.tiny = [...new Set(out.tiny)].slice(0, 5);

  // 빈 영역: 배경/테두리가 있는 큰 박스에 텍스트·아이콘이 없는 경우
  out.empty = [];
  document.querySelectorAll('.app div, .app section, .app span, .app button, .app aside, .ecard, .ecard div').forEach(e => {
    if (!vis(e)) return; const r = R(e); if (r.width < 56 || r.height < 56) return;
    const cs = getComputedStyle(e); const bg = cs.backgroundColor; const hasBg = bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg);
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 && !/rgba\(0, 0, 0, 0\)/.test(cs.borderTopColor);
    if (!hasBg && !hasBorder) return;
    if (e.id === 'gridscroll' || e.classList.contains('gridwrap') || e.classList.contains('app')) return;
    if (e.textContent.trim() === '' && !e.querySelector('svg, input, img')) out.empty.push((e.className || e.id || e.tagName) + `:${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  // 헤드 행 좌측 빈칸: 슬롯 높이 대비 좌측 콘텐츠 하단 여백
  const head = q('#head'); out.headGap = null;
  if (head && vis(head)) { const a = R(q('#mstrip')), b = R(slot || q('#mstrip')); out.headGap = Math.round(Math.abs(a.height - b.height)); if (out.headGap > 2) out.empty.push(`head-height-diff:${out.headGap}`); }
  // 그리드 영역에 콘텐츠가 없는 경우
  out.gridEmpty = !ending && (q('#grid').children.length === 0 || R(q('#grid')).height < 40);
  if (out.gridEmpty) out.empty.push('grid');

  // 셀프뷰 내부 요소끼리 겹침(라벨·아이콘·안내 문구)
  out.svInner = [];
  { const sv = q('#selfview'); if (sv) { const parts = [...sv.querySelectorAll('.sv-lb, .sv-ic, .sv-off > *')].filter(vis); for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) { if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue; if (inter(R(parts[i]), R(parts[j])) > 1) out.svInner.push((parts[i].className.baseVal ?? parts[i].className) + '×' + (parts[j].className.baseVal ?? parts[j].className)); } const sr = R(sv); parts.forEach(pp => { const r = R(pp); if (r.left < sr.left - 0.5 || r.right > sr.right + 0.5 || r.top < sr.top - 0.5 || r.bottom > sr.bottom + 0.5) out.svInner.push('out:' + pp.className); }); } }
  if (out.svInner.length) out.overlaps.push('selfview-inner:' + out.svInner.join('/'));
  // 셀프뷰 / 오프라인 분기
  out.selfview = { inDom: !!q('#selfview'), visible: !!(q('#selfview') && vis(q('#selfview'))), sumpanel: !!q('#sumpanel'), camToggle: !!q('[data-act="cam"]'), dockVideoIcon: !!document.querySelector('.dock use[href="#i-video"]'), dockMicIcon: !!document.querySelector('.dock use[href="#i-mic"]') };
  // 지표 띠/라벨
  const nm = q('#mstrip-name'); out.strip = nm ? { key: nm.dataset.key, h: Math.round(R(q('#mstrip')).height), font: parseFloat(getComputedStyle(nm).fontSize) } : { key: null, h: Math.round(R(q('#mstrip')).height), note: q('#mstrip').textContent.trim().slice(0, 30) };
  const labels = [...new Set(tiles.map(t => t.querySelector('.ring small')).filter(Boolean).map(x => x.textContent.trim()))]; out.labels = labels;
  const gs = q('#gridscroll'); out.gridScroll = { scrollable: gs.scrollHeight > gs.clientHeight + 1, sh: gs.scrollHeight, ch: gs.clientHeight };
  out.banner = q('#banner') && vis(q('#banner')) ? q('#banner').textContent.trim().slice(0, 40) : '';
  out.chips = [...document.querySelectorAll('#chipline > .grp')].filter(vis).map(e => e.textContent.trim().replace(/\s+/g, ' '));
  out.more = (() => { const m = q('#chipline .more'); return m && vis(m) ? m.textContent.trim() : ''; })();
  out.tileCount = tiles.length;
  { const sh = q('#sheet'); out.sheetOver = sh.hidden ? 0 : Math.max(sh.querySelector('.sh-body').scrollHeight - sh.querySelector('.sh-body').clientHeight, sh.scrollHeight - sh.clientHeight); }
  return out;
};

const browser = await chromium.launch({ channel: 'chrome' });
const rows = [];
const jobs = [];
for (const id of IDS) for (const vp of VP4) jobs.push({ id, variant: '', q: '', vp });
for (const [id, variant, qs] of VARIANTS) for (const vp of VP2) jobs.push({ id, variant, q: qs, vp });

for (const j of jobs) {
  const [w, h] = j.vp; const vpn = `${w}x${h}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`file://${D}/counselor.html?case=${j.id}${j.q}`);
  await page.waitForTimeout(350);
  const name = `counselor-${j.id}${j.variant ? '-' + j.variant : ''}-${vpn}.png`;
  if (mode !== 'measure') await page.screenshot({ path: `${OUT}/${name}` });
  const r = await page.evaluate(measure, OFFLINE.has(j.id));
  // 오프라인: 미디어(녹음) 시트에서도 카메라 토글이 없는지 확인
  let offMedia = null;
  if (OFFLINE.has(j.id) && !j.variant) {
    await page.click('.dk[data-sheet="media"]'); await page.waitForTimeout(150);
    offMedia = await page.evaluate(() => ({ camToggle: !!document.querySelector('#sheet [data-act="cam"]'), camRow: /카메라/.test(document.querySelector('#sheet').textContent), title: document.querySelector('#sheet h2').textContent.trim() }));
  }
  const issues = [];
  if (!r.page.ok) issues.push('PAGE-SCROLL');
  if (r.small) issues.push('SMALL:' + r.smallT.join('/'));
  if (r.outside.length) issues.push('OUTSIDE:' + r.outside.join(','));
  if (r.overlaps.length) issues.push('OVERLAP:' + r.overlaps.join(','));
  if (r.clipped.length) issues.push('CLIP:' + r.clipped.join(','));
  if (r.tiny.length) issues.push('TAP<44:' + r.tiny.join(','));
  if (r.empty.length) issues.push('EMPTY:' + r.empty.join(','));
  if (r.sheetOver > 0) issues.push('SHEET-OVERFLOW:' + r.sheetOver);
  if (OFFLINE.has(j.id)) { const s = r.selfview; if (s.inDom || s.visible || s.camToggle || s.dockVideoIcon || !s.sumpanel || !s.dockMicIcon) issues.push('OFFLINE-LEAK:' + JSON.stringify(s)); if (offMedia && (offMedia.camToggle || offMedia.camRow)) issues.push('OFFLINE-MEDIA-CAM'); }
  rows.push({ ...j, vpn, r, offMedia, issues, name });
  await ctx.close();
}
await browser.close();

// 호흡 지시 문구 grep
const html = fs.readFileSync(`${D}/counselor.html`, 'utf8');
const breathHits = (html.match(/들이|내쉬|breathe|함께 호흡/g) || []).length;

const o = [];
o.push('MIND BREEZE 2.0 · 상담사 케이스 화면(C01~C18) 실측 — counselor.html?case=ID');
o.push('측정: Playwright(Google Chrome), DPR 1. 각 케이스×뷰포트에서 페이지 스크롤·11px 이하·겹침/이탈/잘림·터치<44·빈 영역·오프라인 분기를 검사.');
o.push(`호흡 지시 문구 grep -c "들이\\|내쉬\\|breathe\\|함께 호흡" counselor.html = ${breathHits}`);
o.push('');
o.push('■ 요약');
o.push(`- 조합 ${rows.length}개(18케이스 × 4뷰포트 + 변형 ${VARIANTS.length}종 × 2뷰포트) 중 이슈 ${rows.filter(x => x.issues.length).length}건`);
o.push(`- 페이지 스크롤 초과 ${rows.filter(x => !x.r.page.ok).length}건 / 11px 이하 텍스트 합계 ${rows.reduce((a, x) => a + x.r.small, 0)}개 / 겹침 ${rows.filter(x => x.r.overlaps.length).length}건 / 뷰포트 이탈 ${rows.filter(x => x.r.outside.length).length}건 / 잘림 ${rows.filter(x => x.r.clipped.length).length}건 / 터치<44 ${rows.filter(x => x.r.tiny.length).length}건 / 빈 영역 ${rows.filter(x => x.r.empty.length).length}건`);
const off = rows.filter(x => OFFLINE.has(x.id) && !x.variant);
o.push(`- 오프라인(C04·C06) ${off.length}조합: #selfview DOM 존재 ${off.filter(x => x.r.selfview.inDom).length}건, 카메라 토글(data-act=cam) ${off.filter(x => x.r.selfview.camToggle).length}건, 도크 카메라 아이콘 ${off.filter(x => x.r.selfview.dockVideoIcon).length}건, 도크 마이크(녹음) 아이콘 있음 ${off.filter(x => x.r.selfview.dockMicIcon).length}/${off.length}, 요약 패널 있음 ${off.filter(x => x.r.selfview.sumpanel).length}/${off.length}, 녹음 시트에 카메라 행/토글 ${off.filter(x => x.offMedia && (x.offMedia.camToggle || x.offMedia.camRow)).length}건`);
o.push('');
o.push('■ 케이스×뷰포트 상세  (pageH = scrollHeight/innerHeight · grid = 그리드 내부 스크롤 여부 scrollH/clientH · 슬롯 = 헤드 오른쪽 자리)');
o.push('ID(변형)        뷰포트    pageH       grid                  슬롯            띠(지표/높이)   타일 headGap  결과');
for (const x of rows) {
  const r = x.r; const slotTxt = r.selfview.inDom ? '셀프뷰' : (r.selfview.sumpanel ? '요약패널' : '-');
  const strip = r.strip.key ? `${r.strip.key}/${r.strip.h}px` : `안내/${r.strip.h}px`;
  o.push(`${(x.id + (x.variant ? '·' + x.variant : '')).padEnd(15)} ${x.vpn.padEnd(9)} ${`${r.page.sh}/${r.page.ih}`.padEnd(11)} ${(r.gridScroll.scrollable ? '스크롤 ' : '고정   ') + `${r.gridScroll.sh}/${r.gridScroll.ch}`.padEnd(12)} ${slotTxt.padEnd(8)} ${strip.padEnd(15)} ${String(r.tileCount).padStart(3)}  ${String(r.headGap ?? '-').padStart(5)}    ${x.issues.length ? 'FAIL ' + x.issues.join(' | ') : 'PASS'}`);
}
o.push('');
o.push('■ 칩 줄 / 배너 (390x844 기준; 한 줄 우선순위 생략 + 더보기)');
for (const x of rows.filter(x => x.vpn === '390x844' && !x.variant)) o.push(`${x.id}  칩=[${x.r.chips.join(' | ')}]${x.r.more ? ' 더보기=' + x.r.more : ''}${x.r.banner ? '  배너="' + x.r.banner + '"' : ''}`);
fs.writeFileSync(`${OUT}/counselor-cases-fit.txt`, o.join('\n') + '\n');
console.log(o.slice(0, 8).join('\n'));
for (const x of rows.filter(x => x.issues.length)) console.log(`!! ${x.id}${x.variant ? '·' + x.variant : ''} ${x.vpn}: ${x.issues.join(' | ')}`);
fs.writeFileSync('/tmp/cases-measure.json', JSON.stringify(rows.map(({ r, ...rest }) => ({ ...rest, r })), null, 1));
