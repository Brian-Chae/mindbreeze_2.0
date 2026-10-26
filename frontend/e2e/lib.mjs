// SDD-204/205 공통 도구: 시나리오 실행기, 로그인, 오류 수집
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

export const BASE = process.env.BASE_URL || 'https://dev.mindbreeze.looxidlabs.com';
export const API = process.env.API_URL || 'https://dev-api.mindbreeze.looxidlabs.com/api/v1';
export const PW = process.env.E2E_PASSWORD;
export const DOMAIN = 'e2e.looxidlabs.com';
export const EMAIL = { client: `e2e-client@${DOMAIN}`, counselor: `e2e-counselor@${DOMAIN}`, org_admin: `e2e-orgadmin@${DOMAIN}`, platform_admin: `e2e-admin@${DOMAIN}` };
if (!PW) {
  console.error('E2E_PASSWORD 필요');
  process.exit(2);
}

export const browser = await chromium.launch({ headless: true });
export const results = [];

// 한 시나리오 = 새 브라우저 컨텍스트. 페이지 오류·5xx 응답이 있으면 실패 처리.
export async function scenario(name, fn, { mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  const started = Date.now();
  let error = null;
  try { await fn(page); } catch (e) { error = e.message.split('\n')[0]; }
  if (!error && problems.length) error = problems.slice(0, 3).join(' | ');
  results.push({ name, ok: !error, error, ms: Date.now() - started });
  console.log(`${error ? 'FAIL' : 'PASS'}  ${name}${error ? ' — ' + error : ''}`);
  await ctx.close();
}

export async function uiLogin(page, role, expectPath) {
  await page.goto(`${BASE}/login?role=${role}`, { waitUntil: 'domcontentloaded' });
  await page.click(`#login-tab-${role}`);
  await page.fill('#login-email', EMAIL[role]);
  await page.fill('#login-password', PW);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((u) => u.pathname.startsWith(expectPath), { timeout: 20000 });
}

export const HOME = { client: '/app', counselor: '/dashboard', org_admin: '/dashboard/org' };

export async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
}

export async function bodyText(page) {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

// 페이지 이동 후 본문에 기대 문구가 모두 있는지 확인 (에러 화면 감지 포함)
export async function expectText(page, path, ...texts) {
  await go(page, path);
  // 설정 화면의 그룹은 접힌 <details> 라 innerText 에 내용이 안 잡힌다 — 전부 펼친 뒤 읽는다.
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  const t = await bodyText(page);
  if (/Something went wrong|문제가 발생했습니다|페이지를 찾을 수 없/.test(t.slice(0, 600))) throw new Error(`${path} 에러 화면`);
  for (const x of texts) if (!t.includes(x)) throw new Error(`${path}: "${x}" 없음 (본문: ${t.slice(0, 200)})`);
  return t;
}

export async function apiLogin(role) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL[role], password: PW }) });
  if (!r.ok) throw new Error(`api login ${role} ${r.status}`);
  return (await r.json()).access_token;
}

export async function apiLoginFull(role) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL[role], password: PW }) });
  if (!r.ok) throw new Error(`api login ${role} ${r.status}`);
  const j = await r.json();
  return { token: j.access_token, user: j.user };
}

export async function finish(file, label) {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  writeFileSync(new URL(`./${file}`, import.meta.url), JSON.stringify({ base: BASE, label, results, failed: failed.length }, null, 2));
  console.log(`\n${label} 결과: ${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
}
