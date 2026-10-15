// SDD-205 역할별 여정 (약 29개). 실행: E2E_PASSWORD=... node e2e/journeys.mjs
import { scenario, uiLogin, go, bodyText, expectText, apiLogin, apiLoginFull, finish, BASE, API, EMAIL, HOME } from './lib.mjs';

const TITLE = `E2E-여정-${Date.now()}`;

// ── 내담자 (7) ─────────────────────────────────────────
const client = (name, fn, o) => scenario(`[내담자] ${name}`, async (p) => { await uiLogin(p, 'client', HOME.client); await fn(p); }, o);
await client('홈: 인사·담당 상담사·일정 영역', async (p) => { await expectText(p, '/app', '안녕하세요, E2E-내담자님', '담당 상담사', '이번 주 일정'); });
await client('세션: 달력 표시', async (p) => { await expectText(p, '/app/sessions', '세션', '오늘'); });
await client('리포트: 빈 상태 안내', async (p) => { await expectText(p, '/app/reports', '리포트'); });
await client('채팅: 루시·담당 상담사 대화방 노출', async (p) => { await expectText(p, '/app/chat', '루시', 'E2E-상담사'); });
await client('알림: 빈 상태', async (p) => { await expectText(p, '/app/notifications', '알림'); });
await client('다음 세션 카드: 제목·설명 글자가 흰색(어두운 배경 대비)', async (p) => {
  // 상담사가 E2E 세션을 만들어 내담자를 참여시킨 뒤, 내담자 홈의 '다음 세션' 히어로 글자색을 확인하고 삭제한다.
  const c = await apiLoginFull('counselor');
  const cl = await apiLoginFull('client');
  const H = { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' };
  const at = new Date(Date.now() + 2 * 86400000).toISOString();
  const r = await fetch(`${API}/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'meditation', duration_min: 30, title: `E2E-히어로-${Date.now()}`, scheduled_at: at, location_type: 'online', participant_mode: 'one_on_one', max_participants: 2, participant_ids: [cl.user.id] }) });
  if (r.status !== 201) throw new Error(`세션 생성 ${r.status}`);
  const id = (await r.json()).id;
  try {
    await go(p, '/app');
    const hero = p.locator('section[class*="from-[#6E1A8C]"]').filter({ hasText: '다음 세션' }).first();
    await hero.waitFor({ timeout: 10000 });
    const colors = await hero.evaluate((el) => [...el.querySelectorAll('h2, p')].map((n) => ({ t: n.tagName, c: getComputedStyle(n).color })));
    const dark = colors.filter(({ c: col }) => { const m = col.match(/\d+/g).map(Number); return m[0] < 200 || m[1] < 200 || m[2] < 200; });
    if (dark.length) throw new Error(`어두운 글자색: ${dark.map((d) => `${d.t} ${d.c}`).join(', ')}`);
  } finally {
    const d = await fetch(`${API}/sessions/${id}`, { method: 'DELETE', headers: H });
    if (d.status !== 204) throw new Error(`E2E 세션 삭제 실패 ${d.status} (id=${id})`);
  }
});
await client('설정: 계정 정보 표시 및 카드 제목 중복 없음', async (p) => {
  const t = await expectText(p, '/app/profile', 'e2e-client@e2e.looxidlabs.com', '계정 정보');
  const heads = await p.locator('h2,h3').allInnerTexts();
  const dup = heads.map((h) => h.trim()).filter((h, i, a) => a.indexOf(h) !== i);
  if (dup.length) throw new Error(`카드 제목 중복: ${dup.join(',')}`);
});
await client('로그아웃 → 로그인 화면, 보호 페이지 재접근 차단', async (p) => {
  await go(p, '/app');
  await p.getByRole('button', { name: '로그아웃' }).first().click();
  await p.waitForURL((u) => u.pathname.startsWith('/login') || u.pathname === '/', { timeout: 15000 });
  await go(p, '/app');
  if (new URL(p.url()).pathname.startsWith('/app')) throw new Error('로그아웃 후에도 /app 접근 가능');
});

// ── 상담사 (11) ────────────────────────────────────────
const cou = (name, fn, o) => scenario(`[상담사] ${name}`, async (p) => { await uiLogin(p, 'counselor', HOME.counselor); await fn(p); }, o);
await cou('대시보드: 핵심 영역 4개', async (p) => { await expectText(p, '/dashboard', '오늘 · 다가오는 일정', '내 클래스', '최근 대화', '새 알림'); });
await cou('내담자 목록: 연결된 E2E-내담자 노출', async (p) => { await expectText(p, '/clients', 'E2E-내담자', 'e2e-client@e2e.looxidlabs.com'); });
await cou('내담자 검색: 없는 이름 → 결과 없음', async (p) => {
  await go(p, '/clients');
  const box = p.getByPlaceholder(/검색/).first();
  await box.fill('zzzz-없는사람'); await box.press('Enter'); await p.waitForTimeout(1500);
  if ((await bodyText(p)).includes('e2e-client@e2e.looxidlabs.com')) throw new Error('검색 필터가 동작하지 않음');
});
await cou('내담자 초대: 폼 노출 (제출 안 함)', async (p) => { await expectText(p, '/clients/invite', '내담자 초대', '초대 링크 생성'); });
await cou('세션: 달력·목록·예약 버튼', async (p) => { await expectText(p, '/sessions', '예약 만들기', '즉시 클래스', '전체 목록'); });
await cou('세션 예약 창 열기/닫기', async (p) => {
  await go(p, '/sessions');
  await p.getByRole('button', { name: '예약 만들기' }).first().click();
  await p.getByText('새 세션 생성').waitFor({ timeout: 8000 });
  await p.getByRole('button', { name: '세션 생성 닫기' }).click();
});
await cou('세션 생성 → 목록 노출 → 삭제(잔여 0)', async (p) => {
  const token = await apiLogin('counselor');
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const at = new Date(Date.now() + 3 * 86400000).toISOString();
  const r = await fetch(`${API}/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'meditation', duration_min: 30, title: TITLE, scheduled_at: at, location_type: 'online', participant_mode: 'one_on_one', max_participants: 2 }) });
  if (r.status !== 201) throw new Error(`세션 생성 ${r.status}`);
  const id = (await r.json()).id;
  try {
    await go(p, '/sessions');
    await p.getByRole('button', { name: '전체 목록' }).click().catch(() => {});
    await p.getByText(TITLE).first().waitFor({ timeout: 10000 });
  } finally {
    const d = await fetch(`${API}/sessions/${id}`, { method: 'DELETE', headers: H });
    if (d.status !== 204) throw new Error(`E2E 세션 삭제 실패 ${d.status} (id=${id})`);
  }
});
await cou('리포트: 목록·샘플 리포트 열기', async (p) => {
  await expectText(p, '/reports', '샘플 보기');
  await expectText(p, '/reports/sample', '샘플 리포트', '호흡수');
});
await cou('설정: 코드·카드 제목 중복 없음', async (p) => {
  await expectText(p, '/settings', 'E2E0C1', '계정 정보');
  const heads = (await p.locator('h2,h3').allInnerTexts()).map((h) => h.trim());
  const dup = heads.filter((h, i, a) => a.indexOf(h) !== i);
  if (dup.length) throw new Error(`카드 제목 중복: ${dup.join(',')}`);
});
await cou('채팅: 루시 AI 대화방과 내담자 대화방', async (p) => { await expectText(p, '/chat/lucy', '루시 (AI)', 'E2E-내담자'); });
await cou('인증 등급 페이지', async (p) => { await expectText(p, '/credentials', '인증 등급', '증빙 업로드'); });

// ── 기관 관리자 (5) ────────────────────────────────────
const org = (name, fn, o) => scenario(`[기관] ${name}`, async (p) => { await uiLogin(p, 'org_admin', HOME.org_admin); await fn(p); }, o);
await org('대시보드: 기관명·기관 코드', async (p) => { await expectText(p, '/dashboard/org', 'E2E-테스트기관', 'E2E001', '소속 상담사 실적'); });
await org('상담사 관리: 소속 상담사 목록', async (p) => { await expectText(p, '/org/counselors', '상담사 관리', 'E2E-상담사', 'E2E0C1'); });
await org('상담사 초대 폼 노출 (제출 안 함)', async (p) => { await expectText(p, '/dashboard/org', '상담사 초대', '초대 발송'); });
await org('내담자·세션·리포트 메뉴 로딩', async (p) => { for (const x of ['/clients', '/sessions', '/reports']) await expectText(p, x); });
await org('설정: 계정 정보·카드 제목 중복 없음', async (p) => {
  await expectText(p, '/settings', 'E2E-기관관리자', '계정 정보');
  const heads = (await p.locator('h2,h3').allInnerTexts()).map((h) => h.trim());
  const dup = heads.filter((h, i, a) => a.indexOf(h) !== i);
  if (dup.length) throw new Error(`카드 제목 중복: ${dup.join(',')}`);
});

// ── 접근 통제 (4) ──────────────────────────────────────
await scenario('[접근통제] 비로그인 → 보호 페이지는 로그인으로', async (p) => {
  await go(p, '/dashboard');
  if (!new URL(p.url()).pathname.startsWith('/login')) throw new Error(`이동: ${p.url()}`);
});
await scenario('[접근통제] 내담자가 상담사 대시보드 접근 차단', async (p) => {
  await uiLogin(p, 'client', HOME.client); await go(p, '/dashboard');
  if (new URL(p.url()).pathname === '/dashboard' && (await bodyText(p)).includes('오늘 · 다가오는 일정')) throw new Error('내담자가 상담사 화면 접근');
});
await scenario('[접근통제] 상담사가 기관 대시보드 접근 차단', async (p) => {
  await uiLogin(p, 'counselor', HOME.counselor); await go(p, '/dashboard/org');
  if ((await bodyText(p)).includes('소속 상담사 실적')) throw new Error('상담사가 기관 화면 접근');
});
await scenario('[접근통제] 없는 계정 로그인 → 오류 안내 (E2E 계정 잠금 방지)', async (p) => {
  await p.goto(`${BASE}/login?role=client`, { waitUntil: 'domcontentloaded' });
  await p.fill('#login-email', 'e2e-nobody@e2e.looxidlabs.com'); await p.fill('#login-password', 'Wrong-pass-1!');
  await p.locator('form button[type=submit]').click();
  await p.getByRole('alert').first().waitFor({ timeout: 10000 });
});

// ── 플랫폼 관리자 API (2) ──────────────────────────────
await scenario('[플랫폼관리자] 계정 목록 조회 (E2E 계정 포함)', async () => {
  const t = await apiLogin('platform_admin');
  const r = await fetch(`${API}/admin/users?limit=200`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error(`admin/users ${r.status}`);
  if (!JSON.stringify(await r.json()).includes('e2e-client@')) throw new Error('E2E 계정이 목록에 없음');
});
await scenario('[플랫폼관리자] 일반 사용자 토큰으로 관리자 API 차단', async () => {
  const t = await apiLogin('client');
  const r = await fetch(`${API}/admin/users`, { headers: { Authorization: `Bearer ${t}` } });
  if (![401, 403].includes(r.status)) throw new Error(`차단 안 됨 (${r.status})`);
});

await finish('journeys-result.json', '여정');
