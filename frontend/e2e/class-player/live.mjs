// SDD-208 — 실제 앱 경로에서 새 진행 화면이 뜨는지 확인하는 E2E (plan §7).
//   회원: /class/:id/enter(초대 회원 편의 입장, SDD-209) → 준비 마법사 → 새 회원 진행 화면(링·도크) / 상담사: /sessions/:id/player → 새 상담사 진행 화면(1:1 카드·도크)
//   가짜 미디어 장치 플래그로 카메라·마이크를 흉내 내고, 하니스 측정 함수(P1~P3·P5·PC)를 실제 화면에 그대로 적용한다.
// 실행: E2E_PASSWORD=... [BASE_URL=... API_URL=...] node e2e/class-player/live.mjs      (기본 대상: dev 배포본)
//       node e2e/class-player/live.mjs --stub [--base=http://127.0.0.1:5175]           (로컬 vite 개발 서버 + API 스텁: 실제 앱 라우트·페이지·컨테이너를 백엔드 없이 확인)
//       (--group 으로 온라인 그룹, --shots=/tmp/live-shots 를 더하면 실제 앱 화면 스크린샷을 저장)
//       node e2e/class-player/live.mjs --dry [--base=http://127.0.0.1:5175]            (백엔드·계정 없이 라우트·브라우저 기동만 점검)
// 계정은 e2e/lib.mjs 와 같은 시드 계정(e2e-client / e2e-counselor @e2e.looxidlabs.com) — 비밀번호는 환경변수 E2E_PASSWORD 로만 받는다.
import { fitConfig, launchBrowser, measureFit, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv);
const DRY = args.dry === true;
const STUB = args.stub === true;
/** --group: 스텁/실제 모두 온라인 그룹 클래스로 진행한다(기본은 온라인 1:1) */
const GROUP = args.group === true;
const BASE = (args.base || process.env.BASE_URL || (DRY || STUB ? 'http://127.0.0.1:5175' : 'https://dev.mindbreeze.looxidlabs.com')).replace(/\/$/, '');
const API = process.env.API_URL || 'https://dev-api.mindbreeze.looxidlabs.com/api/v1';
const PW = process.env.E2E_PASSWORD;
const DOMAIN = 'e2e.looxidlabs.com';
const EMAIL = { client: `e2e-client@${DOMAIN}`, counselor: `e2e-counselor@${DOMAIN}` };
const TITLE = `E2E-플레이어-${Date.now()}`;
const VIEWPORTS = [[390, 844], [1280, 720]];

if (!DRY && !STUB && !PW) {
  console.error('E2E_PASSWORD 필요 (백엔드 없이 점검하려면 --stub 또는 --dry)');
  process.exit(2);
}

const results = [];
const SHOTS = typeof args.shots === 'string' ? args.shots : null;
/** --shots=디렉터리 를 주면 실제 앱 화면 스크린샷을 남긴다(시안 대조용) */
async function shot(page, name) {
  if (!SHOTS) return;
  const fs = await import('node:fs');
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const H = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function apiLogin(role) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL[role], password: PW }) });
  if (!r.ok) throw new Error(`api login ${role} ${r.status}`);
  const j = await r.json();
  return { token: j.access_token, user: j.user };
}

async function uiLogin(page, role, expectPath) {
  await page.goto(`${BASE}/login?role=${role}`, { waitUntil: 'domcontentloaded' });
  await page.click(`#login-tab-${role}`);
  await page.fill('#login-email', EMAIL[role]);
  await page.fill('#login-password', PW);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((u) => u.pathname.startsWith(expectPath), { timeout: 20000 });
}

const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

/** getUserMedia 호출을 센다 — 회원 카메라 기본 비공개(P8) 확인용 */
const COUNT_MEDIA = () => {
  window.__gum = { video: 0, audio: 0 };
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return;
  const original = md.getUserMedia.bind(md);
  md.getUserMedia = (constraints) => {
    if (constraints?.video) window.__gum.video += 1;
    if (constraints?.audio) window.__gum.audio += 1;
    return original(constraints);
  };
};


/* ───────── --stub: 백엔드 대신 브라우저에서 API 를 가로채 실제 앱 라우트를 구동한다 ───────── */
const stubState = { status: 'in_progress', startedAt: new Date(Date.now() - 90_000).toISOString() };
const STUB_USERS = {
  client: { id: 'u-client', name: '김수연', email: EMAIL.client, role: 'client', verified_tier: 'fully_verified', onboarding_completed: true, auth_provider: 'email', counselors: [{ id: 'u-host', name: '채용욱', profile_image: null }] },
  counselor: { id: 'u-host', name: '채용욱', email: EMAIL.counselor, role: 'counselor', verified_tier: 'fully_verified', onboarding_completed: true, auth_provider: 'email', counselors: [] },
};
const stubSession = () => ({
  id: 's1', title: TITLE, type: 'meditation', custom_type_name: null, status: stubState.status, host_id: 'u-host', host_name: '채용욱',
  location_type: 'online', participant_mode: GROUP ? 'group' : 'one_on_one', linkband_mode: 'optional', participant_count: 1, max_participants: GROUP ? 12 : 2, duration_min: 30,
  access_code: 'ABC123', started_at: stubState.startedAt, opened_at: stubState.startedAt, scheduled_at: null,
  chat_enabled: false, chat_room_id: null, record_audio: true, record_video: true,
  participants: [{ participant_id: 'p-client', user_id: 'u-client', user_name: '김수연', guest_name: null, is_guest: false, band_connected: false, linkband_device_id: null, webrtc_peer_id: null, consent_audio: true, consent_eeg: true, is_waitlisted: false, waitlist_position: null }],
});
const stubMetric = () => ({
  participant_id: 'p-client', user_id: 'u-client', display_name: '김수연', is_guest: false, band_connected: true, device_status: 'ok', band_battery: 80,
  avg_efficiency: 0.5, current_efficiency: 0.6, upload_status: 'completed', last_eeg_at: new Date().toISOString(), heart_rate: 70, respiratory_rate: 14, sdnn: 50,
  raise_hand: false, speaking: false,
});

/** 컨텍스트에 로그인 상태(mb_user + /auth/refresh)와 API 스텁을 심는다 */
async function installStub(ctx, role) {
  await ctx.addInitScript((user) => localStorage.setItem('mb_user', JSON.stringify(user)), STUB_USERS[role]);
  await ctx.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const path = pathname.replace(/^.*\/api\/v1/, '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/auth/refresh') return json({ access_token: 'stub-token', token_type: 'bearer' });
    if (path === '/sessions/s1/enter') return json({ entry_credential: 'stub-cred', expires_at: null, participant_id: 'p-client', is_guest: false, is_waitlisted: false, session: stubSession() });
    if (path === '/sessions/s1/entry-state') {
      const done = stubState.status === 'completed';
      return json({
        session_id: 's1', status: stubState.status, guest_state: done ? 'complete' : 'meditation', in_progress: !done, ended: done, participant_id: 'p-client',
        is_waitlisted: false, report_included: true, started_at: stubState.startedAt, ended_at: done ? new Date().toISOString() : null, chat_enabled: false, band_connected: false,
      });
    }
    if (path === '/sessions/s1/entry/livekit-token') return json({ detail: '코치 화상이 아직 시작되지 않았습니다' }, 400);
    if (path === '/sessions/s1') return json(stubSession());
    if (path === '/sessions/s1/live-metrics') return json({ metrics: [stubMetric()] });
    return json({}, 404);
  });
}

async function newContext(browser, [width, height], role) {
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(() => localStorage.setItem('mb_class_onboarding_seen', '1'));
  await ctx.addInitScript(COUNT_MEDIA);
  if (STUB && role) await installStub(ctx, role);
  return ctx;
}

/** 로그인: 실제 모드는 로그인 화면으로, 스텁 모드는 컨텍스트에 심어 둔 상태를 쓴다 */
async function signIn(page, role, expectPath) {
  if (!STUB) await uiLogin(page, role, expectPath);
}

async function scenario(name, fn) {
  const started = Date.now();
  let error = null;
  try { await fn(); } catch (e) { error = String(e.message).split('\n')[0]; }
  results.push({ name, ok: !error, error, ms: Date.now() - started });
  console.log(`${error ? 'FAIL' : 'PASS'}  ${name}${error ? ` — ${error}` : ''}`);
}

/** 하니스와 같은 측정 함수를 실제 화면에 적용한다(P1~P3·P5·PC·P12·P13) */
async function assertFit(page, role, label) {
  const checks = await page.evaluate(measureFit, fitConfig(role, 'LIVE'));
  const fails = checks.filter((c) => !c.pass);
  if (fails.length) throw new Error(`${label} 측정 위반: ${fails.slice(0, 4).map((c) => `${c.rule} ${c.val}`).join(' | ')}`);
}

const browser = await launchBrowser(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);

/* ───────── 백엔드 없이 확인 가능한 범위 ───────── */
if (DRY) {
  await scenario('[dry] 브라우저 기동 + 가짜 미디어 장치로 getUserMedia 가 열린다', async () => {
    const ctx = await newContext(browser, VIEWPORTS[0]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/join`, { waitUntil: 'domcontentloaded' });
    const ok = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const n = stream.getTracks().length;
      stream.getTracks().forEach((t) => t.stop());
      return n === 2 && window.__gum.video === 1 && window.__gum.audio === 1;
    });
    await ctx.close();
    if (!ok) throw new Error('가짜 미디어 장치 또는 호출 카운터 동작 안 함');
  });
  await scenario('[dry] /join 코드 입력 화면이 뜬다(회원 진입 경로)', async () => {
    const ctx = await newContext(browser, VIEWPORTS[0]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/join`, { waitUntil: 'networkidle' });
    const text = await bodyText(page);
    await ctx.close();
    if (!/입장 코드/.test(text)) throw new Error('/join 화면에 입장 코드 입력이 없음');
  });
  await scenario('[dry] 하니스(/design/class-player)에서 측정 함수가 실제 DOM 에 적용된다', async () => {
    const ctx = await newContext(browser, VIEWPORTS[0]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/design/class-player?role=member&case=M01`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    await assertFit(page, 'member', 'M01');
    await ctx.close();
  });
  await browser.close();
  const failedDry = results.filter((r) => !r.ok);
  console.log(`\n라이브 E2E(dry) 결과: ${results.length - failedDry.length}/${results.length} 통과`);
  process.exit(failedDry.length ? 1 : 0);
}

/* ───────── 실제 앱 경로: dev 백엔드(기본) 또는 --stub(API 가로채기) ───────── */
let sessionId = STUB ? 's1' : null;
let counselorToken = null;

if (!STUB) {
  await scenario('[준비] 코치 API 로 온라인 1:1 클래스 생성 → 오픈 → 시작', async () => {
    const c = await apiLogin('counselor');
    const cl = await apiLogin('client');
    counselorToken = c.token;
    const r = await fetch(`${API}/sessions`, {
      method: 'POST', headers: H(c.token),
      body: JSON.stringify({ type: 'meditation', duration_min: 30, title: TITLE, location_type: 'online', participant_mode: GROUP ? 'group' : 'one_on_one', max_participants: GROUP ? 12 : 2, participant_ids: [cl.user.id] }),
    });
    if (r.status !== 201 && r.status !== 200) throw new Error(`세션 생성 ${r.status}`);
    const s = await r.json();
    sessionId = s.id;
    for (const action of ['open', 'start']) {
      const t = await fetch(`${API}/sessions/${sessionId}/${action}`, { method: 'POST', headers: H(c.token) });
      if (t.status !== 200) throw new Error(`세션 ${action} ${t.status}`);
    }
  });
}

/** 초대 회원이 /class/:id/enter 로 들어가 준비 마법사를 건너뛰고 진행 화면(도크)이 뜰 때까지 (SDD-209: 코드·/join?code= 없음) */
async function joinAsMember(page) {
  await signIn(page, 'client', '/app');
  await page.goto(`${BASE}/class/${sessionId}/enter`, { waitUntil: 'networkidle' });
  // 시작 후 시트(`지금 입장하기`)가 뜨면 뒤의 단계 버튼이 가려지므로 가장 먼저 누른다
  const steps = ['지금 입장하기', '입장하기', '확인하고 계속하기', '건너뛰기', 'LINK BAND 없이 계속하기', '다음'];
  for (let round = 0; round < 12; round += 1) {
    if (await page.locator('[data-pz="app"] [data-pz="dock"]').count()) break;
    let clicked = false;
    for (const name of steps) {
      const button = page.getByRole('button', { name, exact: true });
      if ((await button.count()) && (await button.first().isEnabled())) {
        await button.first().click({ timeout: 4000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    await page.waitForTimeout(clicked ? 500 : 800);
  }
  await page.locator('[data-pz="app"] [data-pz="dock"]').waitFor({ timeout: 20000 }).catch(async () => {
    throw new Error(`진행 화면 도크가 뜨지 않음 — 현재 화면: ${(await bodyText(page)).slice(0, 160)}`);
  });
}

await scenario('[회원] /class/:id/enter → 새 진행 화면(링·도크) · 카메라 기본 비공개 · 측정 위반 0', async () => {
  if (!sessionId) throw new Error('선행 세션 생성 실패');
  for (const vp of VIEWPORTS) {
    const ctx = await newContext(browser, vp, 'client');
    const page = await ctx.newPage();
    try {
      await joinAsMember(page);
      // 밴드를 연결하지 않은 진입이라 추이(trend) 대신 "밴드 없이 참여 중" 안내 카드가 링 아래에 있다
      for (const name of ['ring', 'info-card']) {
        if (!(await page.locator(`[data-pz="${name}"]`).count())) throw new Error(`${vp.join('x')}: data-pz="${name}" 없음`);
      }
      const text = await bodyText(page);
      if (/그룹 평균|순위|상위|하위|종합 점수/.test(text)) throw new Error('회원 화면에 비교·점수 문구가 있음');
      // P8: 진입 직후 카메라를 열지 않는다(마이크는 발행 권한이 있으면 열릴 수 있다)
      const video = await page.evaluate(() => window.__gum?.video ?? 0);
      if (video !== 0) throw new Error(`진입 직후 카메라 getUserMedia ${video}회 (기본 비공개 위반)`);
      await assertFit(page, 'member', `회원 ${vp.join('x')}`);
      await shot(page, `member-live${GROUP ? '-group' : ''}-${vp.join('x')}`);
    } finally {
      await ctx.close();
    }
  }
});

if (!STUB) {
  // 카메라 켜기는 실제 LiveKit 방(발행 권한)이 있어야 하므로 스텁에서는 건너뛴다
  await scenario('[회원] 카메라 켜기 → 내 PiP 가 켜짐 상태가 되고 getUserMedia(video) 호출', async () => {
    if (!sessionId) throw new Error('선행 세션 생성 실패');
    const ctx = await newContext(browser, VIEWPORTS[0], 'client');
    const page = await ctx.newPage();
    try {
      await joinAsMember(page);
      await page.locator('[data-pz="mbtn"]').filter({ hasText: /카메라/ }).click();
      await page.waitForFunction(() => document.querySelector('[data-pz="mypip"]')?.getAttribute('data-cam') === 'on', null, { timeout: 15000 });
      const video = await page.evaluate(() => window.__gum?.video ?? 0);
      if (video < 1) throw new Error('카메라를 켰는데 getUserMedia(video) 호출이 없음');
    } finally {
      await ctx.close();
    }
  });
}

await scenario('[코치] /sessions/:id/player → 새 진행 화면(1:1 카드·도크), 페이지 버튼 없음 · 측정 위반 0', async () => {
  if (!sessionId) throw new Error('선행 세션 생성 실패');
  for (const vp of VIEWPORTS) {
    const ctx = await newContext(browser, vp, 'counselor');
    const page = await ctx.newPage();
    try {
      await signIn(page, 'counselor', '/dashboard');
      await page.goto(`${BASE}/sessions/${sessionId}/player`, { waitUntil: 'networkidle' });
      await page.locator('[data-pz="app"] [data-pz="dock"]').waitFor({ timeout: 20000 });
      if (!(await page.locator('[data-pz="btn-end"]').count())) throw new Error('종료 버튼(data-pz=btn-end) 없음');
      if (!GROUP && !(await page.locator('[data-pz="solo"]').count())) throw new Error('1:1 큰 회원 카드(data-pz=solo) 없음');
      if (GROUP && !(await page.locator('[data-pz="tile"]').count())) throw new Error('참가자 타일(data-pz=tile) 없음');
      const text = await bodyText(page);
      if (/‹|›|다음 참가자 페이지|이전 참가자 페이지/.test(text)) throw new Error('페이지 이동 버튼이 남아 있음');
      // 스텁은 실시간 소켓이 없어 재연결 배너가 뜬다 — 배너 자체의 대비·크기만 확인하고 나머지 규칙은 그대로 적용한다
      await assertFit(page, 'host', `코치 ${vp.join('x')}`);
      await shot(page, `host-live${GROUP ? '-group' : ''}-${vp.join('x')}`);
    } finally {
      await ctx.close();
    }
  }
});

await scenario('[종료] 코치 종료 → 회원 화면이 점수 없는 종료 카드(수고하셨어요)로 바뀐다', async () => {
  if (!sessionId) throw new Error('선행 세션 생성 실패');
  const ctx = await newContext(browser, VIEWPORTS[0], 'client');
  const page = await ctx.newPage();
  try {
    await joinAsMember(page);
    if (STUB) {
      stubState.status = 'completed';
    } else {
      const r = await fetch(`${API}/sessions/${sessionId}/end`, { method: 'POST', headers: H(counselorToken) });
      if (r.status !== 200) throw new Error(`세션 종료 ${r.status}`);
      sessionId = null;
    }
    await page.getByText('수고하셨어요').waitFor({ timeout: 20000 });
    await shot(page, 'member-end-390x844');
    const text = await bodyText(page);
    if (/\d+\s*%/.test(text)) throw new Error('종료 카드에 퍼센트 숫자가 있음');
    if (!/리포트 받기/.test(text) || !/오늘 상태 남기기/.test(text)) throw new Error('리포트 받기·오늘 상태 남기기 진입점 없음');
    await page.getByRole('button', { name: '리포트 받기' }).click();
    await page.locator('[data-pz="flow-sheet"]').waitFor({ timeout: 5000 });
  } finally {
    await ctx.close();
  }
});

if (!STUB && sessionId && counselorToken) {
  await fetch(`${API}/sessions/${sessionId}/end`, { method: 'POST', headers: H(counselorToken) }).catch(() => undefined);
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n라이브 E2E${STUB ? '(stub)' : ''} 결과: ${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
