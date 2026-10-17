// SDD-209 T3 — 클래스 사전·사후 흐름 측정 공용 모듈.
// e2e/class-player/lib.mjs(SDD-208)의 실행 환경·공통 합격 기준(measureFit)·보고 형식만 가져오고,
// 하니스 URL(/design/class-flow?screen=&case=)·사전 흐름 전용 규칙 FR1~FR6·균형 FS1/FS3/FS7/FS9 는 이 파일에 신규로 둔다.
// page.evaluate 로 직렬화되는 measure* 함수는 외부 클로저를 쓰지 않는다(자기완결).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE, RULE_NAMES, SHORT_VIEWPORTS, VIEWPORTS, formatReport, launchBrowser, measureFit, parseArgs, summarize, writeReport,
} from '../class-player/lib.mjs';

export { DEFAULT_BASE, SHORT_VIEWPORTS, VIEWPORTS, formatReport, launchBrowser, measureFit, parseArgs, summarize, writeReport };
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FRONTEND_ROOT = path.resolve(HERE, '..', '..');

Object.assign(RULE_NAMES, {
  FR1: '하단 CTA 위치 고정', FR2: '진행 점', FR3: '시트 내 중첩 스크롤 0', FR4: '카피·글리프(DOM·소스)',
  FR5: '상태 의존 요소', FR6: '오버레이가 CTA 를 안 가림',
  FS1: '본문 컬럼 중심축', FS3: '상단 바 좌우 대칭', FS7: '본문 세로 중앙(사전 흐름)', FS9: '컬럼 max-width ≤ 640',
});

const pz = (name) => `[data-pz="${name}"]`;

/** 겹침·이탈·잘림 검사 대상. flow-col 과 flow-card 는 포함 관계라 col·top·foot 만 쓴다(시트·배너는 FR6 이 본다) */
export const FLOW_NAMED = { top: pz('flow-top'), col: pz('flow-col'), foot: pz('flow-foot') };
/** 빈 영역(P12) 검사 대상 — 시안 측정 기준이 확정되면 늘린다. 빈 배열이면 measureFit 이 빈 셀렉터로 실패하므로 한 곳은 항상 둔다 */
export const FLOW_EMPTIES = [pz('flow-avcheck')];

/** P10(경고색 금지) 해당 케이스: 밴드 미사용·미연결·건너뛰기·카메라 꺼짐·오프라인 안내 (verify P10) */
export function forbidsCoral(screen, key) {
  if (screen === '__selftest') return true;
  if (screen === 'FM06c') return /-opt-member-(idle|connecting|unsupported)(-started)?$/.test(key);
  if (screen === 'FM06d') return /-member-(camon|mic)(-started)?$/.test(key);
  if (screen === 'FM06e' || screen === 'FM07') return true;
  if (screen === 'FH05') return ['cam-off', 'offline', 'ok', 'quiet'].includes(key);
  if (screen === 'FH06') return key === 'g-on-0' || /inv0$/.test(key);
  return false;
}

/** 케이스 ref(`화면:키`) → { screen, key } */
export function splitRef(ref) {
  const at = ref.indexOf(':');
  return { screen: ref.slice(0, at), key: ref.slice(at + 1) };
}

export function caseUrl(base, ref, query = '') {
  const { screen, key } = splitRef(ref);
  return `${base.replace(/\/$/, '')}/design/class-flow?screen=${encodeURIComponent(screen)}&case=${encodeURIComponent(key)}${query ? `&${query}` : ''}`;
}

/** 하니스 케이스를 열고 렌더·폰트·전환이 끝날 때까지 기다린다 */
export async function openCase(page, base, ref, query = '') {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(caseUrl(base, ref, query), { waitUntil: 'load' });
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

/** 하니스에 등록된 케이스 ref — 미등록 케이스를 측정하지 않기 위해 읽는다 */
export async function readRegistry(page, base) {
  await page.goto(`${base.replace(/\/$/, '')}/design/class-flow`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__flowCases !== undefined, null, { timeout: 30000 });
  return page.evaluate(() => window.__flowCases);
}

/* ───────────────── 측정 함수 (page.evaluate — 자기완결) ───────────────── */

/** 하단 주 버튼(flow-foot 안 flow-cta) 박스. FR1 비교용 */
export function readFlowCta() {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const foot = [...document.querySelectorAll('[data-pz="flow-foot"]')].find(vis);
  const ctas = foot ? [...foot.querySelectorAll('[data-pz="flow-cta"]')].filter(vis) : [];
  const r = ctas[0]?.getBoundingClientRect();
  return { count: ctas.length, label: (ctas[0]?.textContent || '').trim(), rect: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null };
}

/** FR2 진행 점: 개수 = expected, 가운데 정렬, 같은 간격, 완료·현재 구분, aria-current 1개 */
export function measureFlowSteps(expected) {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const box = [...document.querySelectorAll('[data-pz="flow-steps"]')].find(vis);
  if (!box) {
    return expected === null ? [] : [{ rule: 'FR2', val: `진행 점 없음(기대 ${expected}개)`, pass: false }];
  }
  const dots = [...box.children].filter((c) => c.tagName === 'I');
  const problems = [];
  if (expected !== null && dots.length !== expected) problems.push(`개수 ${dots.length}≠${expected}`);
  const rects = dots.map((d) => d.getBoundingClientRect());
  const br = box.getBoundingClientRect();
  if (rects.length) {
    const spanCx = (rects[0].left + rects[rects.length - 1].right) / 2;
    if (Math.abs(spanCx - (br.left + br.right) / 2) > 1.5) problems.push(`점 묶음 중심 Δ${f(spanCx - (br.left + br.right) / 2)}`);
    const col = document.querySelector('[data-pz="flow-col"]');
    if (col) { const cr = col.getBoundingClientRect(); if (Math.abs(spanCx - (cr.left + cr.right) / 2) > 2) problems.push(`본문 컬럼 중심과 Δ${f(spanCx - (cr.left + cr.right) / 2)}`); }
    const gaps = rects.slice(1).map((r, i) => r.left - rects[i].right);
    if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > 1) problems.push(`간격 불균등 ${gaps.map(f).join('/')}`);
  }
  const current = dots.filter((d) => d.getAttribute('aria-current') === 'step');
  if (current.length !== 1) problems.push(`aria-current ${current.length}개`);
  const idx = dots.findIndex((d) => d.getAttribute('aria-current') === 'step');
  const done = dots.filter((d) => d.classList.contains('done')).length;
  if (idx >= 0 && done !== idx) problems.push(`완료 점 ${done}≠현재 앞 ${idx}`);
  if (idx >= 0 && !dots[idx].classList.contains('on')) problems.push('현재 점 on 표시 없음');
  return [{ rule: 'FR2', val: problems.length ? problems.join(' | ') : `점 ${dots.length}개 · 현재 ${idx + 1}번 · 중앙·등간격`, pass: problems.length === 0 }];
}

/** FR3 시트 내 중첩 스크롤: 시트 본문·내부 요소의 scrollHeight>clientHeight 0 */
export function measureSheetNesting() {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const sheets = [...document.querySelectorAll('[data-pz="flow-sheet"]')].filter(vis);
  if (!sheets.length) return [{ rule: 'FR3', val: '시트 없음(해당 없음)', pass: true }];
  const bad = [];
  for (const sheet of sheets) {
    for (const el of [sheet, ...sheet.querySelectorAll('*')]) {
      if (!(el instanceof HTMLElement) || !vis(el)) continue;
      if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) bad.push(`${el.className || el.tagName.toLowerCase()} ${el.scrollHeight}>${el.clientHeight}`);
    }
  }
  return [{ rule: 'FR3', val: bad.length ? bad.slice(0, 4).join(' | ') : `시트 ${sheets.length}개 내부 스크롤 0`, pass: bad.length === 0 }];
}

/** FR5 상태 의존 요소. expect: { tracker: boolean|null, avMode: 'video'|'bar'|'none'|null } */
export function measureFlowState(expect) {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const rows = [];
  if (expect.tracker !== null) {
    const wrap = [...document.querySelectorAll('[data-pz="flow-electrodes"]')].find(vis);
    if (!expect.tracker) rows.push({ rule: 'FR5', val: wrap ? '전극 트래커가 접촉 불량이 아닌데 보임' : '전극 트래커 미노출', pass: !wrap });
    else if (!wrap) rows.push({ rule: 'FR5', val: '접촉 불량인데 전극 트래커 없음', pass: false });
    else {
      const svg = wrap.querySelector('svg');
      const r = svg.getBoundingClientRect();
      const leds = wrap.querySelectorAll('[data-led]').length;
      const labels = (wrap.querySelector('[data-pz="flow-electrode-labels"]')?.textContent || '').trim();
      const legend = (wrap.querySelector('[data-pz="flow-electrode-legend"]')?.textContent || '').includes('접촉 양호');
      const avail = wrap.parentElement.getBoundingClientRect().width;
      const wantW = Math.min(288, avail);
      const problems = [];
      if (Math.abs(r.width - wantW) > 1.5) problems.push(`폭 ${f(r.width)}≠${f(wantW)}`);
      if (Math.abs(r.width / r.height - 288 / 64) > 0.1) problems.push(`비율 ${f(r.width / r.height)}≠4.5`);
      if (leds !== 3) problems.push(`LED ${leds}개`);
      if (!labels || !legend) problems.push('라벨/범례 없음');
      rows.push({ rule: 'FR5', val: problems.length ? problems.join(' | ') : `전극 트래커 ${f(r.width)}×${f(r.height)} · LED 3 · 라벨·범례`, pass: problems.length === 0 });
    }
  }
  if (expect.avMode !== null) {
    const video = [...document.querySelectorAll('[data-pz="flow-avcheck"] video')].some(vis);
    const bar = [...document.querySelectorAll('[data-pz="flow-level"]')].some(vis);
    const ok = expect.avMode === 'video' ? video && !bar : expect.avMode === 'bar' ? bar && !video : !video && !bar;
    rows.push({ rule: 'FR5', val: `기대 ${expect.avMode} · 영상 ${video ? '보임' : '없음'} · 가로 막대 ${bar ? '보임' : '없음'}`, pass: ok });
  }
  return rows;
}

/** FR6 오버레이가 주 CTA 를 가리지 않음. 시트가 열려 있으면 푸터가 inert 여야 한다 */
export function measureCtaCover() {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const foot = [...document.querySelectorAll('[data-pz="flow-foot"]')].find(vis);
  const cta = foot ? [...foot.querySelectorAll('[data-pz="flow-cta"]')].find(vis) : null;
  if (!cta) return [{ rule: 'FR6', val: '하단 주 버튼 없음(해당 없음)', pass: true }];
  const dialogs = [...document.querySelectorAll('[aria-modal="true"]')].filter(vis);
  const inert = !!foot.closest('[inert]');
  const r = cta.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const covered = !top || !cta.contains(top);
  const who = top ? `${top.getAttribute('data-pz') || top.className || top.tagName.toLowerCase()}` : '화면 밖';
  if (!covered) return [{ rule: 'FR6', val: `가려짐 없음${dialogs.length ? ` · 열린 시트 ${dialogs.length}` : ''}`, pass: true }];
  if (dialogs.length && inert) return [{ rule: 'FR6', val: `시트가 CTA 를 덮지만 푸터 inert (덮는 요소: ${who})`, pass: true }];
  return [{ rule: 'FR6', val: `주 버튼이 가려짐 (덮는 요소: ${who}${dialogs.length ? ' · 시트 열림, 푸터 inert 아님' : ''})`, pass: false }];
}

/** FR4 DOM판: 이모지·문자 글리프, 금지 용어, 금지 표현, 영문 대문자 아이브로우 (보이는 글자 + aria-label·title·placeholder) */
export function measureFlowCopy(cfg) {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const glyphRe = new RegExp(cfg.glyph, 'u');
  const bannedRe = new RegExp(cfg.banned);
  const texts = [];
  const eyebrow = [];
  const allowed = new Set(cfg.eyebrowAllow);
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ');
    if (own) {
      texts.push(own);
      const words = own.split(/\s+/);
      if ((getComputedStyle(el).textTransform === 'uppercase' && /[A-Za-z]/.test(own)) || (words.length >= 2 && words.every((w) => /^[A-Z][A-Z0-9\-·:]*$/.test(w)) && !allowed.has(own))) eyebrow.push(own.slice(0, 20));
    }
    for (const attr of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(attr); if (v) texts.push(v); }
  }
  texts.push(document.title);
  const glyph = [...new Set(texts.flatMap((t) => [...t].filter((ch) => glyphRe.test(ch))))];
  const banned = [...new Set(texts.flatMap((t) => t.match(new RegExp(bannedRe.source, 'g')) || []))];
  const problems = [];
  if (glyph.length) problems.push(`글리프 ${glyph.slice(0, 4).join('')}`);
  if (banned.length) problems.push(`금지어 ${banned.slice(0, 4).join(',')}`);
  if (eyebrow.length) problems.push(`대문자 아이브로우 ${eyebrow.slice(0, 3).join(',')}`);
  return [{ rule: 'FR4', val: problems.length ? problems.join(' | ') : 'DOM 글리프 0 · 금지어 0 · 대문자 아이브로우 0', pass: problems.length === 0 }];
}

/** 균형 FS1(컬럼 중심축)·FS3(상단 바 대칭)·FS7(본문 세로 중앙, 시안 member-b 측정 방식)·FS9(컬럼 ≤ 640) */
export function measureFlowSymmetry() {
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const f = (n) => (Math.round(n * 10) / 10).toString();
  const R = (sel) => { const el = [...document.querySelectorAll(sel)].find(vis); return el ? { el, r: el.getBoundingClientRect() } : null; };
  const rows = [];
  const add = (rule, val, pass) => rows.push({ rule, val, pass });
  const top = R('[data-pz="flow-top"]');
  const col = R('[data-pz="flow-col"]');
  const stage = R('[data-pz="flow-stage"]');
  const foot = R('[data-pz="flow-foot"]');
  const body = R('[data-pz="flow-body"]');
  if (top) {
    const s = top.el.querySelector('.pz-topbar__slot--start').getBoundingClientRect();
    const e = top.el.querySelector('.pz-topbar__slot--end').getBoundingClientRect();
    const t = top.el.querySelector('[data-pz="flow-title"]').getBoundingClientRect();
    const dx = (t.left + t.right) / 2 - (top.r.left + top.r.right) / 2;
    add('FS3', `좌 ${f(s.width)} / 우 ${f(e.width)} · 제목 중심 Δ${f(dx)}`, Math.abs(s.width - e.width) <= 1 && Math.abs(dx) <= 2);
  }
  if (col) {
    add('FS9', `컬럼 폭 ${f(col.r.width)} (≤ 640)`, col.r.width <= 640.5);
    if (stage) {
      const dx = (col.r.left + col.r.right) / 2 - (stage.r.left + stage.r.right) / 2;
      add('FS1', `컬럼 중심 Δ${f(dx)}`, Math.abs(dx) <= 2);
    }
    if (top && body) {
      const bottom = foot ? foot.r.top : body.r.bottom;
      const up = col.r.top - top.r.bottom, down = bottom - col.r.bottom;
      const tol = (bottom - top.r.bottom) * 0.08;
      const scrolling = body.el.scrollHeight > body.el.clientHeight + 1;
      add('FS7', scrolling ? `본문이 내부 스크롤(위 ${f(up)}/아래 ${f(down)}) — 높이 부족, 판정 제외` : `본문 위 ${f(up)}/아래 ${f(down)} (허용 ±${f(tol)})`, scrolling || Math.abs(up - down) <= tol);
    }
  }
  return rows;
}

/** 보조 뷰포트(390×600, 1280×420): 하단 CTA 가 화면 안에서 눌리는지 */
export function measureCtaReach() {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const foot = [...document.querySelectorAll('[data-pz="flow-foot"]')].find(vis);
  const cta = foot ? [...foot.querySelectorAll('[data-pz="flow-cta"]')].find(vis) : null;
  if (!cta) return [{ rule: 'P14', val: '하단 주 버튼 없음(해당 없음)', pass: true }];
  // 시트가 열린 케이스는 시트가 CTA 를 덮고 푸터가 inert 이다(FR6 이 별도로 검사) — 눌림 판정은 해당 없음
  const openSheet = [...document.querySelectorAll('[data-pz="flow-sheet"]')].find(vis);
  if (openSheet) return [{ rule: 'P14', val: '시트 열림 — 푸터 inert, CTA 눌림 판정 해당 없음(FR6 에서 검사)', pass: true }];
  const r = cta.getBoundingClientRect();
  const inside = r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5 && r.bottom <= vh + 0.5;
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const hit = !!top && cta.contains(top);
  return [{ rule: 'P14', val: `CTA ${Math.round(r.width)}×${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)} · 화면 안 ${inside ? '예' : '아니오'} · 눌림 ${hit ? '예' : '아니오'}`, pass: inside && hit }];
}

/** 하니스가 노출한 기대값(window.__flowExpect) — 규칙 기대값의 정본은 lib/class/flow/expect.ts 한 곳 */
export async function readExpected(page, ref, query = '') {
  return page.evaluate(([r, q]) => window.__flowExpect(r, q), [ref, query]);
}

/* ───────────────────────── 소스 정적 검사 (FR4 소스판) ───────────────────────── */

export const SRC_GLYPH = '[\\u{1F000}-\\u{1FFFF}\\u{2190}-\\u{21FF}\\u{2300}-\\u{23FF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}✓✔✕✗✘→←↑↓›‹▶▷●○★☆×•]';
/** 영역별 금지어 정규식 소스(JSON 정본: banned/{common,meditation,counseling}.json) */
function readBannedRules(name) {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'banned', `${name}.json`), 'utf8'));
}
/** 영역 전용 항목을 앞에, 공통 항목을 뒤에 `|` 로 이어 붙인다. meditation 결과는 SDD-209 의 BANNED_COPY 원문과 같다 */
export function composeBanned(area = 'meditation') {
  return [...readBannedRules(area), ...readBannedRules('common')].join('|');
}
/** verify P7(금지 용어) + P8(금지 표현) — 사용자에게 보이는 글자에 쓰면 안 되는 말. 현행 하니스는 명상(클래스) 영역 정책을 쓴다 */
export const BANNED_COPY = composeBanned('meditation');
/** 신규 경로에서 쓰면 안 되는 식별자 (verify P8 소스판) */
export const BANNED_IDENT = 'participant_token|by-code|getSessionByCode|joinSessionByCode|VITE_FLOW_API_FALLBACK|w-vmeter|iconmeter';
export const EYEBROW_ALLOW = ['LINK BAND', 'MIND BREEZE'];

/** 주석을 지운 소스 문자열. 문자열 안의 `//` (예: https://) 는 건드리지 않도록 줄 시작·공백 뒤 `//` 만 주석으로 본다 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out.sort();
}

/** 신규 경로 소스 스캔. 반환: { files, hits: [{ file, kind, text }] } */
export function scanSources(roots, exts = ['.ts', '.tsx', '.css'], area = 'meditation') {
  const glyphRe = new RegExp(SRC_GLYPH, 'gu');
  const bannedRe = new RegExp(composeBanned(area), 'g');
  const identRe = new RegExp(BANNED_IDENT, 'g');
  const hits = [];
  const files = roots.flatMap((root) => listFiles(root, exts));
  for (const file of files) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of new Set(src.match(glyphRe) || [])) hits.push({ file, kind: 'srcGlyph', text: m });
    for (const m of new Set(src.match(bannedRe) || [])) hits.push({ file, kind: 'srcBanned', text: m });
    for (const m of new Set(src.match(identRe) || [])) hits.push({ file, kind: 'srcStale', text: m });
  }
  return { files, hits };
}

export function sourceRows(roots) {
  const { files, hits } = scanSources(roots);
  const rel = (f) => path.relative(FRONTEND_ROOT, f);
  return [{
    id: 'src', vp: 'src', rule: 'FR4',
    val: hits.length ? hits.slice(0, 5).map((h) => `${rel(h.file)} ${h.kind}:${h.text}`).join(' | ') : `소스 ${files.length}개 srcGlyph 0 · srcBanned 0 · srcStale 0`,
    pass: hits.length === 0,
  }];
}

export function fitConfig(ref) {
  const { screen, key } = splitRef(ref);
  return { named: FLOW_NAMED, empties: FLOW_EMPTIES, forbidCoral: forbidsCoral(screen, key), overlayCoverable: [] };
}

export function copyConfig(area = 'meditation') {
  return { glyph: SRC_GLYPH, banned: composeBanned(area), eyebrowAllow: EYEBROW_ALLOW };
}
