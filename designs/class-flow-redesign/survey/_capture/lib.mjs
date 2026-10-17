// 회원 클래스 사전 흐름 현행 UI 캡처 공용 헬퍼. 계정·토큰은 환경변수로만 받는다(파일에 남기지 않음).
import pw from '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/frontend/node_modules/playwright/index.js';
import fs from 'node:fs';

export const { chromium } = pw;
export const BASE = 'https://dev.mindbreeze.looxidlabs.com';
export const API = 'https://dev-api.mindbreeze.looxidlabs.com/api/v1';
export const OUT = '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/designs/class-flow-redesign/shots/current-member';
export const METRICS = '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/designs/class-flow-redesign/survey/_capture/scroll-metrics.json';
export const VPS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 834, height: 1194 },
  desktop: { width: 1280, height: 720 },
};

export async function apiLogin(email, password) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${email} ${r.status}`);
  return r.json();
}
export const authH = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

export async function launch({ fakeMedia = true } = {}) {
  const args = fakeMedia ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : [];
  return chromium.launch({ channel: 'chrome', headless: true, args });
}

/** 뷰포트 3종 컨텍스트+페이지. login=true 면 UI 로 회원 로그인. */
export async function makePages(browser, { login = false, permissions = [], ignoreHTTPS = true } = {}) {
  const out = {};
  for (const [name, vp] of Object.entries(VPS)) {
    const ctx = await browser.newContext({
      viewport: vp,
      deviceScaleFactor: 1,
      isMobile: name === 'mobile',
      hasTouch: name !== 'desktop',
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      permissions,
      ignoreHTTPSErrors: ignoreHTTPS,
    });
    const page = await ctx.newPage();
    page.on('pageerror', () => {});
    if (login) await uiLogin(page, process.env.MB_CLIENT_EMAIL, process.env.MB_CLIENT_PW);
    out[name] = { ctx, page, vp };
  }
  return out;
}

export async function uiLogin(page, email, pw) {
  await page.goto(`${BASE}/login?role=client`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-email', email);
  await page.fill('#login-password', pw);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/app/, { timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

export async function measure(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const doc = document.documentElement.scrollHeight - vh;
    const inner = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      if (el.clientHeight < 80) continue;
      const over = el.scrollHeight - el.clientHeight;
      if (over > 1) inner.push({ el: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).slice(0, 3).join('.') : ''}`, clientH: el.clientHeight, scrollH: el.scrollHeight, over });
    }
    inner.sort((a, b) => b.over - a.over);
    return { innerHeight: vh, docScrollHeight: document.documentElement.scrollHeight, docOverflowPx: Math.max(0, doc), innerScrollers: inner.slice(0, 3) };
  });
}

export function recordMetric(id, vpName, m) {
  let all = {};
  try { all = JSON.parse(fs.readFileSync(METRICS, 'utf8')); } catch { /* 최초 */ }
  all[id] = { ...(all[id] ?? {}), [vpName]: m };
  fs.writeFileSync(METRICS, JSON.stringify(all, null, 1));
}

/** 현재 페이지 상태를 3 뷰포트 각각 촬영(뷰포트 크기 그대로) + 스크롤 실측 기록 */
export async function shootAll(id, pages, { settle = 800, full = false } = {}) {
  for (const [name, { page }] of Object.entries(pages)) {
    await page.waitForTimeout(settle);
    // 실시간 알림 토스트(ClientShell)는 소켓 연결 시 과거 알림으로 뜬다 — 비교 노이즈라 닫고 촬영(존재 사실은 조사서에 기록)
    await page.locator('span[role=button]', { hasText: '✕' }).first().click({ timeout: 300 }).catch(() => {});
    await page.waitForTimeout(150);
    const m = await measure(page);
    recordMetric(id, name, m);
    await page.screenshot({ path: `${OUT}/${id}-${name}.png`, fullPage: false });
    if (full && m.docOverflowPx > 1) {
      fs.mkdirSync(`${OUT}/full`, { recursive: true });
      await page.screenshot({ path: `${OUT}/full/${id}-${name}-full.png`, fullPage: true });
    }
    console.log(id, name, 'docOverflow', m.docOverflowPx, 'inner', JSON.stringify(m.innerScrollers.map((i) => i.over)));
  }
}

export async function forEachPage(pages, fn) {
  await Promise.all(Object.entries(pages).map(([name, p]) => fn(p.page, name, p)));
}
export async function closeAll(browser, pages) {
  for (const p of Object.values(pages)) await p.ctx.close().catch(() => {});
  await browser.close();
}
