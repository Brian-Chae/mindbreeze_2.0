/**
 * [MB261026][FIX] 채팅 신고 운영 처리·게시 필터 — 실렌더 검증 (verify V-53~V-56).
 *
 * 로컬 백엔드(dev 시뮬레이션 켬, 로컬 PG) + 로컬 프론트에서만 돈다. dev·운영 서버에 접속하지 않는다.
 * 계정·대화는 합성(E2E-…@example.invalid). 메일 발송 없음(운영 신고 주소 미설정, 메일 워커 없음).
 *
 * 실행:
 *   E2E_BASE=http://127.0.0.1:18472 E2E_API=http://127.0.0.1:18471/api/v1 \
 *   E2E_DATABASE_URL=postgresql://localhost:5432/<로컬 DB> E2E_PYTHON=<backend venv python> \
 *   node e2e/chat-report-moderation.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const evidence = path.join(root, 'specs/fix-chat-report-moderation/evidence');
mkdirSync(evidence, { recursive: true });

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:18472';
const API = process.env.E2E_API ?? 'http://127.0.0.1:18471/api/v1';
const DB_URL = process.env.E2E_DATABASE_URL ?? '';
const PYTHON = process.env.E2E_PYTHON ?? 'python3';
for (const url of [BASE, API, DB_URL]) {
  assert.match(url, /^(https?|postgresql):\/\/(127\.0\.0\.1|localhost)[:/]/, `로컬 주소만 허용: ${url}`);
}

const tag = Date.now().toString(36);
const results = [];
const consoleErrors = [];
const serverErrors = [];
// 로컬 환경 잡음(이 카드와 무관, 결과 JSON 에 따로 기록): VAPID 키 미설정 → web-push 공개키 503,
// 로컬 Socket.IO 핸드셰이크 거부(backend/app/ws 는 이번 변경 범위 밖). 메시지 전송은 REST 라 영향 없다.
const ENV_NOISE = [/web-push\/public-key/, /status of 503 \(Service Unavailable\)/, /WebSocket connection to .*socket\.io/, /\[WS\] socket\.io connect error/];
const ignoredEnvNoise = [];
const isNoise = (text) => ENV_NOISE.some((re) => re.test(text));
const MESSAGE = 'E2E 신고 대상 메시지';
const TERM = `e2e금칙${tag.slice(-3)}`;

async function step(name, fn) {
  console.log(`실행: ${name}`);
  try {
    const detail = await fn();
    results.push({ name, status: 'PASS', detail: detail ?? null });
    console.log(`PASS: ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: String(error.message).slice(0, 400) });
    console.log(`FAIL: ${name} — ${error.message}`);
    throw error;
  } finally {
    writeFileSync(
      path.join(evidence, 'e2e-results.json'),
      JSON.stringify({ synthetic: true, base: BASE, api: API, results, consoleErrors, serverErrors, ignoredEnvNoise }, null, 2),
    );
  }
}

async function api(method, url, body, token) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return text ? JSON.parse(text) : null;
}

const devUser = (role, label) =>
  api('POST', '/dev/auth/users', { name: `E2E${label}`, email: `e2e-${label}-${tag}@example.invalid`, role });
const token = async (user) => (await api('POST', '/dev/auth/login', { user_id: user.id })).access_token;
const link = (counselor, client) =>
  execFileSync(PYTHON, [path.join(dir, 'chat-report-moderation-fixture.py'), 'link', counselor.id, client.id], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: DB_URL },
  }).trim();

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function login(user, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const entry = { who: user.name, text: msg.text().slice(0, 300) };
    (isNoise(entry.text) ? ignoredEnvNoise : consoleErrors).push(entry);
  });
  page.on('response', (res) => {
    if (res.status() < 500) return;
    const entry = { who: user.name, url: res.url().replace(/[?#].*/, ''), status: res.status() };
    (isNoise(entry.url) ? ignoredEnvNoise : serverErrors).push(entry);
  });
  await page.goto(`${BASE}/terms`);
  const loggedIn = await page.evaluate(async ({ apiBase, userId }) => {
    const res = await fetch(`${apiBase}/dev/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const body = await res.json();
    localStorage.setItem('mb_user', JSON.stringify(body.user));
    return res.ok;
  }, { apiBase: API, userId: user.id });
  assert.ok(loggedIn, 'dev 로그인 실패');
  return { context, page };
}

let admin, host, member, host2, room, room2, reportId;
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

try {
  await step('합성 계정·대화·신고 준비(로컬 API)', async () => {
    admin = await devUser('platform_admin', '관리자');
    host = await devUser('counselor', '상담사');
    host2 = await devUser('counselor', '상담사2');
    member = await devUser('client', '회원');
    assert.equal(link(host, member), 'ok');
    assert.equal(link(host2, member), 'ok');
    const hostToken = await token(host);
    const memberToken = await token(member);
    room = (await api('POST', '/chat/rooms', { room_type: 'direct', client_id: member.id }, hostToken)).id;
    room2 = (await api('POST', '/chat/rooms', { room_type: 'direct', client_id: member.id }, await token(host2))).id;
    const msg = await api('POST', `/chat/rooms/${room}/messages`, { content: MESSAGE, type: 'text' }, hostToken);
    const report = await api(
      'POST',
      '/chat/reports',
      { target_user_id: host.id, room_id: room, message_id: msg.id, reason: 'abuse', operation_key: `e2e-${tag}` },
      memberToken,
    );
    reportId = report.report_id;
    return { reportId: '[합성 ID]' };
  });

  const adminDesk = await login(admin, DESKTOP);
  const { page } = adminDesk;

  await step('V-53 관리자: 사이드바 → 신고 목록 → 메시지 보기 → 검토 시작 → 조치 없음 종결', async () => {
    await page.goto(`${BASE}/admin/orgs`);
    await page.getByRole('link', { name: '채팅 신고' }).first().click();
    await page.waitForURL('**/admin/chat-reports');
    const row = page.locator('tbody tr', { hasText: 'E2E상담사' }).first();
    await row.waitFor();
    assert.match(await row.innerText(), /접수/);
    assert.equal(await page.getByText(MESSAGE).count(), 0, '목록에 발췌가 보이면 안 된다');
    await page.screenshot({ path: path.join(evidence, 'admin-list-desktop-1440.png'), fullPage: true });

    await row.click();
    await page.getByRole('button', { name: '신고된 메시지 보기' }).click();
    await page.getByText(MESSAGE).waitFor();
    await page.getByRole('button', { name: '검토 시작' }).click();
    await page.getByText('검토 중(으)로 바꿨습니다.').waitFor();
    await page.locator('textarea[name="resolution-note"]').fill('E2E 확인: 위반 아님');
    await page.getByRole('button', { name: '조치 없음 종결' }).click();
    await page.getByText('조치 없음(으)로 바꿨습니다.').waitFor();
    const history = page.locator('ol[aria-label="처리 이력"] li');
    assert.equal(await history.count(), 2);
    assert.match(await history.nth(1).innerText(), /검토 중 → 조치 없음 · E2E 확인: 위반 아님/);
    const badge = page.locator('section[aria-label="신고 상세"] span', { hasText: '조치 없음' }).first();
    const bg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)', '상태 배지 배경색이 실제로 적용돼야 한다');
    await page.screenshot({ path: path.join(evidence, 'admin-detail-desktop-1440.png'), fullPage: true });
    return { badgeBackground: bg };
  });

  await step('V-53 모바일 390 렌더', async () => {
    const mobile = await login(admin, MOBILE);
    await mobile.page.goto(`${BASE}/admin/chat-reports`);
    await mobile.page.locator('tbody tr').first().waitFor();
    await mobile.page.screenshot({ path: path.join(evidence, 'admin-list-mobile-390.png'), fullPage: true });
    await mobile.context.close();
  });

  const memberCtx = await login(member, MOBILE);
  const mp = memberCtx.page;

  await step('V-54 금칙어 등록 → 회원 전송 차단(원문 유지) → 삭제 → 재전송 성공', async () => {
    await page.getByRole('tab', { name: '금칙어' }).click();
    await page.locator('input[name="filter-term"]').fill(TERM);
    await page.getByRole('button', { name: '추가', exact: true }).click();
    await page.locator('li', { hasText: TERM }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'admin-terms-desktop-1440.png'), fullPage: true });

    await mp.goto(`${BASE}/app/chat/${room2}`);
    const textarea = mp.locator('textarea').first();
    await textarea.waitFor();
    const text = `이건 ${TERM} 입니다`;
    await textarea.fill(text);
    await mp.getByRole('button', { name: '전송', exact: true }).click();
    await mp.getByRole('alert').filter({ hasText: '운영정책에 맞지 않는 표현' }).waitFor();
    assert.equal(await textarea.inputValue(), text, '입력란에 원문이 남아야 한다');
    assert.equal(await mp.getByRole('button', { name: '다시보내기' }).count(), 0, '다시보내기 버튼이 없어야 한다');
    const bubbles = mp.locator('.chat-room [data-message-id]', { hasText: text });
    assert.equal(await bubbles.count(), 0, '막힌 메시지는 목록에 없어야 한다');
    await mp.screenshot({ path: path.join(evidence, 'member-blocked-mobile-390.png'), fullPage: true });

    const termRow = page.locator('li', { hasText: TERM });
    await termRow.getByRole('button', { name: '삭제', exact: true }).click();
    await termRow.getByRole('button', { name: '삭제 확인' }).click();
    await termRow.waitFor({ state: 'detached' });

    await mp.getByRole('button', { name: '전송', exact: true }).click();
    await bubbles.first().waitFor();
    assert.equal(await textarea.inputValue(), '');
    await mp.screenshot({ path: path.join(evidence, 'member-sent-mobile-390.png'), fullPage: true });
  });

  await step('V-55 회원은 관리자 신고 화면을 볼 수 없다', async () => {
    await mp.goto(`${BASE}/admin/chat-reports`);
    await mp.waitForLoadState('networkidle');
    assert.equal(await mp.locator('select[aria-label="신고 상태 필터"]').count(), 0);
    assert.equal(await mp.getByRole('tab', { name: '금칙어' }).count(), 0);
    return { landedOn: new URL(mp.url()).pathname };
  });

  await step('V-56 콘솔 error 0 · 5xx 0 (V-54 의 의도된 422 1건 제외)', async () => {
    assert.deepEqual(serverErrors, []);
    const expected = consoleErrors.filter((e) => e.who === member.name && /status of 422/.test(e.text));
    assert.equal(expected.length, 1, '금칙어 차단 422 는 정확히 1번');
    assert.deepEqual(consoleErrors.filter((e) => !expected.includes(e)), []);
    return { expected422: expected.length, ignoredEnvNoise: ignoredEnvNoise.length };
  });

  await memberCtx.context.close();
  await adminDesk.context.close();
} finally {
  await browser.close();
}
console.log(`완료: ${results.filter((r) => r.status === 'PASS').length}/${results.length} PASS`);
