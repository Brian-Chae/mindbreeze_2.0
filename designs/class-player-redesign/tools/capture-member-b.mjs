// 회원 B안(Daylight Window) 캡처·측정 스크립트 (Playwright는 frontend/node_modules 것을 읽기 전용으로 사용)
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.resolve(root, '../../frontend/package.json'));
const { chromium } = require('playwright');

const VIEWPORTS = [[390, 844], [834, 1194], [1194, 834], [1280, 720]];
const SHOT_STATES = { base: '', chat: '?tab=chat', noband: '?band=off', sound: '?tab=sound' };
const EXTRA_STATES = {
  signal: '?tab=signal', device: '?tab=device', 'noband-device': '?band=off&tab=device', 'noband-chat': '?band=off&tab=chat',
  nopip: '?pip=off', 'metric-resp': '?metric=respiration', 'metric-focus': '?metric=focus', 'metric-bpm': '?metric=bpm',
  'bg1': '?bg=1', 'bg4': '?bg=4', 'bg5': '?bg=5', 'bg10': '?bg=10',
};
const SCALE = [12, 13, 15, 18, 24, 36, 56];
const url = (qs) => pathToFileURL(path.join(root, 'member-b.html')).href + qs;

function measure(scale) {
  const vw = innerWidth, vh = innerHeight, de = document.documentElement;
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const one = (sel) => { const el = [...document.querySelectorAll(sel)].find(vis); return el ? box(el) : null; };

  // 텍스트 크기: 11px 이하 / 스케일 밖
  let small = 0; const smallList = []; const offScale = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    if (!([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const tx = (el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ':' + el.textContent.trim().slice(0, 10);
    if (fs <= 11) { small++; smallList.push(tx); }
    if (!scale.includes(fs)) offScale.push(tx + '=' + fs);
  }

  // 텍스트 잘림(가로)
  const clipped = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    if (!([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))) continue;
    if (getComputedStyle(el).display === 'inline') continue;
    if (el.scrollWidth > el.clientWidth + 1) clipped.push((el.className || el.tagName) + ':' + el.textContent.trim().slice(0, 12) + ` (${el.scrollWidth}>${el.clientWidth})`);
  }

  // 창 오버레이 이탈·겹침
  const names = { leave: '#leave', conn: '#conn', time: '.w-time', title: '.w-title', bar: '.w-bar', pip: '.pip' };
  const boxes = {};
  for (const [k, sel] of Object.entries(names)) { const b = one(sel); if (b) boxes[k] = b; }
  const wb = one('.window');
  const outside = [];
  for (const [k, b] of Object.entries(boxes)) {
    if (b.x < wb.x - 0.5 || b.y < wb.y - 0.5 || b.r > wb.r + 0.5 || b.b > wb.b + 0.5) outside.push(k);
  }
  const inter = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y));
  const overlaps = [];
  const ks = Object.keys(boxes);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = inter(boxes[ks[i]], boxes[ks[j]]);
    if (a > 1) overlaps.push(`${ks[i]}×${ks[j]}(${Math.round(a)}px²)`);
  }
  // 구역(창·패널·탭바) 서로 겹침 / 뷰포트 이탈
  const zones = { window: '.window', panel: '.panel-card', tabbar: '.tabbar' };
  const zb = {};
  for (const [k, sel] of Object.entries(zones)) { const b = one(sel); if (b) zb[k] = b; }
  for (const [k, b] of Object.entries(zb)) if (b.x < -0.5 || b.y < -0.5 || b.r > vw + 0.5 || b.b > vh + 0.5) outside.push(k);
  const zk = Object.keys(zb);
  for (let i = 0; i < zk.length; i++) for (let j = i + 1; j < zk.length; j++) {
    const a = inter(zb[zk[i]], zb[zk[j]]);
    if (a > 1) overlaps.push(`${zk[i]}×${zk[j]}(${Math.round(a)}px²)`);
  }

  // 패널 내용이 패널 밖으로 잘리는지 (채팅 목록 내부는 스크롤 허용이라 제외)
  const panelClip = [];
  const pc = document.querySelector('.panel-card'); const pcb = box(pc);
  const cs = getComputedStyle(pc);
  const inner = { r: pcb.r - parseFloat(cs.paddingRight) - 1, b: pcb.b - parseFloat(cs.paddingBottom) - 1 };
  const tp = [...document.querySelectorAll('.tp')].find(vis);
  if (tp) {
    for (const el of tp.querySelectorAll('*')) {
      if (!vis(el) || el.closest('.msgs')) continue;
      const b = box(el);
      if (b.b > inner.b + 0.5 || b.r > inner.r + 0.5) panelClip.push((el.className.baseVal === undefined ? el.className : el.tagName) + ` b=${Math.round(b.b)}>${Math.round(inner.b)} r=${Math.round(b.r)}>${Math.round(inner.r)}`);
    }
    if (tp.scrollHeight > tp.clientHeight + 1) panelClip.push(`tp ${tp.scrollHeight}>${tp.clientHeight}`);
  }
  if (pc.scrollHeight > pc.clientHeight + 1) panelClip.push(`panel ${pc.scrollHeight}>${pc.clientHeight}`);

  // 터치 타깃 <44px
  const small44 = [];
  for (const el of document.querySelectorAll('button, input[type=range], input[type=text], .switch')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) small44.push((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }

  // 사진 노출률: 창 면적 중 UI(버튼·정보·PiP)가 가린 비율
  let windowClear = null;
  if (wb) {
    const cov = document.createElement('canvas'); cov.width = Math.ceil(wb.w); cov.height = Math.ceil(wb.h);
    const g = cov.getContext('2d'); g.fillStyle = '#000';
    for (const k of ['leave', 'conn', 'time', 'title', 'bar', 'pip']) { const b = boxes[k]; if (b) g.fillRect(b.x - wb.x, b.y - wb.y, b.w, b.h); }
    const d = g.getImageData(0, 0, cov.width, cov.height).data; let c = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) c++;
    windowClear = 1 - c / (cov.width * cov.height);
  }
  return {
    vw, vh, scrollH: de.scrollHeight, scrollW: de.scrollWidth, bodyScrollH: document.body.scrollHeight,
    ok: de.scrollHeight <= vh && de.scrollWidth <= vw,
    small, smallList, offScale, clipped, outside, overlaps, panelClip, small44, windowClear,
    win: wb && [Math.round(wb.w), Math.round(wb.h)], panel: zb.panel && [Math.round(zb.panel.w), Math.round(zb.panel.h)],
  };
}

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--hide-scrollbars'] });
const results = [];
fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
for (const [w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name, qs] of [...Object.entries(SHOT_STATES), ...Object.entries(EXTRA_STATES)]) {
    await page.goto(url(qs));
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} }));
    const m = await page.evaluate(measure, SCALE);
    results.push({ vp: `${w}x${h}`, state: name, required: name in SHOT_STATES, ...m });
    if (name in SHOT_STATES) await page.screenshot({ path: path.join(root, 'shots', `member-b-${w}x${h}-${name}.png`) });
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(root, 'shots', 'member-b-fit.json'), JSON.stringify(results, null, 1));

const L = [];
L.push('MIND BREEZE 2.0 · 회원 클래스 진행 화면 B안(Daylight Window) — 반응형 측정 리포트');
L.push('파일: designs/class-player-redesign/member-b.html · 측정: tools/capture-member-b.mjs (Playwright + Chrome, DPR 1)');
L.push('판정: scrollHeight<=innerHeight AND scrollWidth<=innerWidth, ≤11px 텍스트 0, 타이포 스케일(12/13/15/18/24/36/56) 이탈 0, 겹침/이탈/텍스트 잘림/패널 잘림 0, 터치<44 0');
L.push('');
const head = '뷰포트     | 상태          | scrollH/innerH | scrollW/innerW | ≤11px | 스케일외 | 겹침 | 이탈 | 잘림 | 패널잘림 | 터치<44 | 창 사진노출 | 창 WxH    | 판정';
L.push(head);
L.push(head.replace(/[^|]/g, '-'));
let allOk = true, reqOk = true;
for (const r of results) {
  const pass = r.ok && r.small === 0 && !r.offScale.length && !r.overlaps.length && !r.outside.length && !r.clipped.length && !r.panelClip.length && !r.small44.length;
  if (!pass) { allOk = false; if (r.required) reqOk = false; }
  L.push(`${r.vp.padEnd(10)} | ${r.state.padEnd(13)} | ${(r.scrollH + '/' + r.vh).padEnd(14)} | ${(r.scrollW + '/' + r.vw).padEnd(14)} | ${String(r.small).padEnd(5)} | ${String(r.offScale.length).padEnd(8)} | ${String(r.overlaps.length).padEnd(4)} | ${String(r.outside.length).padEnd(4)} | ${String(r.clipped.length).padEnd(4)} | ${String(r.panelClip.length).padEnd(8)} | ${String(r.small44.length).padEnd(7)} | ${(r.windowClear * 100).toFixed(1).padStart(6)}%     | ${String(r.win).padEnd(9)} | ${pass ? 'PASS' : 'FAIL'}`);
}
L.push('');
L.push(`필수 16조합(4뷰포트 × base/chat/noband/sound) 판정: ${reqOk ? 'PASS' : 'FAIL'}`);
L.push(`전체 ${results.length}조합(추가 상태·배경·지표 변형 포함) 판정: ${allOk ? 'PASS' : 'FAIL'}`);
const details = results.filter((r) => r.overlaps.length || r.outside.length || r.clipped.length || r.panelClip.length || r.small44.length || r.small || r.offScale.length || !r.ok);
if (details.length) {
  L.push('', '--- 상세(실패 항목) ---');
  for (const r of details) L.push(`[${r.vp} ${r.state}] 겹침=${r.overlaps.join(',') || '-'} 이탈=${r.outside.join(',') || '-'} 잘림=${r.clipped.join(' | ') || '-'} 패널잘림=${r.panelClip.join(' | ') || '-'} 터치<44=${r.small44.join(',') || '-'} ≤11px=${r.smallList.join(',') || '-'} 스케일외=${r.offScale.join(',') || '-'}`);
}
fs.writeFileSync(path.join(root, 'shots', 'member-b-fit.txt'), L.join('\n') + '\n');
console.log(L.join('\n'));
