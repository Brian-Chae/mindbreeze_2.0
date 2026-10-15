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
const H = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

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
  await expectText(p, '/register/client', '회원가입', '이메일');
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

await scenario('[회원가입] 약관 미동의 가입 시도 → 422', async () => {
  const r = await fetch(`${API}/auth/register/client`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: NEW_EMAIL, email_verify_token: 'x', password: 'Test-pass-1!', name: 'E2E-신규내담자', consents: { tos: false, privacy: true, sensitive: true } }),
  });
  if (r.status !== 422) throw new Error(`약관 미동의가 ${r.status}`);
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
    const me = await fetch(`${API}/auth/users/me`, { headers: H(r.token) });
    if (!me.ok) throw new Error(`${role} /me ${me.status}`);
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
// 5. 클래스 참여 (상담사 생성→오픈→시작 → 내담자 코드 참여 → 종료)
// ════════════════════════════════════════════════════════════════════════
let sessionId = null;
let accessCode = null;

await scenario('[클래스] 상담사 세션 생성 → 오픈 → 시작', async () => {
  const c = await counselor();
  const cl = await client();
  const r = await fetch(`${API}/sessions`, {
    method: 'POST', headers: H(c.token),
    body: JSON.stringify({ type: 'meditation', duration_min: 30, title: TITLE, location_type: 'online', participant_mode: 'one_on_one', max_participants: 2, participant_ids: [cl.user.id] }),
  });
  if (r.status !== 201 && r.status !== 200) throw new Error(`세션 생성 ${r.status}`);
  const s = await r.json();
  sessionId = s.id;
  accessCode = s.access_code;
  for (const action of ['open', 'start']) {
    const t = await fetch(`${API}/sessions/${sessionId}/${action}`, { method: 'POST', headers: H(c.token) });
    if (t.status !== 200) throw new Error(`세션 ${action} ${t.status}`);
  }
  // 종료 가능 상태(in_progress) 확인
  const chk = await fetch(`${API}/sessions/${sessionId}`, { headers: H(c.token) });
  if ((await chk.json()).status !== 'in_progress') throw new Error('세션이 in_progress 가 아님');
});

await scenario('[클래스] 내담자 코드 참여 → 대기실 → 명상 화면', async (p) => {
  if (!accessCode) throw new Error('선행 세션 생성 실패');
  await uiLogin(p, 'client', HOME.client);
  await p.goto(`${BASE}/join?code=${accessCode}`, { waitUntil: 'networkidle' });
  // 3단계 준비 건너뛰기(설문→링크밴드→기기)
  await p.getByRole('button', { name: '건너뛰기' }).click().catch(() => {});
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /밴드 없이 진행하기/ }).click().catch(() => {});
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /기기 테스트 건너뛰기/ }).click().catch(() => {});
  // in_progress 이므로 명상 화면(시간 표시) 진입 확인
  await p.getByText(/^\d+:\d{2}\s*\/\s*\d+:\d{2}$/).first().waitFor({ timeout: 15000 }).catch(() => {});
  if (!(await bodyText(p)).includes('지금 나를 알려요')) throw new Error('명상 화면 진입 실패');
});

await scenario('[클래스] 상담사 종료(end) → 상태 completed', async () => {
  if (!sessionId) throw new Error('선행 세션 생성 실패');
  const c = await counselor();
  const r = await fetch(`${API}/sessions/${sessionId}/end`, { method: 'POST', headers: H(c.token) });
  if (r.status !== 200) throw new Error(`세션 종료 ${r.status}`);
  const s = await r.json();
  if (s.status !== 'completed') throw new Error(`종료 후 상태 ${s.status}`);
});

// ════════════════════════════════════════════════════════════════════════
// 6. 리포트 발송 (자동 생성 → 열람 → 승인 → 발송)
// ════════════════════════════════════════════════════════════════════════
/** 목록 API 는 session_id 필터가 없으므로 전체 조회 후 client-side 필터. */
async function sessionReports(cToken) {
  const r = await fetch(`${API}/reports?limit=100`, { headers: H(cToken) });
  if (!r.ok) return [];
  const all = (await r.json()).reports ?? [];
  return all.filter((x) => x.session_id === sessionId);
}

await scenario('[리포트] 종료 후 자동 생성 폴링(counselor + client)', async () => {
  if (!sessionId) throw new Error('선행 세션 생성 실패');
  const c = await counselor();
  let reports = [];
  for (let i = 0; i < 30; i++) {
    reports = await sessionReports(c.token);
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

await scenario('[리포트] 상담사 리포트 열람(UI)', async (p) => {
  await uiLogin(p, 'counselor', HOME.counselor);
  await expectText(p, '/reports', TITLE);
});

await scenario('[리포트] client 리포트 승인 → completed', async () => {
  if (!sessionId) throw new Error('선행 세션 생성 실패');
  const c = await counselor();
  const reports = await sessionReports(c.token);
  const clientReport = reports.find((x) => x.type === 'client');
  if (!clientReport) throw new Error('client 리포트 없음');
  const ap = await fetch(`${API}/reports/${clientReport.id}/approve`, {
    method: 'POST', headers: H(c.token), body: JSON.stringify({}),
  });
  if (ap.status !== 200) throw new Error(`승인 ${ap.status}`);
  const approved = await ap.json();
  if (approved.status !== 'completed') throw new Error(`승인 후 상태 ${approved.status}`);
});

await scenario('[리포트] 리포트 이메일 재발송(승인 후) → queued/sent', async () => {
  if (!sessionId) throw new Error('선행 세션 생성 실패');
  const c = await counselor();
  const cl = await client();
  const reports = await sessionReports(c.token);
  const clientReport = reports.find((x) => x.type === 'client');
  if (!clientReport) throw new Error('client 리포트 없음');
  const r = await fetch(`${API}/reports/${clientReport.id}/resend-email`, {
    method: 'POST', headers: H(c.token),
    body: JSON.stringify({ email: cl.user.email }),
  });
  if (r.status !== 200 && r.status !== 202) throw new Error(`리포트 메일 발송 ${r.status}`);
});

// ════════════════════════════════════════════════════════════════════════
// 정리 — 테스트 세션 삭제(리포트·기록은 cascade). 실패해도 무시.
// ════════════════════════════════════════════════════════════════════════
await scenario('[정리] 테스트 세션 삭제(잔여 0)', async () => {
  if (!sessionId) return;
  const c = await counselor();
  const d = await fetch(`${API}/sessions/${sessionId}`, { method: 'DELETE', headers: H(c.token) });
  if (d.status !== 204) console.log(`      세션 삭제 ${d.status} — e2e_seed cleanup 에 맡김`);
});

await finish('full-journey-result.json', '전수조사');
