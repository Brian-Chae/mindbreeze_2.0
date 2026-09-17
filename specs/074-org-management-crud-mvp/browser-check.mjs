// 실행: PLAYWRIGHT_PACKAGE=/절대경로/playwright node specs/074-org-management-crud-mvp/browser-check.mjs
// 개발 서버 기본 포트: 5187. API만 모의하며 실제 React 화면과 Chrome을 검증한다.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const evidenceDir = new URL('./evidence/', import.meta.url);
await mkdir(evidenceDir, { recursive: true });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('mb_access_token', 'test-token');
  localStorage.setItem('mb_user', JSON.stringify({ id: 'admin', name: '관리자', role: 'platform_admin', email: 'admin@test.com' }));
});
const orgs = [
  { id: 'one', name: '서울 센터', org_code: 'ORG001', phone: '02-1234', verified: true, kind: 'institution', has_primary_admin: true, created_at: '2026-01-01T18:00:00Z' },
  { id: 'two', name: '개인 상담소', org_code: 'ORG002', phone: null, verified: false, kind: 'individual', has_primary_admin: false, created_at: '2026-02-01T00:00:00Z' },
];
const members = [
  { id: 'a', name: '박담당', email: 'admin@center.com', counselor_code: null, role: 'org_admin', status: 'pending', is_primary_admin: true, is_owner: false },
  { id: 'b', name: '김상담', email: 'counselor@center.com', counselor_code: 'ABC123', role: 'counselor', status: 'active', is_primary_admin: false, is_owner: false },
  { id: 'c', name: '이확인', email: 'unknown@center.com', counselor_code: null, role: 'counselor', status: 'future', is_primary_admin: false, is_owner: false },
];
let failMembers = true;
let failDetail = false;
let failList = false;
let emptyMembers = false;
let detailCalls = 0;
let memberCalls = 0;
let resendCalls = 0;
await page.route('**/api/v1/**', async (route) => {
  const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
  let body = {};
  let status = 200;
  if (path === '/admin/orgs') { body = orgs; if (failList) status = 500; }
  else if (path.endsWith('/resend-invite')) { resendCalls++; body = { invite_sent: true }; }
  else if (path.endsWith('/counselors')) {
    memberCalls++;
    if (failMembers) status = 500;
    body = emptyMembers ? [] : path.includes('/two/') ? [{ ...members[1], id: 'owner', is_owner: true }] : members;
  } else if (path.startsWith('/admin/orgs/')) {
    detailCalls++;
    if (failDetail) status = 500;
    const org = path.endsWith('two') ? orgs[1] : orgs[0];
    body = { ...org, address: '서울시 강남구', verified_at: null, version: null,
      primary_admin: org.id === 'one' ? { ...members[0], phone: null } : null,
      owner: org.id === 'two' ? { ...members[1], id: 'owner', phone: null } : null };
  } else if (path.includes('notifications')) body = { items: [], total: 0, unread: 0 };
  else if (path.includes('/chat/rooms')) body = { rooms: [], total: 0 };
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
});
const opener = page.getByRole('button', { name: '서울 센터', exact: true });
const dialog = page.getByRole('dialog');
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5187/admin/orgs');
  await opener.waitFor();
  await page.getByLabel('기관 검색', { exact: true }).fill('org002');
  assert.equal(await opener.count(), 0);
  await page.getByRole('button', { name: '검색 초기화' }).click();
  await page.getByLabel('인증 여부').selectOption('unverified');
  assert.equal(await opener.count(), 0);
  await page.getByRole('button', { name: '검색 초기화' }).click();
  await page.getByLabel('기관 유형', { exact: true }).selectOption('individual');
  assert.equal(await opener.count(), 0);
  await page.getByRole('button', { name: '검색 초기화' }).click();
  await page.getByLabel('유형별 그룹핑').check();
  assert.equal(await page.getByRole('heading', { name: '일반 기관 · 1개' }).count(), 1);
  await page.getByRole('button', { name: '서울 센터 기관 코드 복사' }).click();
  assert.equal(await dialog.count(), 0);
  await opener.locator('xpath=ancestor::tr').getByRole('button', { name: '초대 재발송', exact: true }).click();
  assert.equal(await dialog.count(), 0);
  await page.waitForFunction(() => document.body.textContent.includes('초대 메일을 다시 발송했습니다.'));
  assert.equal(resendCalls, 1);
  await opener.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  await dialog.getByText('서울시 강남구', { exact: true }).waitFor();
  await dialog.getByRole('tab', { name: '상담사 (조회 실패)', exact: true }).waitFor();
  assert.equal(await dialog.getByText('2026. 01. 02.', { exact: true }).count(), 1);
  await dialog.getByRole('tab', { name: '상담사 (조회 실패)', exact: true }).click();
  assert.equal(await dialog.getByText('소속 상담사가 없습니다.', { exact: true }).count(), 0);
  const callsBeforeRetry = detailCalls;
  failMembers = false;
  await dialog.getByRole('button', { name: '다시 시도' }).click();
  await dialog.getByRole('cell', { name: 'ABC123', exact: true }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('counselors-desktop.png', evidenceDir)) });
  assert.equal(detailCalls, callsBeforeRetry);
  await dialog.getByLabel('상담사 검색', { exact: true }).fill('abc123');
  assert.equal(await dialog.getByRole('row').count(), 2);
  await dialog.getByLabel('상담사 검색', { exact: true }).fill('');
  await dialog.getByLabel('상담사 역할', { exact: true }).selectOption('org_admin');
  assert.equal(await dialog.getByRole('cell', { name: '가입 대기', exact: true }).count(), 1);
  await dialog.getByLabel('상담사 역할', { exact: true }).selectOption('');
  await dialog.getByLabel('상담사 상태', { exact: true }).selectOption('unknown');
  assert.equal(await dialog.getByRole('cell', { name: '확인 필요', exact: true }).count(), 1);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement?.closest('dialog') !== null));
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent === '서울 센터');
  await page.keyboard.press('Space');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '기관 상세 닫기' }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === '서울 센터');
  failDetail = true;
  await opener.locator('xpath=ancestor::tr').getByRole('cell', { name: '02-1234', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  await dialog.getByRole('tab', { name: '상담사 (3)', exact: true }).waitFor();
  const membersBeforeRetry = memberCalls;
  failDetail = false;
  await dialog.getByRole('button', { name: '다시 시도' }).click();
  await dialog.getByText('서울시 강남구', { exact: true }).waitFor();
  assert.equal(memberCalls, membersBeforeRetry);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '개인 상담소', exact: true }).click();
  await dialog.getByRole('heading', { name: '소유자', exact: true }).waitFor();
  await dialog.getByRole('tabpanel', { name: '기관 정보' }).getByText('ABC123', { exact: true }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('owner-desktop.png', evidenceDir)) });
  assert.equal(await dialog.getByText('담당자 미지정', { exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  assert(box.width <= 390 && box.height <= 844 * 0.85 + 1);
  await page.screenshot({ path: fileURLToPath(new URL('owner-mobile.png', evidenceDir)) });
  await page.keyboard.press('Escape');
  failList = true;
  await page.reload();
  await page.getByRole('button', { name: '다시 시도' }).waitFor();
  failList = false;
  await page.getByRole('button', { name: '다시 시도' }).click();
  await opener.waitFor();
  emptyMembers = true;
  await opener.click();
  await dialog.getByRole('tab', { name: '상담사 (0)', exact: true }).click();
  await dialog.getByText('소속 상담사가 없습니다.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: 목록 검색/필터/그룹, 코드/재초대 전파, 두 요청 독립 재시도, 상담사 검색/필터, Enter/Space/Escape/포커스 격리·복귀, 개인 소유자, 모바일, 목록 재시도');
} catch (error) {
  console.error('진단', page.url(), errors, (await page.locator('body').innerText()).slice(0, 3000));
  throw error;
} finally { await browser.close(); }
