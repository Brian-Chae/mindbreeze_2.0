// SDD-204 스모크 러너: dev 배포 직후 핵심 시나리오 7개를 실행한다.
// 실행: E2E_PASSWORD=... node e2e/smoke.mjs   (BASE_URL/API_URL 로 대상 변경 가능)
// 종료코드: 0=전부 통과, 1=하나 이상 실패. 결과는 e2e/smoke-result.json 에 저장.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'https://dev.mindbreeze.looxidlabs.com';
const API = process.env.API_URL || 'https://dev-api.mindbreeze.looxidlabs.com/api/v1';
const PW = process.env.E2E_PASSWORD;
const DOMAIN = 'e2e.looxidlabs.com';
if (!PW) {
  console.error('E2E_PASSWORD 필요');
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const results = [];

// 한 시나리오 = 새 브라우저 컨텍스트. 페이지 오류·5xx 응답이 있으면 실패 처리한다.
async function scenario(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const started = Date.now();
  let error = null;
  try {
    await fn(page);
  } catch (e) {
    error = e.message.split('\n')[0];
  }
  if (!error && problems.length) error = problems.slice(0, 3).join(' | ');
  results.push({ name, ok: !error, error, ms: Date.now() - started });
  console.log(`${error ? 'FAIL' : 'PASS'}  ${name}${error ? ' — ' + error : ''}`);
  await ctx.close();
}

async function uiLogin(page, role, email, expectPath) {
  await page.goto(`${BASE}/login?role=${role}`, { waitUntil: 'domcontentloaded' });
  await page.click(`#login-tab-${role}`);
  await page.fill('#login-email', email);
  await page.fill('#login-password', PW);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((u) => u.pathname.startsWith(expectPath), { timeout: 20000 });
}

// 로드 확인: 에러 화면이 아니고 본문이 렌더링되는지
async function expectLoaded(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
  const text = await page.locator('body').innerText();
  if (/Something went wrong|문제가 발생|오류가 발생했습니다|404/.test(text.slice(0, 400)) || text.trim().length < 20) {
    throw new Error(`${path} 렌더링 이상`);
  }
}

await scenario('1. 로그인 화면 + 서버 상태', async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email');
  const r = await fetch(`${API.replace(/\/api\/v1$/, '')}/health`);
  if (!r.ok) throw new Error(`health ${r.status}`);
});

await scenario('2. 회원(내담자) 로그인 → 앱 홈', async (page) => {
  await uiLogin(page, 'client', `e2e-client@${DOMAIN}`, '/app');
  await expectLoaded(page, '/app');
});

await scenario('3. 코치 로그인 → 대시보드', async (page) => {
  await uiLogin(page, 'counselor', `e2e-counselor@${DOMAIN}`, '/dashboard');
});

await scenario('4. 기관 관리자 로그인 → 기관 대시보드', async (page) => {
  await uiLogin(page, 'org_admin', `e2e-orgadmin@${DOMAIN}`, '/dashboard/org');
});

await scenario('5. 플랫폼 관리자 로그인(API)', async () => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `e2e-admin@${DOMAIN}`, password: PW }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const j = await r.json();
  if (j.user?.role !== 'platform_admin') throw new Error(`role=${j.user?.role}`);
});

await scenario('6. 코치 주요 페이지 로딩', async (page) => {
  await uiLogin(page, 'counselor', `e2e-counselor@${DOMAIN}`, '/dashboard');
  for (const p of ['/clients', '/sessions', '/reports', '/chat']) await expectLoaded(page, p);
});

await scenario('7. 기관 관리자 주요 페이지 로딩', async (page) => {
  await uiLogin(page, 'org_admin', `e2e-orgadmin@${DOMAIN}`, '/dashboard/org');
  for (const p of ['/org/counselors', '/chat']) await expectLoaded(page, p);
});

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(new URL('./smoke-result.json', import.meta.url), JSON.stringify({ base: BASE, results, failed: failed.length }, null, 2));
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
