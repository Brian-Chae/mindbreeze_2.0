// SDD-208 — 클래스 진행 화면 측정 공용 모듈.
// designs/class-player-redesign/tools/{measure-symmetry-member,measure-symmetry-counselor,member-measure}.mjs 포팅:
//  - 시안 클래스명 셀렉터를 data-pz 셀렉터 맵(S)으로 인자화 (plan.md §9.2)
//  - file:// 시안 대신 하니스(/design/class-player)를 로드, Chrome 경로 고정 제거
//  - 결과를 {rule, val, pass} 한 형식으로 통일
// page.evaluate 로 직렬화되는 measure* 함수는 외부 클로저를 쓰지 않는다(자기완결).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VIEWPORTS = [[390, 844], [834, 1194], [1194, 834], [1280, 720]];
/** 도크 항목 전부가 화면 안에서 눌리는지만 보는 보조 뷰포트(verify §0) */
export const SHORT_VIEWPORTS = [[390, 600], [1280, 420]];

const pad2 = (n) => String(n).padStart(2, '0');
export const DEFAULT_IDS = {
  member: Array.from({ length: 21 }, (_, i) => `M${pad2(i + 1)}`),
  host: Array.from({ length: 18 }, (_, i) => `C${pad2(i + 1)}`),
};

/** 시트 열림·변형 측정 목록(시안 SHEET_VARIANTS / EXTRA 이관). query 는 하니스 쿼리 */
export const DEFAULT_VARIANTS = {
  member: [
    ['M01', 'status', 'sheet=status'], ['M01', 'chat', 'sheet=chat'], ['M01', 'signal', 'sheet=signal'],
    ['M01', 'sound', 'sheet=sound'], ['M01', 'device', 'sheet=device'], ['M02', 'chat', 'sheet=chat'],
    ['M05', 'status', 'sheet=status'], ['M05', 'chat', 'sheet=chat'], ['M05', 'sound', 'sheet=sound'],
    ['M06', 'device', 'sheet=device'], ['M18', 'status', 'sheet=status'],
  ],
  host: [
    ['C01', 'metric', 'sheet=metric'], ['C01', 'chat', 'sheet=chat'], ['C01', 'media', 'sheet=media'],
    ['C01', 'checkin', 'sheet=checkin'], ['C01', 'tools', 'sheet=tools'], ['C01', 'detail', 'sheet=detail&detail=3'],
    ['C01', 'n6', 'n=6'], ['C01', 'n7', 'n=7'], ['C01', 'n12', 'n=12'], ['C01', 'cam-big', 'cam=big'], ['C01', 'table', 'table=1'],
    ['C02', 'hands', 'sheet=hands'], ['C04', 'media', 'sheet=media'], ['C05', 'media', 'sheet=media'], ['C18', 'chat', 'sheet=chat'],
  ],
};

/** P9: 경고색(코랄)이 있으면 안 되는 케이스 — 밴드 미착용·연결 대기·미지원, 전원 미착용 */
export const NO_CORAL_IDS = ['M06', 'M07', 'M08', 'M13', 'C13'];

const pz = (name) => `[data-pz="${name}"]`;

/** 회원 측정 대상 → data-pz 셀렉터 (plan.md §9.2). infoCard·sideCard 는 §9.2 표에 없던 추가 이름 */
export const MEMBER_SELECTORS = {
  app: pz('app'), topbar: pz('topbar'), leave: pz('leave'), conn: pz('conn'), title: pz('title'),
  ring: pz('ring'), guide: pz('guide'), trend: pz('trend'), infoCard: pz('info-card'), sideCard: pz('side-card'),
  banner: pz('banner'), netDown: pz('net-down'), fullCard: pz('fv-card'),
  pip: pz('pip'), mypip: pz('mypip'), media: pz('media-row'), mediaItem: pz('mbtn'),
  dock: pz('dock'), dockItem: pz('dk'), sheet: pz('sheet'), cell: pz('mcell'),
};

/** 상담사 측정 대상 → data-pz 셀렉터. modal·modalCard·endCard·table 은 §9.2 표에 없던 선택 이름(없으면 해당 검사를 건너뜀) */
export const HOST_SELECTORS = {
  app: pz('app'), top: pz('top'), close: pz('btn-close'), end: pz('btn-end'), ttl: pz('ttl'), col: pz('col'),
  banner: pz('banner'), head: pz('head'), mstrip: pz('mstrip'), selfview: pz('selfview'), sumpanel: pz('sumpanel'),
  chipItems: `${pz('chipline')} > *`, chipline: pz('chipline'), gridscroll: pz('gridscroll'), tile: pz('tile'), table: pz('table'),
  dock: pz('dock'), dockItem: pz('dk'), sheet: pz('sheet'),
  solo: pz('solo'), mini: `${pz('solo')} ${pz('mini')}`, soloTrend: `${pz('solo')} ${pz('trend')}`, soloQas: `${pz('solo')} ${pz('qas')}`,
  modal: pz('modal'), modalCard: pz('mcard'), endCard: pz('ecard'),
};

export const SELECTORS = { member: MEMBER_SELECTORS, host: HOST_SELECTORS };

export const RULE_NAMES = {
  S1: '단독 요소 중심축', S2: '좌우 여백 동일', S3: '상단 바 좌우 대칭', S4: 'PiP 짝 가운데', S5: '시트 분기(태블릿 세로=바텀)',
  S6: '도크·미디어 줄 균등', S7: '링 세로 중앙', S8: '박스 최대폭 동일', S9: '중앙 컬럼 max-width', S10: '8배수 간격',
  MS1: '오프라인 컬럼 구조', MS2: '6지표 격자 균등', MS3: '전체 화면 정중앙',
  CS1: '그리드 행 중앙', CS2: '마지막 행 중앙·열 수', CS3: '헤드 행 비율', CS4: '칩 줄 중앙', CS5: '1:1 카드',
  P1: '페이지 스크롤 0', P2: '11px 이하 글자 0', P3: '터치 영역 ≥44px', P5: '호흡 지시 문구 0', P9: '경고색(코랄) 0',
  P12: '빈 영역 0', P13: '겹침·이탈·잘림 0', P14: '도크 도달성', REG: '케이스 등록',
};

/* ───────────────────────── 실행 환경 ───────────────────────── */

/** 번들 Chromium → PLAYWRIGHT_CHROMIUM 경로 → 시스템 Chrome 순으로 시도한다(CI·로컬 공용) */
export async function launchBrowser() {
  const args = ['--hide-scrollbars'];
  if (process.env.PLAYWRIGHT_CHROMIUM) return chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM, args });
  let bundled = null;
  try { bundled = chromium.executablePath(); } catch { bundled = null; }
  if (bundled && fs.existsSync(bundled)) return chromium.launch({ args });
  return chromium.launch({ channel: 'chrome', args });
}

export function parseArgs(argv) {
  const out = {};
  for (const raw of argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

export const DEFAULT_BASE = process.env.BASE_URL || 'http://localhost:5175';

export function caseUrl(base, role, id, query = '') {
  return `${base.replace(/\/$/, '')}/design/class-player?role=${role}&case=${encodeURIComponent(id)}${query ? `&${query}` : ''}`;
}

/** 하니스 케이스를 열고 렌더·폰트·전환이 끝날 때까지 기다린다 */
export async function openCase(page, base, role, id, query = '') {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(caseUrl(base, role, id, query), { waitUntil: 'load' });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
      break;
    } catch (error) {
      // vite 개발 서버가 의존성 최적화로 한 번 새로고침할 수 있다
      if (attempt === 1) throw error;
    }
  }
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
  await page.waitForTimeout(350);
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { a.pause(); a.currentTime = 500; } }));
}

/** 하니스에 등록된 케이스 ID — 미등록 케이스를 측정하지 않기 위해 읽는다 */
export async function readRegistry(page, base) {
  await page.goto(`${base.replace(/\/$/, '')}/design/class-player`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__playerCases !== undefined, null, { timeout: 30000 });
  return page.evaluate(() => window.__playerCases);
}

/* ───────────────── 측정 함수 (page.evaluate — 자기완결) ───────────────── */

/** 회원 좌우 대칭·비율 균형 (균형.md S1~S10, MS1~MS3). measure-symmetry-member.mjs 포팅 */
export function measureMemberSymmetry(S) {
  const vw = innerWidth, vh = innerHeight, checks = [];
  const add = (rule, val, pass) => checks.push({ rule, val, pass });
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
  const R = (sel) => { const el = [...document.querySelectorAll(sel)].find(vis); return el ? box(el) : null; };
  const RA = (sel) => [...document.querySelectorAll(sel)].filter(vis).map(box);
  const f = (n) => (Math.round(n * 10) / 10).toString();

  const sheet = R(S.sheet);
  const side = !!sheet && sheet.w < vw * 0.6;
  const bottomSheet = !!sheet && !side;
  const regionL = 0, regionR = side ? sheet.x : vw, axis = (regionL + regionR) / 2;
  const appEl = document.querySelector(S.app);
  const pad = appEl ? parseFloat(getComputedStyle(appEl).paddingLeft) : 0;
  const fullview = R(S.fullCard);
  const named = {
    링: R(S.ring), 안내칩: R(S.guide), 추이: R(S.trend), 안내박스: R(S.infoCard), 현장카드: R(S.sideCard),
    배너: R(S.banner), 시간필: R(S.title), 네트워크카드: R(S.netDown),
  };
  const dock = R(S.dock), media = R(S.media);
  const topbar = R(S.topbar);

  if (!fullview) {
    // S1
    for (const [k, b] of Object.entries(named)) if (b) add('S1', `${k} Δ${f(b.cx - axis)}`, Math.abs(b.cx - axis) <= 2);
    if (dock) add('S1', `도크 Δ${f(dock.cx - axis)}`, Math.abs(dock.cx - axis) <= 2);
    if (media) add('S1', `미디어줄 Δ${f(media.cx - axis)}`, Math.abs(media.cx - axis) <= 2);
    // S2
    for (const [k, b] of [['도크', dock], ['미디어줄', media], ['배너', named.배너]]) if (b) { const l = b.x - regionL, r = regionR - b.r; add('S2', `${k} 좌${f(l)}/우${f(r)}`, Math.abs(l - r) <= 2); }
    if (bottomSheet) { const l = sheet.x - regionL, r = regionR - sheet.r; add('S2', `바텀시트 좌${f(l)}/우${f(r)}`, Math.abs(l - r) <= 2); }
    // S3
    const leave = R(S.leave), conn = R(S.conn);
    if (leave && conn) {
      const l = leave.x - regionL, r = regionR - conn.r;
      add('S3', `여백 좌${f(l)}/우${f(r)} · 높이 ${f(leave.h)}/${f(conn.h)}`, Math.abs(l - r) <= 2 && Math.abs(leave.h - conn.h) <= 2);
    }
    // S4
    const pips = RA(`${S.pip}, ${S.mypip}`).sort((a, b) => a.x - b.x);
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
    for (const [k, b, sel] of [['도크', dock, S.dockItem], ['미디어줄', media, S.mediaItem]]) {
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
    if (named.링 && topbar) {
      const top = Math.max(topbar.b, named.배너 ? named.배너.b : 0);
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
    const pips2 = RA(`${S.pip}, ${S.mypip}`).sort((a, b) => a.x - b.x);
    if (pips2.length === 2) add('S10', `PiP 사이 ${f(pips2[1].x - pips2[0].r)}`, okSet(pips2[1].x - pips2[0].r));
    if (media && dock) add('S10', `미디어줄→도크 ${f(dock.y - media.b)}`, okSet(dock.y - media.b));
    // MS1
    if (appEl && appEl.dataset.place === 'offline') {
      const hiddenBySheet = bottomSheet && wb.length === 0; // 모바일 바텀 시트가 열리면 카드를 접는 것이 설계
      const spread = wb.length ? Math.max(...wb.map(([, b]) => b.w)) - Math.min(...wb.map(([, b]) => b.w)) : 0;
      const ok = !RA(`${S.pip}, ${S.mypip}, ${S.media}`).length && !!named.링 && (hiddenBySheet || (wb.length >= 3 && spread <= 2));
      add('MS1', hiddenBySheet ? '영상·마이크 없음 · 바텀 시트로 카드 접힘' : `영상·마이크 없음 · 링+박스 ${wb.length}장 폭 편차 ${f(spread)}`, ok);
    }
    // MS2
    const cells = RA(S.cell);
    if (cells.length === 6) {
      const ws = cells.map((c) => c.w), hs = cells.map((c) => c.h);
      const xs = [...new Set(cells.map((c) => Math.round(c.cx)))].sort((a, b) => a - b), ys = [...new Set(cells.map((c) => Math.round(c.cy)))].sort((a, b) => a - b);
      const dx = xs.slice(1).map((x, i) => x - xs[i]), pitchOk = dx.length < 2 || Math.max(...dx) - Math.min(...dx) <= 2;
      add('MS2', `셀 ${f(Math.min(...ws))}~${f(Math.max(...ws))}×${f(Math.min(...hs))}~${f(Math.max(...hs))} · 열 간격 ${dx.join('/')}`, Math.max(...ws) - Math.min(...ws) <= 2 && Math.max(...hs) - Math.min(...hs) <= 2 && pitchOk && xs.length === 3 && ys.length === 2);
    }
    // MS3 — 네트워크 끊김
    if (named.네트워크카드 && topbar) {
      const top = topbar.b, bot = Math.min(...[media && media.y, dock && dock.y].filter((v) => typeof v === 'number')), dv = named.네트워크카드.cy - (top + bot) / 2;
      add('MS3', `끊김 카드 Δx${f(named.네트워크카드.cx - axis)} Δy${f(dv)}`, Math.abs(named.네트워크카드.cx - axis) <= 2 && Math.abs(dv) <= (bot - top) * 0.08);
    }
  } else {
    const dx = fullview.cx - vw / 2, dy = fullview.cy - vh / 2;
    add('MS3', `전체화면 카드 Δx${f(dx)} Δy${f(dy)}`, Math.abs(dx) <= 2 && Math.abs(dy) <= 4);
    add('S9', `카드 폭 ${f(fullview.w)} ≤640`, fullview.w <= 642);
  }
  return checks;
}

/** 상담사 좌우 대칭·비율 (균형.md S1~S10, CS1~CS5). measure-symmetry-counselor.mjs 포팅 */
export function measureHostSymmetry(S) {
  const vw = innerWidth, vh = innerHeight, TOL = 2, res = [];
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const first = (sel) => [...document.querySelectorAll(sel)].find(vis) || null;
  const all = (sel) => [...document.querySelectorAll(sel)].filter(vis);
  const R = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; };
  const add = (rule, name, value, ok, unit = 'px') => res.push({ rule, val: `${name} = ${typeof value === 'number' ? Math.round(value * 10) / 10 : value}${unit}`, pass: ok });

  const endCard = first(S.endCard);
  if (endCard) {
    const c = R(endCard);
    add('S1', '종료화면 카드 가로중심', Math.abs(c.cx - vw / 2), Math.abs(c.cx - vw / 2) <= TOL);
    add('S2', '종료화면 카드 좌우여백', Math.abs(c.left - (vw - c.right)), Math.abs(c.left - (vw - c.right)) <= TOL);
    add('S1', '종료화면 카드 세로중심', Math.abs(c.cy - vh / 2), Math.abs(c.cy - vh / 2) <= vh * 0.08);
    return res;
  }
  const modalCard = first(S.modalCard);
  if (modalCard) {
    const c = R(modalCard);
    add('S1', '종료확인 모달 가로중심', Math.abs(c.cx - vw / 2), Math.abs(c.cx - vw / 2) <= TOL);
  }

  const topEl = first(S.top), colEl = first(S.col);
  if (!topEl || !colEl) { add('S3', '상단 바/본문 컬럼 존재', 'missing', false, ''); return res; }
  const top = R(topEl), col = R(colEl);
  const sheetEl = first(S.sheet);
  const sheetOpen = !!sheetEl;
  // 사이드/바텀은 시트가 메인 컬럼 오른쪽에 있는지(기하)로 판정한다. 사이드 시트가 열리면 상단 바도 메인 영역(시트 왼쪽)까지만 간다
  const sheetBox = sheetEl ? R(sheetEl) : null;
  const sheetSide = !!sheetBox && sheetBox.left >= col.right - 0.5;
  const regionR = sheetSide ? sheetBox.left : vw;
  const axis = col.cx;
  const mainW = col.width;

  // S3 상단 바
  const closeEl = first(S.close), endEl = first(S.end), ttlEl = first(S.ttl);
  if (closeEl && endEl && ttlEl) {
    const close = R(closeEl), end = R(endEl), ttl = R(ttlEl);
    const lm = close.left - top.left, rm = top.right - end.right;
    add('S3', '상단바 좌/우 바깥여백 차', Math.abs(lm - rm), Math.abs(lm - rm) <= TOL);
    add('S3', '상단바 좌/우 버튼 높이 차', Math.abs(close.height - end.height), Math.abs(close.height - end.height) <= TOL);
    add('S3', '상단바 제목 중앙', Math.abs(ttl.cx - top.cx), Math.abs(ttl.cx - top.cx) <= TOL);
  }
  add('S2', '상단바 좌우여백(메인 영역 기준)', Math.abs(top.left - (regionR - top.right)), Math.abs(top.left - (regionR - top.right)) <= TOL);

  // 메인 컬럼 블록
  const blocks = [];
  const addBlock = (name, sel) => { const e = first(sel); if (e) blocks.push({ name, r: R(e) }); };
  addBlock('배너', S.banner); addBlock('헤드 행', S.head); addBlock('칩 줄', S.chipline); addBlock('그리드 영역', S.gridscroll); addBlock('도크', S.dock);
  for (const b of blocks) {
    add('S2', `${b.name} 좌우여백(메인영역 기준)`, Math.abs((b.r.left - col.left) - (col.right - b.r.right)), Math.abs((b.r.left - col.left) - (col.right - b.r.right)) <= TOL);
    add('S1', `${b.name} 가로중심 = 메인축`, Math.abs(b.r.cx - axis), Math.abs(b.r.cx - axis) <= TOL);
  }
  // S8 배너·헤드·칩 줄 같은 폭
  const w8 = blocks.filter((b) => ['배너', '헤드 행', '칩 줄'].includes(b.name));
  if (w8.length > 1) { const ws = w8.map((b) => b.r.width); add('S8', `배너·헤드·칩 줄 폭 편차(${w8.map((b) => b.name).join('/')})`, Math.max(...ws) - Math.min(...ws), Math.max(...ws) - Math.min(...ws) <= TOL); }
  // S9 본문 컬럼 최대폭
  const head = blocks.find((b) => b.name === '헤드 행');
  if (head) add('S9', '본문 컬럼 폭(≤1040)', head.r.width, head.r.width <= 1040);
  // S10 간격 스케일
  const flow = [['상단바', top], ...blocks.map((b) => [b.name, b.r]), ...(sheetBox && !sheetSide ? [['바텀 시트', sheetBox]] : [])].sort((a, b) => a[1].top - b[1].top);
  const okSet = [8, 16, 24, 32, 40, 48];
  for (let i = 0; i < flow.length - 1; i++) { const g = flow[i + 1][1].top - flow[i][1].bottom; if (g < 0) continue; add('S10', `간격 ${flow[i][0]}→${flow[i + 1][0]}`, g, okSet.includes(Math.round(g))); }
  add('S10', '화면 좌우 바깥여백', top.left, okSet.includes(Math.round(top.left)));
  add('S10', '화면 상단 바깥여백', top.top, okSet.includes(Math.round(top.top)));

  // S6 도크 균등
  const dockEl = first(S.dock); const items = all(S.dockItem).map(R);
  if (dockEl && items.length > 1) {
    const dock = R(dockEl);
    const ws = items.map((i) => i.width), gaps = items.slice(1).map((i, k) => i.left - items[k].right);
    add('S6', '도크 항목 폭 편차', Math.max(...ws) - Math.min(...ws), Math.max(...ws) - Math.min(...ws) <= TOL);
    add('S6', '도크 항목 간격 편차', Math.max(...gaps) - Math.min(...gaps), Math.max(...gaps) - Math.min(...gaps) <= TOL);
    add('S6', '도크 안쪽 좌우여백 차', Math.abs((items[0].left - dock.left) - (dock.right - items.at(-1).right)), Math.abs((items[0].left - dock.left) - (dock.right - items.at(-1).right)) <= TOL);
    const need = Math.min(mainW * 0.92, 560);
    add('S6', `도크 폭 ≥ min(메인폭×0.92, 560)=${Math.round(need)}`, dock.width, dock.width >= need - 1);
  }

  // S5 시트 — 사이드/바텀은 시트가 메인 컬럼 오른쪽에 있는지(기하)로 판정한다
  if (sheetOpen) {
    const s = sheetBox;
    const portrait = vw < vh; const sideAllowed = vw >= 1000 && !portrait;
    if (!sideAllowed) {
      add('S5', '세로형/모바일: 사이드 시트 금지', sheetSide ? '사이드' : '바텀', !sheetSide, '');
      add('S5', '바텀 시트 좌우여백 차', Math.abs(s.left - (vw - s.right)), Math.abs(s.left - (vw - s.right)) <= TOL);
      add('S5', '바텀 시트 최대폭 ≤ 640', s.width, s.width <= 640 + 1);
      const below = dockEl ? R(dockEl).top : vh;
      add('S5', '바텀 시트 하단이 도크(없으면 화면 하단)에 밀착', Math.abs(s.bottom - below), Math.abs(s.bottom - below) <= 16);
    } else {
      add('S5', '가로형: 사이드 시트 사용', sheetSide ? '사이드' : '바텀', sheetSide, '');
      add('S5', '사이드 시트: 메인영역 좌 여백 = 시트 우 여백', Math.abs(col.left - (vw - s.right)), Math.abs(col.left - (vw - s.right)) <= TOL);
      add('S5', '사이드 시트: 메인영역-시트 겹침 없음', Math.max(0, col.right - s.left), col.right <= s.left + 0.5);
    }
  }

  // CS1·CS2 타일 그리드
  const scEl = first(S.gridscroll);
  const tiles = all(S.tile);
  const solo = !!first(S.solo);
  if (scEl && tiles.length) {
    const sc = R(scEl);
    const rows = new Map();
    tiles.forEach((t) => { const r = R(t); const k = Math.round(r.top); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(r); });
    let worst = 0, worstLast = 0; const keys = [...rows.keys()].sort((a, b) => a - b);
    keys.forEach((k, i) => { const rs = rows.get(k); const l = Math.min(...rs.map((r) => r.left)) - sc.left, r = sc.right - Math.max(...rs.map((r2) => r2.right)); const d = Math.abs(l - r); if (i === keys.length - 1) worstLast = d; worst = Math.max(worst, d); });
    add('CS1', '그리드 각 행 좌우여백 차(최대)', worst, worst <= TOL);
    add('CS2', '마지막 행 좌우여백 차', worstLast, worstLast <= TOL);
    const n = tiles.length; const cols = rows.get(keys[0]).length;
    const minW = vw < 600 ? 140 : 170; const gapPx = vw < 600 ? 8 : 14;
    const cap = Math.min(vw < 600 ? 2 : (vw < 1000 ? 4 : 5), Math.max(2, Math.floor((sc.width - 6 + gapPx) / (minW + gapPx))));
    const divisors = []; for (let c = 2; c <= cap; c++) if (n % c === 0) divisors.push(c);
    const okCols = divisors.length ? n % cols === 0 : true;
    if (n >= 4 && !first(S.table)) add('CS2', `열 수 ${cols}열 · ${n}명 · 균등분배 가능 열 ${divisors.join('/') || '없음'}`, n % cols === 0 ? '나누어떨어짐' : `마지막 행 ${n % cols}개`, okCols, '');
  }

  // CS3 헤드 행
  const stripEl = first(S.mstrip), slotEl = first(S.selfview) || first(S.sumpanel);
  if (stripEl && slotEl) {
    const a = R(stripEl), b = R(slotEl), headEl = first(S.head);
    add('CS3', '헤드 행 띠/슬롯 높이 차', Math.abs(a.height - b.height), Math.abs(a.height - b.height) <= TOL);
    add('CS3', '헤드 행 띠/슬롯 상단 정렬 차', Math.abs(a.top - b.top), Math.abs(a.top - b.top) <= TOL);
    const total = a.width + b.width; const ratio = a.width / total * 100; const target = vw < 600 ? 62 : 66;
    add('CS3', `띠:슬롯 비율 ${Math.round(ratio)}:${Math.round(100 - ratio)} (목표 ${target}:${100 - target})`, Math.abs(ratio - target), Math.abs(ratio - target) <= 3, '%p');
    if (headEl) {
      const h = R(headEl);
      add('CS3', '헤드 행 바깥 좌/우 여백 차(띠 좌 / 슬롯 우)', Math.abs((a.left - h.left) - (h.right - b.right)), Math.abs((a.left - h.left) - (h.right - b.right)) <= TOL);
    }
    add('CS3', '슬롯 크기 ≥ 띠 높이의 90%(구석에 뜬 작은 박스 금지)', b.height, b.height >= a.height * 0.9);
  }

  // CS4 칩 줄
  const chips = all(S.chipItems).map(R);
  const chiplineEl = first(S.chipline);
  if (chiplineEl && chips.length) {
    const cl = R(chiplineEl); const l = Math.min(...chips.map((c) => c.left)), r = Math.max(...chips.map((c) => c.right));
    add('CS4', '칩 묶음 중심 = 칩 줄 중심', Math.abs((l + r) / 2 - cl.cx), Math.abs((l + r) / 2 - cl.cx) <= TOL);
    add('S1', '칩 묶음 가로중심 = 메인축', Math.abs((l + r) / 2 - axis), Math.abs((l + r) / 2 - axis) <= TOL);
  }

  // CS5 1:1 카드
  if (solo) {
    const wrap = R(first(S.solo));
    add('CS5', '1:1 카드 묶음 가로중심 = 메인축', Math.abs(wrap.cx - axis), Math.abs(wrap.cx - axis) <= TOL);
    const minis = all(S.mini).map(R);
    if (minis.length === 6) {
      const ws = minis.map((m) => m.width), hs = minis.map((m) => m.height);
      add('CS5', '6지표 카드 크기 편차(w/h)', Math.max(Math.max(...ws) - Math.min(...ws), Math.max(...hs) - Math.min(...hs)), Math.max(...ws) - Math.min(...ws) <= TOL && Math.max(...hs) - Math.min(...hs) <= TOL);
      const row1 = minis.slice(0, 3), row2 = minis.slice(3);
      const g1 = [row1[1].left - row1[0].right, row1[2].left - row1[1].right, row2[1].left - row2[0].right, row2[2].left - row2[1].right];
      add('CS5', '6지표 3×2 격자 가로 간격 편차', Math.max(...g1) - Math.min(...g1), Math.max(...g1) - Math.min(...g1) <= TOL);
      const aligned = [0, 1, 2].every((i) => Math.abs(row1[i].left - row2[i].left) <= TOL);
      add('CS5', '6지표 2행 열 정렬(3×2)', aligned ? 0 : 1, aligned, '');
    }
    const trEl = first(S.soloTrend), ckEl = first(S.soloQas);
    if (trEl && ckEl) { const a = R(trEl), b = R(ckEl); add('CS5', '5분 추이 / 체크인 카드 폭 차', Math.abs(a.width - b.width), Math.abs(a.width - b.width) <= TOL); }
  }
  return res;
}

/**
 * 공통 합격 기준 P1·P2·P3·P5·P9·P12·P13 (verify §1). member-measure.mjs 포팅.
 * cfg: { S, named, empties, forbidCoral }
 *  - named: 겹침·이탈 검사에 쓸 박스 이름 → 셀렉터
 *  - empties: 빈 영역 검사 대상 셀렉터 목록
 */
export function measureFit(cfg) {
  const { named, empties: emptySelectors, forbidCoral } = cfg;
  const vw = innerWidth, vh = innerHeight, de = document.documentElement, checks = [];
  const add = (rule, val, pass) => checks.push({ rule, val, pass });
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const label = (el) => `${el.getAttribute('data-pz') || el.tagName.toLowerCase()}:${(el.textContent || '').trim().slice(0, 14)}`;

  // P1 페이지 스크롤 0
  add('P1', `scrollH ${de.scrollHeight}/${vh} · scrollW ${de.scrollWidth}/${vw}`, de.scrollHeight <= vh && de.scrollWidth <= vw);

  // P2 11px 이하 글자
  const smallList = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (parseFloat(getComputedStyle(el).fontSize) <= 11) smallList.push(label(el));
  }
  add('P2', smallList.length ? smallList.slice(0, 6).join(' | ') : '0건', smallList.length === 0);

  // P3 터치 영역 ≥ 44px
  const small44 = [];
  for (const el of document.querySelectorAll('button, [role=button], a[href], input, select, summary')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 43.5) small44.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  add('P3', small44.length ? small44.slice(0, 6).join(' | ') : '0건', small44.length === 0);

  // P5 호흡 지시 문구 (지표 라벨 "호흡"·단위 "회/분"은 허용)
  const breath = (document.body.innerText || '').match(/호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/g) || [];
  add('P5', breath.length ? breath.join(',') : '0건', breath.length === 0);

  // P9 경고색(코랄) — 미착용·연결 대기·미지원 케이스에서만 검사. 글자색·배경·보이는 테두리·SVG 선/채움이 코랄(#E8B4A0)이면 위반
  if (forbidCoral) {
    const coral = /rgba?\(232,\s*180,\s*160/;
    const hits = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      const painted = [cs.backgroundColor, cs.stroke, cs.fill];
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) painted.push(cs.color);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') painted.push(cs[`border${side}Color`]);
      }
      if (el.getAttribute('data-tone') === 'coral' || painted.some((c) => coral.test(c))) hits.push(label(el));
    }
    add('P9', hits.length ? hits.slice(0, 6).join(' | ') : '0건', hits.length === 0);
  }

  // P13 겹침·이탈·잘림
  const clipped = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el) || getComputedStyle(el).display === 'inline') continue;
    const cs = getComputedStyle(el);
    if (cs.whiteSpace === 'nowrap' && cs.textOverflow !== 'ellipsis' && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      if (el.scrollWidth > el.clientWidth + 1) clipped.push(`${label(el)} (${el.scrollWidth}>${el.clientWidth})`);
    }
  }
  for (const sel of Object.values(named)) {
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowY === 'visible' && el.scrollHeight > el.clientHeight + 1) clipped.push(`${label(el)} (h ${el.scrollHeight}>${el.clientHeight})`);
    }
  }
  const core = document.querySelector('[data-pz="ring"] .pz-ring__core');
  if (core && vis(core)) {
    const cr = core.getBoundingClientRect(), cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2, rad = cr.width / 2;
    for (const el of core.querySelectorAll('.pz-ring__core-ic, .pz-ring__label, .pz-ring__num, .pz-ring__title, .pz-ring__sub, .pz-ring__dots')) {
      if (!vis(el)) continue;
      const rg = document.createRange(); rg.selectNodeContents(el);
      for (const r of rg.getClientRects()) {
        for (const [px, py] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]) {
          if (Math.hypot(px - cx, py - cy) > rad - 3) { clipped.push(`core:${label(el)}`); break; }
        }
      }
    }
  }
  const boxes = {};
  for (const [k, sel] of Object.entries(named)) { const el = [...document.querySelectorAll(sel)].find(vis); if (el) boxes[k] = rect(el); }
  const outside = Object.entries(boxes).filter(([, b]) => b.x < -0.5 || b.y < -0.5 || b.r > vw + 0.5 || b.b > vh + 0.5).map(([k]) => k);
  const grow = (b, g) => ({ x: b.x - g, y: b.y - g, r: b.r + g, b: b.b + g });
  const inter = (a, c) => Math.max(0, Math.min(a.r, c.r) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.y, c.y));
  const names = Object.keys(boxes), overlaps = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = boxes[names[i]], c = boxes[names[j]];
    const ga = names[i] === 'ring' ? grow(a, a.w * 0.03) : a, gc = names[j] === 'ring' ? grow(c, c.w * 0.03) : c;
    const area = inter(ga, gc);
    if (area > 1) overlaps.push(`${names[i]}×${names[j]}(${Math.round(area)}px²)`);
  }
  const p13 = [...clipped.map((c) => `잘림 ${c}`), ...outside.map((o) => `이탈 ${o}`), ...overlaps.map((o) => `겹침 ${o}`)];
  add('P13', p13.length ? p13.slice(0, 6).join(' | ') : '0건', p13.length === 0);

  // P12 빈 영역: 콘텐츠 없는 큰 박스(내용 bbox 가 박스의 35% 미만이거나 텍스트·아이콘이 없음)
  const emptyList = [];
  for (const el of document.querySelectorAll(emptySelectors.join(','))) {
    if (!vis(el)) continue;
    const br = el.getBoundingClientRect();
    if (br.width * br.height < 3000) continue;
    const hasText = (c) => [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    // 자기 자신의 직접 텍스트는 글자 영역(Range) 기준으로, 자손은 요소 사각형 기준으로 본다
    const leaves = [el, ...el.querySelectorAll('*')].filter((c) => vis(c) && ((c !== el && c.matches('svg,input,button,i,video,canvas,img')) || hasText(c)));
    if (!leaves.length) { emptyList.push(`${label(el)} (내용 없음)`); continue; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of leaves) {
      let r = c.getBoundingClientRect();
      if (c === el) { const rg = document.createRange(); rg.selectNodeContents(c); r = rg.getBoundingClientRect(); }
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    const fx = (x1 - x0) / br.width, fy = (y1 - y0) / br.height;
    if (fx < 0.35 || fy < 0.35) emptyList.push(`${label(el)} (채움 ${Math.round(fx * 100)}%×${Math.round(fy * 100)}%)`);
  }
  add('P12', emptyList.length ? emptyList.slice(0, 6).join(' | ') : '0건', emptyList.length === 0);
  return checks;
}

/** 보조 뷰포트에서 도크 항목이 전부 화면 안에서 눌리는지(최상단 요소가 자기 자신인지) 확인 */
export function measureDockReach(S) {
  const vw = innerWidth, vh = innerHeight, checks = [];
  const items = [...document.querySelectorAll(S.dockItem)];
  const bad = [];
  for (const el of items) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const inView = r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
    const hit = inView ? document.elementFromPoint(cx, cy) : null;
    if (!inView || !hit || !(hit === el || el.contains(hit))) bad.push((el.textContent || '').trim().slice(0, 10) || el.tagName);
  }
  checks.push({ rule: 'P14', val: items.length ? (bad.length ? `눌리지 않음: ${bad.join(',')}` : `${items.length}개 모두 도달`) : '도크 없음', pass: items.length > 0 && bad.length === 0 });
  return checks;
}

/* ───────────────────────── 실행 · 보고 ───────────────────────── */

const FIT_NAMED = {
  member: {
    leave: pz('leave'), title: pz('title'), conn: pz('conn'), banner: pz('banner'), pip: pz('pip'), mypip: pz('mypip'), ring: pz('ring'),
    guide: pz('guide'), trend: pz('trend'), info: pz('info-card'), netdown: pz('net-down'), side: pz('side-card'), media: pz('media-row'),
    dock: pz('dock'), sheet: pz('sheet'), fv: pz('fv-card'),
  },
  host: {
    top: pz('top'), banner: pz('banner'), head: pz('head'), chipline: pz('chipline'), solo: pz('solo'), dock: pz('dock'), sheet: pz('sheet'),
  },
};
const FIT_EMPTIES = {
  member: [pz('sheet'), pz('trend'), pz('info-card'), pz('net-down'), pz('side-card'), pz('fv-card'), pz('mypip'), pz('pip'), pz('dock'), pz('media-row'), pz('banner')],
  host: [pz('sheet'), pz('trend'), pz('dock'), pz('banner'), pz('mstrip'), pz('selfview'), pz('sumpanel')],
};

/** measureFit 에 넘기는 설정 */
export function fitConfig(role, id) {
  return { named: FIT_NAMED[role], empties: FIT_EMPTIES[role], forbidCoral: NO_CORAL_IDS.includes(id) };
}

/** 한 케이스를 한 뷰포트에서 측정해 행을 돌려준다. mode: 'symmetry' | 'fit' */
export async function measureOne(page, { base, role, id, query, mode }) {
  await openCase(page, base, role, id, query);
  if (mode === 'symmetry') return page.evaluate(role === 'member' ? measureMemberSymmetry : measureHostSymmetry, SELECTORS[role]);
  return page.evaluate(measureFit, fitConfig(role, id));
}

/**
 * 케이스 × 뷰포트 전체를 측정한다.
 * jobs: [{ id, variant, query }]  → rows: [{ id(variant 포함), vp, rule, val, pass }]
 */
export async function runMeasure({ browser, base, role, mode, jobs, viewports = VIEWPORTS, onProgress }) {
  const rows = [];
  for (const [w, h] of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const vp = `${w}x${h}`;
    for (const job of jobs) {
      const label = job.variant ? `${job.id}+${job.variant}` : job.id;
      try {
        const checks = await measureOne(page, { base, role, id: job.id, query: job.query, mode });
        for (const c of checks) rows.push({ id: label, vp, ...c });
        if (!checks.length) rows.push({ id: label, vp, rule: 'REG', val: '검사 항목 0건(측정 대상 data-pz 요소 없음)', pass: false });
      } catch (error) {
        rows.push({ id: label, vp, rule: 'REG', val: `측정 실패: ${String(error.message).split('\n')[0]}`, pass: false });
      }
      if (onProgress) onProgress(label, vp);
    }
    await ctx.close();
  }
  return rows;
}

/** 보조 뷰포트(390×600, 1280×420) 도크 도달성 */
export async function runDockReach({ browser, base, role, ids }) {
  const rows = [];
  for (const [w, h] of SHORT_VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const id of ids) {
      try {
        await openCase(page, base, role, id);
        const checks = await page.evaluate(measureDockReach, SELECTORS[role]);
        for (const c of checks) rows.push({ id, vp: `${w}x${h}`, ...c });
      } catch (error) {
        rows.push({ id, vp: `${w}x${h}`, rule: 'P14', val: `측정 실패: ${String(error.message).split('\n')[0]}`, pass: false });
      }
    }
    await ctx.close();
  }
  return rows;
}

/** 등록된 케이스와 기본 목록을 교차해 측정 작업을 만든다. 미등록 건수는 skipped 로 돌려준다 */
export function buildJobs({ role, registry, ids, variants, explicit }) {
  const registered = new Set(registry[role] || []);
  const wanted = (ids && ids.length ? ids : DEFAULT_IDS[role]);
  const base = wanted.map((id) => ({ id, variant: '', query: '' }));
  const extra = explicit ? [] : (variants ?? DEFAULT_VARIANTS[role]).map(([id, variant, query]) => ({ id, variant, query }));
  const jobs = [], skipped = [];
  for (const job of [...base, ...extra]) (registered.has(job.id) ? jobs : skipped).push(job);
  return { jobs, skipped };
}

export function summarize(rows) {
  const fails = rows.filter((r) => !r.pass);
  const rules = [...new Set(rows.map((r) => r.rule))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return { fails, rules };
}

export function formatReport({ title, role, rows, viewports = VIEWPORTS, skipped = [] }) {
  const { fails, rules } = summarize(rows);
  const vps = viewports.map(([w, h]) => `${w}x${h}`);
  const L = [];
  L.push(title);
  L.push(`대상: role=${role} · 뷰포트 ${vps.join(', ')} · 총 검사 ${rows.length}건`);
  L.push(`위반 ${fails.length}건 / 전체 ${rows.length}건`);
  if (skipped.length) L.push(`하니스에 미등록이라 건너뜀 ${skipped.length}건: ${skipped.map((j) => (j.variant ? `${j.id}+${j.variant}` : j.id)).join(', ')}`);
  L.push('');
  L.push('규칙별 위반 건수:');
  for (const k of rules) { const t = rows.filter((r) => r.rule === k); L.push(`  ${k.padEnd(4)} ${(RULE_NAMES[k] || '').padEnd(24)} 위반 ${String(t.filter((r) => !r.pass).length).padStart(3)} / ${t.length}`); }
  L.push('');
  L.push(`뷰포트별 위반 건수: ${vps.map((v) => `${v}=${fails.filter((r) => r.vp === v).length}`).join('  ')}`);
  L.push('');
  if (fails.length) { L.push('=== 위반 목록 ==='); for (const r of fails) L.push(`FAIL | ${r.id.padEnd(14)} | ${r.vp.padEnd(9)} | ${r.rule.padEnd(4)} | ${r.val}`); L.push(''); }
  L.push('=== 전체 일람표 (케이스 | 뷰포트 | 규칙 | 측정값 | 판정) ===');
  for (const r of rows) L.push(`${r.id.padEnd(14)} | ${r.vp.padEnd(9)} | ${r.rule.padEnd(4)} | ${r.val} | ${r.pass ? 'PASS' : 'FAIL'}`);
  return L.join('\n') + '\n';
}

export function writeReport(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** CLI 공통 본체: symmetry-member / symmetry-host / fit 이 호출한다 */
export async function runCli({ role, mode, title, defaultOut }) {
  const args = parseArgs(process.argv);
  const base = args.base || DEFAULT_BASE;
  const out = path.resolve(args.out || path.join(HERE, 'out', defaultOut));
  const ids = typeof args.ids === 'string' ? args.ids.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const browser = await launchBrowser();
  try {
    const regPage = await (await browser.newContext()).newPage();
    const registry = await readRegistry(regPage, base);
    const { jobs, skipped } = buildJobs({ role, registry, ids, explicit: !!ids });
    if (!jobs.length) {
      console.error(`하니스에 등록된 ${role} 케이스가 없습니다(${base}). 픽스처(lib/class/fixtures/*.ts)를 먼저 추가하세요.`);
      process.exitCode = 2;
      return;
    }
    const rows = await runMeasure({ browser, base, role, mode, jobs });
    let all = rows;
    if (mode === 'fit' && args.reach !== 'false') {
      const reachIds = [...new Set(jobs.filter((j) => !j.variant).map((j) => j.id))];
      all = [...rows, ...(await runDockReach({ browser, base, role, ids: reachIds }))];
    }
    const text = formatReport({ title, role, rows: all, skipped });
    writeReport(out, text);
    console.log(text.split('\n').slice(0, 24).join('\n'));
    console.log(`\n결과 파일: ${out}`);
    if (all.some((r) => !r.pass)) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
