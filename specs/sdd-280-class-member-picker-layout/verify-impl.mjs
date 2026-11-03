// SDD-280 구현 레이아웃 측정. 실행(frontend 에서 vite --port 5290 기동 후): cp ../specs/sdd-280-class-member-picker-layout/verify-impl.mjs ./.verify-impl.tmp.mjs && node .verify-impl.tmp.mjs
// (playwright 모듈 해석 때문에 frontend 안에서 실행. 결과는 ../specs/sdd-280-class-member-picker-layout/ 에 저장)
// vite dev(127.0.0.1:5290) + API는 page.route 목(합성 데이터, 실제 서버·prod 접속 없음).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const here = resolve(process.cwd(), '../specs/sdd-280-class-member-picker-layout');
const ORIGIN = 'http://127.0.0.1:5290';
const shotsDir = resolve(here, 'shots-impl'); mkdirSync(shotsDir, { recursive: true });
const SCREENS = [[1440, 900], [1280, 720], [1024, 768], [390, 844], [1280, 600], [390, 600]];
const COUNTS = [0, 4, 20, 60];
const ROLES = ['org_admin', 'counselor'];
const SELECTED = [0, 12];

const members = n => Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, name: `회원${String(i + 1).padStart(2, '0')}`, masked_email: `u${i + 1}***@test.com` }));
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(page, role, count) {
  const user = { id: 'u1', name: '지도사', email: 'c@test.com', role };
  await page.addInitScript(u => localStorage.setItem('mb_user', JSON.stringify(u)), user);
  await page.route(/\/auth\/refresh/, r => json(r, { access_token: 'tok' }));
  await page.route(/\/classes\/instructor-candidates/, r => json(r, { instructors: [{ id: 'u1', name: '지도사' }] }));
  await page.route(/\/classes\/member-candidates/, r => {
    const q = new URL(r.request().url()).searchParams.get('q') ?? '';
    json(r, { members: members(count).filter(m => !q || m.name.includes(q)), has_more: false });
  });
  await page.route(/\/classes\/preview-schedule/, r => json(r, { rows: [{ client_key: 'regular:2026-12-21', seq: 1, scheduled_at: '2026-12-21T10:00:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' }));
  await page.route(/\/api\/v1\/.*/, r => (r.request().url().match(/auth\/refresh|instructor-candidates|member-candidates|preview-schedule/) ? r.fallback() : json(r, {})));
}

async function toStep4(page, selectN) {
  await page.goto(`${ORIGIN}/classes/new`);
  await page.getByText('처음부터 만들어요').click();
  await page.fill('[name="title"]', '마음 명상');
  if (selectN > 10) await page.fill('[name="capacity"]', '30');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.waitForSelector('.cw-split');
  await page.waitForTimeout(450);
}

/** 측정 함수(브라우저 컨텍스트). */
function measure() {
  const rect = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const body = document.querySelector('.fl-body'); const foot = document.querySelector('footer.fl-foot');
  const split = document.querySelector('.cw-split'); const left = document.querySelector('.cw-split-left');
  const right = document.querySelector('.cw-split > [data-class-member-picker], .cw-split > .cw-split-panel');
  const out = { vw: innerWidth, vh: innerHeight };
  out.docOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.bodyOverflowX = body.scrollWidth - body.clientWidth;
  const fr = rect(foot); out.footBottomGap = Math.abs(fr.b - innerHeight); out.footVisible = fr.t >= 0 && fr.b <= innerHeight + 1 && fr.h > 40;
  out.footTopBelowBodyBottom = rect(body).b <= fr.t + 1;
  const cs = getComputedStyle(split);
  out.cols = cs.gridTemplateColumns; out.display = cs.display;
  if (left && right && cs.display === 'grid') { const a = rect(left), b = rect(right); out.leftW = a.w; out.rightW = b.w; out.colDiff = Math.abs(a.w - b.w); out.leftIsLeft = a.l < b.l; }
  // 겹침: 보이는 주요 블록 사각형 교차(조상-자손 제외)
  const parts = [...document.querySelectorAll('.w-sum, .cw-sec, .cw-split-form, .cw-member-picker > *, .cw-split-panel, .class-member-picker__row, .cw-chip-slot')].filter(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== 'contents'; });
  const overlaps = [];
  const clipTop = rect(body).t, clipBot = rect(body).b;
  const vis = e => { const r = rect(e); return { ...r, t: Math.max(r.t, clipTop), b: Math.min(r.b, clipBot) }; };
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j]; if (a.contains(b) || b.contains(a)) continue;
    const A = vis(a), B = vis(b);
    const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l), oy = Math.min(A.b, B.b) - Math.max(A.t, B.t);
    if (ox > 1 && oy > 1) overlaps.push([a.className.toString().slice(0, 40), b.className.toString().slice(0, 40), Math.round(ox), Math.round(oy)]);
  }
  out.overlaps = overlaps.length; out.overlapSample = overlaps.slice(0, 3);
  // 세로 스크롤 주체: 본문 외 overflow-y auto/scroll 이면서 실제 넘치는 요소
  out.nestedScrollers = [...document.querySelectorAll('.cs-wizard *')].filter(e => e !== body && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1 && !e.closest('.w-scrim')).map(e => e.className.toString().slice(0, 40));
  out.bodyScrolls = body.scrollHeight > body.clientHeight + 1; out.bodyScrollable = body.scrollHeight - body.clientHeight;
  // 터치 타깃
  const small = [];
  for (const e of document.querySelectorAll('.cw-split button, .cw-split label.class-member-picker__row, .cw-split input[type=search], .cw-split textarea, .cw-split [role=tab]')) {
    const r = e.getBoundingClientRect(); if (r.width === 0) continue;
    if (r.height < 43.5 || r.width < 43.5) small.push([e.tagName, (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16), Math.round(r.width), Math.round(r.height)]);
  }
  out.smallTargets = small.length; out.smallSample = small.slice(0, 4);
  return out;
}

async function reachability(page, hasReason) {
  return page.evaluate(({ hasReason }) => {
    const body = document.querySelector('.fl-body'); const foot = document.querySelector('footer.fl-foot');
    const footTop = foot.getBoundingClientRect().top; const bodyRect = body.getBoundingClientRect();
    body.scrollTop = body.scrollHeight;
    const res = {};
    // (끝 스크롤 직후 측정) 끝까지 스크롤해도 하단 바에 가려지는 요소 없음: 본문 마지막 자식 하단 <= footTop
    const kids = [...body.querySelectorAll('.cw-split > *')].map(e => e.getBoundingClientRect().bottom);
    res.contentBottomGap = Math.round(footTop - Math.max(...kids));

    const rows = [...document.querySelectorAll('.class-member-picker__row')];
    const lastRow = rows.at(-1);
    if (lastRow) { const r = lastRow.getBoundingClientRect(); res.lastRowVisible = r.bottom <= footTop + 1 && r.top >= bodyRect.top - 1; res.lastRowGap = Math.round(footTop - r.bottom); }
    const sel = document.querySelector('.cw-reason');
    if (sel) { sel.scrollIntoView({ block: 'nearest' }); const r = sel.getBoundingClientRect(); res.reasonVisible = r.bottom <= footTop + 1 && r.top >= bodyRect.top - 1; }
    // elementFromPoint: 본문 중앙이 고정 요소에 가려지지 않음
    const mid = document.elementFromPoint(bodyRect.left + bodyRect.width / 2, bodyRect.top + bodyRect.height / 2);
    res.midHitsBody = !!mid && body.contains(mid);
    body.scrollTop = 0;
    return res;
  }, { hasReason });
}

const results = []; let failures = 0;
const browser = await chromium.launch();
for (const role of ROLES) for (const count of COUNTS) for (const selN of SELECTED) {
  if (selN > count) continue;
  const ctx = await browser.newContext({ hasTouch: false });
  const page = await ctx.newPage();
  await setup(page, role, count);
  let first = true;
  for (const [w, h] of SCREENS) {
    await page.setViewportSize({ width: w, height: h });
    if (first) { await toStep4(page, selN); first = false; } else { await page.waitForTimeout(250); }
    // 선택
    await page.evaluate(() => { document.querySelectorAll('.class-member-picker__row input:checked').forEach(i => i.click()); });
    for (let i = 1; i <= selN; i++) await page.locator(`[aria-label="회원${String(i).padStart(2, '0')} 선택"]`).check();
    await page.waitForTimeout(150);
    const m = await page.evaluate(measure);
    const reach = await reachability(page, role === 'org_admin');
    const desktop = w >= 1024;
    const fails = [];
    if (m.docOverflowX > 0 || m.bodyOverflowX > 0) fails.push('가로 넘침');
    if (!m.footVisible || m.footBottomGap > 1) fails.push('하단 바 고정 실패');
    if (!m.footTopBelowBodyBottom) fails.push('본문이 하단 바 영역 침범');
    if (m.overlaps) fails.push(`겹침 ${m.overlaps}`);
    if (m.smallTargets) fails.push(`터치 타깃<44 ${m.smallTargets}`);
    if (m.nestedScrollers.length) fails.push(`중첩 스크롤 ${m.nestedScrollers.join(',')}`);
    if (desktop && !(m.display === 'grid' && m.colDiff <= 2 && m.leftIsLeft)) fails.push(`2열 1:1 아님 diff=${m.colDiff}`);
    if (!desktop && m.display === 'grid') fails.push('1열이어야 함');
    if (count > 0 && reach.lastRowVisible === false) fails.push('마지막 행 도달/가림');
    if (role === 'org_admin' && reach.reasonVisible === false) fails.push('대행 사유 도달/가림');
    if (reach.contentBottomGap < 0) fails.push('콘텐츠가 바에 가려짐');
    if (!reach.midHitsBody) fails.push('본문 중앙 hit-test 실패');
    const ok = fails.length === 0; if (!ok) failures++;
    results.push({ role, members: count, selected: selN, viewport: `${w}x${h}`, ok, fails, leftW: m.leftW && Math.round(m.leftW), rightW: m.rightW && Math.round(m.rightW), colDiff: m.colDiff, footBottomGap: Math.round(m.footBottomGap), bodyScrollable: m.bodyScrollable, overlaps: m.overlaps, lastRowGap: reach.lastRowGap, contentBottomGap: reach.contentBottomGap, smallTargets: m.smallTargets, smallSample: m.smallSample });
    if (role === 'org_admin' && count === 20 && selN === 12 && [[1440, 900], [1024, 768], [390, 844]].some(([a, b]) => a === w && b === h)) await page.screenshot({ path: resolve(shotsDir, `step4-${w}x${h}-admin-20m-12sel.png`) });
    if (role === 'org_admin' && count === 20 && selN === 0 && w === 1440) await page.screenshot({ path: resolve(shotsDir, `step4-1440x900-admin-20m-0sel.png`) });
  }
  await ctx.close();
}

// 모바일 터치 스크롤(스크롤 불가 증상 점검): 390x844 touch 컨텍스트에서 목록 위 지점 wheel/touch 로 본문 scrollTop 증가 확인
const touchResults = [];
for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); await setup(page, role, 60); await toStep4(page, 0);
  const t = await page.evaluate(async () => {
    const body = document.querySelector('.fl-body'); const row = document.querySelector('.class-member-picker__row');
    const r = row.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hitIsRowOrChild: !!hit && row.contains(hit), scrollable: body.scrollHeight - body.clientHeight, touchAction: getComputedStyle(body).touchAction, overflowY: getComputedStyle(body).overflowY };
  });
  const cdp = await ctx.newCDPSession(page);
  const before = await page.evaluate(() => document.querySelector('.fl-body').scrollTop);
  await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 600, yDistance: -400, gestureSourceType: 'touch', speed: 800 });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => document.querySelector('.fl-body').scrollTop);
  const okTouch = after > before; if (!okTouch) failures++;
  touchResults.push({ role, ...t, scrollTopBefore: before, scrollTopAfter: after, touchScrollWorks: okTouch });
  await ctx.close();
}
await browser.close();
const summary = { total: results.length, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, touch: touchResults, results };
writeFileSync(resolve(here, 'verify-results.json'), JSON.stringify(summary, null, 2));
console.log(`조합 ${summary.total}개 중 통과 ${summary.passed}, 실패 ${summary.failed}`);
for (const r of results.filter(r => !r.ok).slice(0, 25)) console.log('FAIL', r.role, r.members, r.selected, r.viewport, r.fails.join(' | '));
console.log('touch', JSON.stringify(touchResults));
process.exit(failures ? 1 : 0);
