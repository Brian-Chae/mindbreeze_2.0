import { createClassFixture } from './class-fixture.mjs';
import { randomUUID } from 'node:crypto';
// 전수조사 E2E — 기업(기관) > 상담사 > 회원가입 > 로그인 > 클래스 참여 > 리포트 발송
// 실행: E2E_PASSWORD=... node e2e/full-journey.mjs   (BASE_URL/API_URL 로 대상 변경 가능)
// 종료코드: 0=전부 통과, 1=하나 이상 실패. 결과는 e2e/full-journey-result.json 에 저장.
//
// 계정: e2e_seed.py 가 시드한 4역할(e2e-client/counselor/orgadmin/admin @e2e.looxidlabs.com).
//   회원가입(OTP)은 dev 서버 Redis 에서 OTP 를 읽는 헬퍼를 쓰며, SSH 접근이 없으면
//   해당 시나리오는 SKIP 으로 처리된다(CI 에서는 폼·검증·OTP 요청까지만 검증).
import { execSync } from 'node:child_process';
import { scenario, uiLogin, go, bodyText, expectText, apiLogin, apiLoginFull, finish, BASE, API, EMAIL, HOME, DOMAIN } from './lib.mjs';

const TITLE = `E2E-전수-${Date.now()}`;

// ── 공용: 상담사/내담자 토큰 캐시 ───────────────────────────────────────
let couToken = null;
let couUser = null;
let cliToken = null;
let cliUser = null;
async function counselor() {
  if (!couToken) { const r = await apiLoginFull('counselor'); couToken = r.token; couUser = r.user; }
  return { token: couToken, user: couUser };
}
async function client() {
  if (!cliToken) { const r = await apiLoginFull('client'); cliToken = r.token; cliUser = r.user; }
  return { token: cliToken, user: cliUser };
}
const H = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', 'X-Live-Protocol': '1,2' });

// ── 정리 헬퍼: 실패해도 클래스가 dev 에 남아 다음 실행이 409 schedule_conflict 로 연쇄 실패하지 않게 한다 ──
async function cleanupClass(token, classId, sessionId) {
  const out = [];
  try {
    if (sessionId) {
      // 진행 중이면 end, 오픈·예정 상태면 cancel(오픈 회차가 남으면 클래스 전이가 409 로 막힌다)
      const cur = await fetch(`${API}/sessions/${sessionId}`, { headers: H(token) });
      const st = cur.ok ? (await cur.json()).status : null;
      const op = st === 'in_progress' ? 'end' : ['open', 'ready', 'scheduled'].includes(st) ? 'cancel' : null;
      if (op) out.push(`${op} ${(await fetch(`${API}/sessions/${sessionId}/${op}`, { method: 'POST', headers: H(token) })).status}`);
    }
    for (const action of ['cancel', 'archive']) {
      const g = await fetch(`${API}/classes/${classId}`, { headers: H(token) });
      if (!g.ok) { out.push(`get ${g.status}`); break; }
      const detail = await g.json();
      if (action === 'cancel' && detail.status !== 'active') continue;
      if (action === 'archive' && !['completed', 'cancelled'].includes(detail.status)) continue;
      const t = await fetch(`${API}/classes/${classId}/transition`, { method: 'POST', headers: H(token),
        body: JSON.stringify({ operation_key: randomUUID(), expected_revision: detail.revision, action }) });
      out.push(`${action} ${t.status}`);
    }
  } catch (e) { out.push(`오류 ${e.message}`); }
  return out.join(', ');
}

/** 이전 실행이 남긴 E2E-전수-* 클래스 중 진행·대기 중인 것을 먼저 정리한다. */
async function purgeStaleClasses() {
  const c = await counselor();
  const r = await fetch(`${API}/sessions?limit=100`, { headers: H(c.token) });
  if (!r.ok) { console.log(`      사전 정리 목록 조회 ${r.status} — 건너뜀`); return; }
  const stale = ((await r.json()).sessions ?? []).filter((x) =>
    String(x.class_title ?? x.title ?? '').startsWith('E2E-전수-') && ['open', 'in_progress', 'ready', 'scheduled'].includes(x.status));
  for (const x of stale) console.log(`      사전 정리 ${x.id}: ${await cleanupClass(c.token, x.class_id, x.id)}`);
}

/** dev 서버 Redis 에서 OTP 를 읽는다(SSH). 접근 불가면 null. */
function readOtpFromRedis(email) {
  try {
    const out = execSync(
      `ssh -i ~/.ssh/mindbreeze/mindbreeze-dev-key.pem -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@18.183.86.88 "redis-cli GET 'otp:${email.toLowerCase()}'"`,
      { encoding: 'utf8', timeout: 10000 },
    );
    const code = out.trim();
    return /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// 1. 기업(기관) 계층
// ════════════════════════════════════════════════════════════════════════
await scenario('[기업] 기관 관리자 로그인 → 대시보드(기관명·코드·실적)', async (p) => {
  await uiLogin(p, 'org_admin', HOME.org_admin);
  await expectText(p, '/dashboard/org', 'E2E-테스트기관', 'E2E001', '소속 상담사 실적');
});

await scenario('[기업] 소속 상담사 목록 노출', async (p) => {
  await uiLogin(p, 'org_admin', HOME.org_admin);
  await expectText(p, '/org/counselors', '상담사 관리', 'E2E-상담사', 'E2E0C1');
});

// ════════════════════════════════════════════════════════════════════════
// 2. 상담사 계층
// ════════════════════════════════════════════════════════════════════════
await scenario('[상담사] 로그인 → 대시보드(내 클래스·일정)', async (p) => {
  await uiLogin(p, 'counselor', HOME.counselor);
  await expectText(p, '/dashboard', '오늘 · 다가오는 일정', '내 클래스');
});

await scenario('[상담사] 내담자 목록에 연결된 내담자 노출', async (p) => {
  await uiLogin(p, 'counselor', HOME.counselor);
  await expectText(p, '/clients', 'E2E-내담자', 'e2e-client@e2e.looxidlabs.com');
});

// ════════════════════════════════════════════════════════════════════════
// 3. 회원가입 (내담자)
// ════════════════════════════════════════════════════════════════════════
await scenario('[회원가입] 가입 페이지 렌더링', async (p) => {
  await expectText(p, '/register/client', '회원 가입', '이메일 인증');
});

const NEW_EMAIL = `e2e-signup-${Date.now()}@${DOMAIN}`;

await scenario('[회원가입] OTP 요청 발송(204)', async () => {
  const r = await fetch(`${API}/auth/email/request-otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: NEW_EMAIL }),
  });
  if (r.status !== 204) throw new Error(`OTP 요청 ${r.status}`);
});

await scenario('[회원가입] 잘못된 OTP 거부(400)', async () => {
  const r = await fetch(`${API}/auth/email/verify-otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: NEW_EMAIL, code: '000000' }),
  });
  if (r.status !== 400) throw new Error(`잘못된 OTP가 ${r.status} 로 통과됨`);
});

await scenario('[회원가입] 이메일 검증 토큰 없이 가입 시도 → 401', async () => {
  const r = await fetch(`${API}/auth/register/client`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: NEW_EMAIL, email_verify_token: '', password: 'Test-pass-1!', name: 'E2E-신규내담자', consents: { tos: true, privacy: true, sensitive: true } }),
  });
  if (r.status !== 401) throw new Error(`토큰 없는 가입이 ${r.status}`);
});

await scenario('[회원가입] 약관 동의 필드 누락 → 422', async () => {
  const r = await fetch(`${API}/auth/register/client`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: NEW_EMAIL, email_verify_token: 'x', password: 'Test-pass-1!', name: 'E2E-신규내담자' }),
  });
  if (r.status !== 422) throw new Error(`consents 누락이 ${r.status}`);
});

// [로컬 전용] 실제 OTP → 검증 → 가입 → 로그인까지 전체 흐름.
//   SSH 로 dev Redis 의 OTP 를 읽어야 하므로 접근 불가 시 SKIP.
await scenario('[회원가입] (로컬) OTP 검증 → 가입 → 로그인', async (p) => {
  const otp = readOtpFromRedis(NEW_EMAIL);
  if (!otp) { console.log('      SKIP — dev Redis 접근 불가(SSH 필요)'); return; }
  const v = await fetch(`${API}/auth/email/verify-otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: NEW_EMAIL, code: otp }),
  });
  if (v.status !== 200) throw new Error(`OTP 검증 ${v.status}`);
  const { email_verify_token } = await v.json();
  const reg = await fetch(`${API}/auth/register/client`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: NEW_EMAIL, email_verify_token, password: 'Test-pass-1!', name: 'E2E-신규내담자', consents: { tos: true, privacy: true, sensitive: true } }),
  });
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`가입 ${reg.status}`);
  // 새 계정으로 UI 로그인
  await p.goto(`${BASE}/login?role=client`, { waitUntil: 'domcontentloaded' });
  await p.click('#login-tab-client');
  await p.fill('#login-email', NEW_EMAIL);
  await p.fill('#login-password', 'Test-pass-1!');
  await p.locator('form button[type=submit]').click();
  await p.waitForURL((u) => u.pathname.startsWith('/onboarding') || u.pathname.startsWith('/app'), { timeout: 20000 });
});

// ════════════════════════════════════════════════════════════════════════
// 4. 로그인 (역할별 + 오류)
// ════════════════════════════════════════════════════════════════════════
await scenario('[로그인] 4역할 API 로그인 → 역할 정합성', async () => {
  const expectRole = { client: 'client', counselor: 'counselor', org_admin: 'org_admin', platform_admin: 'platform_admin' };
  for (const [role, expected] of Object.entries(expectRole)) {
    const r = await apiLoginFull(role);
    if (r.user?.role !== expected) throw new Error(`${role}: role=${r.user?.role}`);
  }
});

await scenario('[로그인] 내담자 → 상담사 대시보드 접근 차단', async (p) => {
  await uiLogin(p, 'client', HOME.client);
  await go(p, '/dashboard');
  if (new URL(p.url()).pathname === '/dashboard' && (await bodyText(p)).includes('오늘 · 다가오는 일정')) {
    throw new Error('내담자가 상담사 화면에 접근');
  }
});

await scenario('[로그인] 없는 계정 로그인 → 오류 안내(잠금 방지)', async (p) => {
  await p.goto(`${BASE}/login?role=client`, { waitUntil: 'domcontentloaded' });
  await p.fill('#login-email', 'e2e-nobody@e2e.looxidlabs.com');
  await p.fill('#login-password', 'Wrong-pass-1!');
  await p.locator('form button[type=submit]').click();
  await p.getByRole('alert').first().waitFor({ timeout: 10000 });
});

// ════════════════════════════════════════════════════════════════════════
// 5. 클래스 참여 (상담사 생성→오픈→시작 → 입장 → 종료)
//   A) 비회원(게스트): 4자리 코드 → 개인정보 → 준비(리포트 반영 "반영해요" 선택) → 입장  → client 리포트 생성
//   B) 초대 회원 편의 경로: /class/{id}/enter → 준비(기본값 = 리포트 제외) → 입장       → client 리포트 생성 안 됨(B2/B3 정책)
// ════════════════════════════════════════════════════════════════════════
const TITLE_B = `${TITLE}-제외`;
const GUEST_EMAIL = `e2e-guest-${Date.now()}@${DOMAIN}`;
const classes = { A: { id: null, code: null, title: TITLE }, B: { id: null, title: TITLE_B } };

async function createStartedClass(title, participantIds) {
  const c = await counselor();
  const fixture = await createClassFixture({ api: API, token: c.token, hostId: c.user.id,
    title, memberIds: participantIds, instant: true });
  const s = { id: fixture.session_ids[0] };
  const t = await fetch(`${API}/sessions/${s.id}/start`, { method: 'POST', headers: H(c.token) });
  if (t.status !== 200) {
    const detail = JSON.stringify((await t.json().catch(() => ({}))).detail);
    await cleanupClass(c.token, fixture.class_id, s.id);
    throw new Error(`클래스 start ${t.status}: ${detail}`);
  }
  const chk = await (await fetch(`${API}/sessions/${s.id}`, { headers: H(c.token) })).json();
  if (chk.status !== 'in_progress') { await cleanupClass(c.token, fixture.class_id, s.id); throw new Error('클래스가 in_progress 가 아님'); }
  return { id: s.id, classId: fixture.class_id, code: chk.access_code ?? null };
}

/** 입장 마법사의 보이는 CTA 를 순서대로 눌러 진행 화면까지 간다. 본 단계(h1) 순서를 기록해 돌려준다. */
// SDD-220 F1: 회차 입장 전 녹음·녹화 필수 동의 체크(미체크 시 입장 버튼 비활성)
async function checkRecordingConsent(p) {
  const box = p.getByRole('checkbox', { name: '녹음·녹화에 동의해요 (필수)' });
  if (await box.count() && (await box.first().getAttribute('aria-checked')) !== 'true') await box.first().click();
}

async function walkToLive(p, { includeReport }) {
  // 시작 후 시트(`지금 입장하기`)가 뜨면 뒤의 단계 버튼이 가려지므로 가장 먼저 누른다
  const steps = ['지금 입장하기', '동의하고 입장하기', '입장하기', '확인하고 계속하기', '건너뛰기', 'LINK BAND 없이 계속하기', '다음'];
  const seen = [];
  let chose = false;
  for (let round = 0; round < 14; round += 1) {
    if (await p.locator('[data-pz="app"] [data-pz="dock"]').count()) break;
    const h1 = (await p.locator('h1').first().innerText().catch(() => '')).trim();
    if (h1 && seen[seen.length - 1] !== h1) seen.push(h1);
    // FM06a: 리포트 반영 선택(기본 "반영하지 않아요"). 포함 케이스만 "반영해요" 를 명시 선택한다.
    if (includeReport && !chose) {
      const radio = p.getByRole('radio', { name: '반영해요', exact: true });
      if (await radio.count()) {
        await radio.first().click();
        await p.getByRole('radio', { name: '반영해요', exact: true }).and(p.locator('[aria-checked="true"]')).waitFor({ timeout: 5000 });
        chose = true;
      }
    }
    await checkRecordingConsent(p);
    let clicked = false;
    for (const name of steps) {
      const button = p.getByRole('button', { name, exact: true });
      if (await button.count() && await button.first().isEnabled()) {
        await button.first().click({ timeout: 4000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    await p.waitForTimeout(clicked ? 500 : 1000);
  }
  await p.locator('[data-pz="app"] [data-pz="dock"]').waitFor({ timeout: 15000 });
  const live = await bodyText(p);
  // SDD-208: 시간 + 지표 링 + 도크. 밴드 없이 입장하므로 '내 상태' 탭은 없다
  if (!(await p.locator('[data-pz="ring"]').count()) || !live.includes('조용한 신호') || !live.includes('채팅')) {
    throw new Error('진행 화면 진입 실패');
  }
  if (includeReport && !chose) throw new Error('FM06a 리포트 반영 선택 화면을 만나지 못함');
  return seen;
}

await purgeStaleClasses();

await scenario('[클래스] (A) 상담사 클래스 생성 → 오픈 → 시작 (4자리 코드 발급)', async () => {
  const made = await createStartedClass(TITLE, []);
  classes.A.id = made.id;
  classes.A.classId = made.classId; classes.A.code = made.code;
  if (!/^\d{4}$/.test(String(made.code ?? ''))) throw new Error('입장 코드가 4자리 숫자가 아님');
});

await scenario('[클래스] (A) 비회원 입장: 4자리 코드 → 개인정보 → 준비(리포트 반영 선택) → 진행 화면', async (p) => {
  if (!classes.A.id) throw new Error('선행 클래스 생성 실패');
  await p.goto(`${BASE}/join`, { waitUntil: 'networkidle' });
  // ① 코드 확인(FM04)
  await p.getByRole('group', { name: '입장 코드 4자리' }).waitFor({ timeout: 10000 });
  for (let i = 0; i < 4; i += 1) await p.getByLabel(`${i + 1}번째 숫자`).fill(classes.A.code[i]);
  // 4자리를 채우면 자동 확인된다(0f40ca28) — 버튼은 verifying 동안 disabled 이므로 누르지 않고 다음 단계를 기다린다.
  // ② 개인정보(FM04b)
  await p.getByText('정보를 입력해 주세요').first().waitFor({ timeout: 15000 });
  await p.fill('#fm-name', 'E2E-게스트');
  await p.getByRole('radio', { name: '여성' }).click();
  // 비회원 생년월은 연도·월 다이얼(listbox)이다
  await p.getByRole('listbox', { name: '출생 연도' }).getByRole('option', { name: '1990년', exact: true }).dispatchEvent('click');
  await p.getByRole('listbox', { name: '출생 월' }).getByRole('option', { name: '3월', exact: true }).dispatchEvent('click');
  await p.getByRole('listbox', { name: '출생 월' }).getByRole('option', { name: '3월', exact: true }).and(p.locator('[aria-selected="true"]')).waitFor({ timeout: 5000 });
  await p.fill('#fm-email', GUEST_EMAIL);
  await p.fill('#fm-email2', GUEST_EMAIL);
  await checkRecordingConsent(p);
  await p.getByRole('button', { name: '입장하기', exact: true }).click();
  // ③ /class/{id}/enter 로 이동 → 준비 → 입장
  await p.waitForURL((u) => u.pathname === `/class/${classes.A.id}/enter`, { timeout: 15000 });
  const seen = await walkToLive(p, { includeReport: true });
  console.log(`      /class/{id}/enter 단계 순서: ${seen.join(' → ')} → 진행 화면`);
  const iNotice = seen.findIndex((x) => x.includes('시작 전에 확인'));
  if (iNotice < 0) throw new Error(`고지·리포트 반영 단계 없음 (${seen.join(' → ')})`);
});

async function endClass(key) {
  await scenario(`[클래스] (${key}) 상담사 종료(end) → 상태 completed`, async () => {
    if (!classes[key].id) throw new Error('선행 클래스 생성 실패');
    const c = await counselor();
    const r = await fetch(`${API}/sessions/${classes[key].id}/end`, { method: 'POST', headers: H(c.token) });
    if (r.status !== 200) throw new Error(`클래스 종료 ${r.status}`);
    const s = await r.json();
    if (s.status !== 'completed') throw new Error(`종료 후 상태 ${s.status}`);
  });
}

await endClass('A');

await scenario('[클래스] (B) 초대 회원 클래스 생성 → 오픈 → 시작', async () => {
  const cl = await client();
  const made = await createStartedClass(TITLE_B, [cl.user.id]);
  classes.B.id = made.id;
  classes.B.classId = made.classId;
});

await scenario('[클래스] (B) 초대 회원 입장(편의 경로) → 준비(기본 리포트 제외) → 진행 화면', async (p) => {
  if (!classes.B.id) throw new Error('선행 클래스 생성 실패');
  await uiLogin(p, 'client', HOME.client);
  // SDD-209: 코드 없이 초대 행으로 입장 자격을 받는 편의 경로(/class/{id}/enter).
  await p.goto(`${BASE}/class/${classes.B.id}/enter`, { waitUntil: 'networkidle' });
  const seen = await walkToLive(p, { includeReport: false });
  console.log(`      /class/{id}/enter 단계 순서: ${seen.join(' → ')} → 진행 화면`);
});

await endClass('B');

// ════════════════════════════════════════════════════════════════════════
// 6. 리포트 발송 (자동 생성 → 열람 → 승인 → 발송)
//   정책(SDD-209 B2/B3): 참가자는 기본 "리포트 제외". 반영을 선택한 참가자만 client 리포트가 생긴다.
// ════════════════════════════════════════════════════════════════════════
/** 목록 API 는 session_id 필터가 없으므로 전체 조회 후 client-side 필터. */
async function sessionReports(cToken, id) {
  const r = await fetch(`${API}/reports?limit=100`, { headers: H(cToken) });
  if (!r.ok) return [];
  const all = (await r.json()).reports ?? [];
  return all.filter((x) => x.session_id === id);
}

await scenario('[리포트] (A) 반영 선택 → 종료 후 자동 생성 폴링(counselor + client)', async () => {
  if (!classes.A.id) throw new Error('선행 클래스 생성 실패');
  const c = await counselor();
  let reports = [];
  for (let i = 0; i < 30; i++) {
    reports = await sessionReports(c.token, classes.A.id);
    const types = new Set(reports.map((x) => x.type));
    if (types.has('counselor') && types.has('client')) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  const types = new Set(reports.map((x) => x.type));
  if (!types.has('counselor') || !types.has('client')) {
    throw new Error(`리포트 미생성: types=${[...types].join(',')}`);
  }
  console.log('      counselor + client 리포트 생성 확인');
});

await scenario('[리포트] (B) 기본(리포트 제외) → counselor 만 생성, client 리포트 없음', async () => {
  if (!classes.B.id) throw new Error('선행 클래스 생성 실패');
  const c = await counselor();
  let reports = [];
  for (let i = 0; i < 30; i++) {
    reports = await sessionReports(c.token, classes.B.id);
    if (reports.some((x) => x.type === 'counselor')) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  if (!reports.some((x) => x.type === 'counselor')) throw new Error('상담사 리포트 미생성');
  // client 리포트 행은 같은 후처리에서 만들어진다 — 상담사 리포트 확인 후 여유를 두고 다시 확인한다.
  await new Promise((res) => setTimeout(res, 6000));
  reports = await sessionReports(c.token, classes.B.id);
  const clientReports = reports.filter((x) => x.type === 'client');
  if (clientReports.length) throw new Error(`리포트 제외 참가자의 client 리포트가 생성됨: ${clientReports.length}건`);
  console.log('      리포트 제외 → client 리포트 0건 확인');
});

await scenario('[리포트] 상담사 리포트 열람(UI)', async (p) => {
  await uiLogin(p, 'counselor', HOME.counselor);
  await expectText(p, '/reports', TITLE);
});

await scenario('[리포트] (A) client 리포트 승인 → completed', async () => {
  if (!classes.A.id) throw new Error('선행 클래스 생성 실패');
  const c = await counselor();
  const reports = await sessionReports(c.token, classes.A.id);
  const clientReport = reports.find((x) => x.type === 'client');
  if (!clientReport) throw new Error('client 리포트 없음');
  const ap = await fetch(`${API}/reports/${clientReport.id}/approve`, {
    method: 'POST', headers: H(c.token), body: JSON.stringify({}),
  });
  if (ap.status !== 200) throw new Error(`승인 ${ap.status}`);
  const approved = await ap.json();
  if (approved.status !== 'completed') throw new Error(`승인 후 상태 ${approved.status}`);
});

await scenario('[리포트] (A) 리포트 이메일 재발송(승인 후) → queued/sent', async () => {
  if (!classes.A.id) throw new Error('선행 클래스 생성 실패');
  const c = await counselor();
  const reports = await sessionReports(c.token, classes.A.id);
  const clientReport = reports.find((x) => x.type === 'client');
  if (!clientReport) throw new Error('client 리포트 없음');
  const r = await fetch(`${API}/reports/${clientReport.id}/resend-email`, {
    method: 'POST', headers: H(c.token),
    body: JSON.stringify({ email: GUEST_EMAIL }),
  });
  if (r.status !== 200 && r.status !== 202) throw new Error(`리포트 메일 발송 ${r.status}`);
});

// ════════════════════════════════════════════════════════════════════════
// 정리 — 완료된 테스트 클래스 보관. 원본·리포트는 보존한다.
// ════════════════════════════════════════════════════════════════════════
await scenario('[정리] 완료된 테스트 클래스 보관', async () => {
  const c = await counselor();
  const failed = [];
  for (const key of ['A', 'B']) {
    if (!classes[key].id) continue;
    // 앞 단계가 실패해 종료되지 않은 회차도 end → cancel/archive 로 모두 치운다
    const log = await cleanupClass(c.token, classes[key].classId, classes[key].id);
    const g = await fetch(`${API}/classes/${classes[key].classId}`, { headers: H(c.token) });
    const st = g.ok ? (await g.json()).status : `조회 ${g.status}`;
    if (st !== 'archived') failed.push(`${key}: ${st} (${log})`);
  }
  if (failed.length) throw new Error(`클래스 보관 실패 ${failed.join(' | ')}`);
});

await finish('full-journey-result.json', '전수조사');
