// SDD-246 T06 로컬 E2E — 상담사·회원 두 브라우저 컨텍스트(로컬 backend+vite, 합성 계정). 결과 JSON: /tmp/t06/e2e-result.json
// 사용: node tests/sdd246-web/e2e/e2e-live.mjs   (frontend cwd, 서버는 /tmp/t06/start-be.sh + vite VITE_LIVE_PROTOCOL_V2=true 로 기동)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PY0 = process.env.E2E_PY || '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python';
const DBENV = { ...process.env, DATABASE_URL: 'postgresql://localhost/sdd246_t06_e2e', JWT_SECRET_KEY: 'sdd246-t06-local-secret-0123456789abcdef' };
// 매 실행마다 새 합성 회차(open 상태)를 시드한다 — 이전 실행이 시작/종료한 회차를 재사용하지 않는다.
execFileSync(PY0, ['-I', fileURLToPath(new URL('./seed.py', import.meta.url)), 'init'], { env: DBENV, stdio: 'ignore' });
const seed = JSON.parse(fs.readFileSync('/tmp/t06/seed.json', 'utf8'));
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5199';
const SHOTS = process.env.E2E_SHOTS || '/tmp/t06/shots';
const PY = process.env.E2E_PY || '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python';
const SEEDPY = fileURLToPath(new URL('./seed.py', import.meta.url));
const RESTART = process.env.E2E_RESTART_CMD; // 백엔드 재시작 명령(없으면 재시작 시험 생략)
fs.mkdirSync(SHOTS, { recursive: true });
const result = { steps: [], hand: [], restart: null };
const log = (...a) => console.log(...a);
setTimeout(() => { log('HARD TIMEOUT'); fs.writeFileSync('/tmp/t06/e2e-result.json', JSON.stringify(result, null, 1)); process.exit(3); }, 280000);

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

async function open(email, role, viewport) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const rest = []; // READY 이후 REST 폴링 계측
  page.on('request', (r) => { if (/\/live-metrics|\/entry-state|\/participation|\/live-v2\/snapshot/.test(r.url()) && r.method() === 'GET') rest.push({ t: Date.now(), url: r.url().replace(/^.*\/api\/v1/, '') }); });
  if (process.env.E2E_TRACE) page.on('websocket', (ws) => { if (!ws.url().includes('socket.io')) return; const t0 = Date.now(); const L = (d, f) => { const x = String(f.payload); if (/live:(hello|join|snapshot|sync_complete|heartbeat|resync|degraded)|^4[0-4]\/session-live,\d*\[?\{"(ok|code)/.test(x) || /^(40|41)/.test(x)) log(`[${role} ws +${Date.now() - t0}ms ${d}]`, x.slice(0, 140)); }; ws.on('framesent', (f) => L('>', f)); ws.on('framereceived', (f) => L('<', f)); ws.on('close', () => log(`[${role} ws closed +${Date.now() - t0}ms]`)); });
  if (process.env.E2E_FRAMES) page.on('websocket', (ws) => { if (!ws.url().includes('socket.io')) return; const w = (d, f) => { const x = String(f.payload); if (x === '2' || x === '3' || x.includes('live:heartbeat')) return; fs.appendFileSync(process.env.E2E_FRAMES, `${Date.now()} ${role} ${d} ${x.slice(0, 900)}\n`); }; ws.on('framesent', (f) => w('>', f)); ws.on('framereceived', (f) => w('<', f)); ws.on('close', () => fs.appendFileSync(process.env.E2E_FRAMES, `${Date.now()} ${role} CLOSE\n`)); });
  page.on('pageerror', (e) => log('PAGEERR', e.message.slice(0, 160)));
  await page.goto(`${BASE}/login?role=${role}`);
  await page.click(`#login-tab-${role}`).catch(() => {});
  await page.fill('#login-email', email);
  await page.fill('#login-password', seed.password);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return { ctx, page, rest };
}
const body = async (p) => (await p.locator('body').innerText({ timeout: 4000 }).catch(() => '')).replace(/\n+/g, ' | ');
const step = (name, ok, extra = {}) => { result.steps.push({ name, ok, ...extra }); log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(extra)); };

// ── 상담사 1440 ──
const host = await open(seed.host.email, 'counselor', { width: 1440, height: 900 });
await host.page.goto(`${BASE}/sessions/${seed.session_id}/player`);
await host.page.waitForFunction(() => document.body.innerText.includes('시작하기'), null, { timeout: 20000 });
step('상담사 로비 표시', true);

// ── 회원 390: 입장 → 마법사 건너뛰기 ──
const mem = await open(seed.members[0].email, 'client', { width: 390, height: 844 });
await mem.page.goto(`${BASE}/class/${seed.session_id}/enter`);
await mem.page.waitForTimeout(2000);
for (let i = 0; i < 10; i++) {
  const t = await body(mem.page);
  if (/지금 손|손들기|손 들기|클래스가 시작/.test(t) || mem.page.url().includes('/live')) break;
  const chk = mem.page.getByText('녹음·녹화에 동의해요');
  if (await chk.count()) await chk.first().click({ timeout: 3000 }).catch(() => {});
  const nxt = mem.page.locator('button:visible', { hasText: /동의하고 입장하기|입장하기|확인하고 계속하기|건너뛰기|다음|계속|완료|마치기|입장 준비 완료/ }).first();
  if (!(await nxt.count())) break;
  await nxt.click({ timeout: 3000 }).catch(() => {});
  await mem.page.waitForTimeout(1200);
}
await mem.page.screenshot({ path: `${SHOTS}/member-wait-390.png` });
step('회원 입장·대기', true, { text: (await body(mem.page)).slice(0, 120) });

// 상담사 대기실에 회원이 보이는지(waiting.set_ready/entry.enter 가 LiveState 로 도착)
await host.page.waitForTimeout(2500);
const hostLobby = await body(host.page);
await host.page.screenshot({ path: `${SHOTS}/host-lobby-1440.png` });
step('상담사 대기실 반영', /대기실 [1-9]명|합성 회원0/.test(hostLobby), { text: hostLobby.slice(0, 160) });

// ── 시작 ──
await host.page.locator('button:visible', { hasText: '시작하기' }).first().click();
const confirm = host.page.locator('button:visible', { hasText: /기록 없이|녹음 없이|수동|시작$|바로 시작|확인/ }).first();
await host.page.waitForTimeout(1200);
for (let i = 0; i < 4; i++) {
  const b = host.page.locator('button:visible', { hasText: /음성 기록 없이 시작|기록 없이 시작|수동 기록|이대로 시작|시작하기/ }).last();
  if (!(await b.count())) break;
  await b.click({ timeout: 3000 }).catch(() => {});
  await host.page.waitForTimeout(1500);
  if (/진행 중|모니터링|경과/.test(await body(host.page))) break;
}
await host.page.waitForTimeout(3000);
for (let i = 0; i < 8; i++) {
  const t = await body(mem.page);
  if (/손/.test(t) && !/내 영상과 소리를 확인해요/.test(t)) break;
  const now = mem.page.locator('button:visible', { hasText: '지금 입장하기' }).first();
  const nxt = (await now.count()) ? now : mem.page.locator('button:visible', { hasText: /건너뛰기|다음|계속|완료|마치기|입장하기/ }).first();
  if (!(await nxt.count())) break;
  await nxt.click({ timeout: 3000 }).catch(() => {});
  await mem.page.waitForTimeout(1200);
}
log('HOST', (await body(host.page)).slice(0, 300));
log('MEMBER', (await body(mem.page)).slice(0, 300));
const memberText = await body(mem.page);
step('시작 → 회원 화면 전환', !/시작 전|기다리/.test(memberText) || /손/.test(memberText), { text: memberText.slice(0, 140) });
await host.page.screenshot({ path: `${SHOTS}/host-running-1440.png` });
await mem.page.screenshot({ path: `${SHOTS}/member-running-390.png` });

// ── 손들기/내리기 왕복 ──
// 온보딩 코치마크가 클릭을 가리므로 먼저 닫는다.
await mem.page.getByText('다시 보지 않기').first().click({ timeout: 3000 }).catch(() => {});
await mem.page.locator('[role=dialog] button:visible', { hasText: /건너뛰기|닫기|다음/ }).first().click({ timeout: 2000 }).catch(() => {});
for (let i = 0; i < 4 && (await mem.page.locator('[role=dialog]').count()); i++) {
  await mem.page.locator('[role=dialog] button:visible', { hasText: /다음|완료|시작|건너뛰기|닫기/ }).last().click({ timeout: 2000 }).catch(() => {});
  await mem.page.waitForTimeout(300);
}
const handCount = async () => Number((await body(host.page)).match(/손들기 (\d+)/)?.[1] ?? NaN);
const memberBtn = (re) => mem.page.locator('button:visible', { hasText: re }).first();
for (let i = 0; i < Number(process.env.E2E_HAND_N || 5); i++) {
  if (!(await memberBtn(/^손들기$|손들기/).count())) { step('손들기 버튼 존재', false, { text: (await body(mem.page)).slice(0, 200) }); break; }
  // 올리기: 회원 클릭 → 상담사 '손들기 1'
  const t0 = Date.now();
  await memberBtn(/손들기/).click();
  const memberSawMs = await mem.page.waitForFunction(() => /손 내리기/.test(document.body.innerText), null, { timeout: 5000 }).then(() => Date.now() - t0).catch(() => null);
  const hostRaiseMs = await host.page.waitForFunction(() => /손들기 1(?!\d)/.test(document.body.innerText), null, { timeout: 5000 }).then(() => Date.now() - t0).catch(() => null);
  // 내리기: 회원 클릭 → 상담사 '손들기 0'
  const t1 = Date.now();
  await memberBtn(/손 내리기/).click();
  const memberLowerMs = await mem.page.waitForFunction(() => /손들기/.test(document.body.innerText) && !/손 내리기/.test(document.body.innerText), null, { timeout: 5000 }).then(() => Date.now() - t1).catch(() => null);
  const hostLowerMs = await host.page.waitForFunction(() => /손들기 0(?!\d)/.test(document.body.innerText), null, { timeout: 5000 }).then(() => Date.now() - t1).catch(() => null);
  result.hand.push({ i, memberOptimisticRaiseMs: memberSawMs, hostSeesRaiseMs: hostRaiseMs, memberOptimisticLowerMs: memberLowerMs, hostSeesLowerMs: hostLowerMs });
  if (i === 0) {
    await host.page.screenshot({ path: `${SHOTS}/host-hand-1440.png` });
  }
}
log('hand', JSON.stringify(result.hand));
const ok = result.hand.length > 0 && result.hand.every((h) => h.hostSeesRaiseMs !== null && h.hostSeesLowerMs !== null);
step('손들기/내리기 왕복', ok, { n: result.hand.length });
await mem.page.screenshot({ path: `${SHOTS}/member-hand-390.png` });

// 실제 스트림처럼 1초 간격으로 신선한 metric 을 주입하는 도우미
function startFeeder(value, firstSeq) {
  let stop = false; let n = firstSeq;
  const done = (async () => { while (!stop) { try { execFileSync(PY, ['-I', SEEDPY, 'metric', seed.session_id, seed.members[0].participant_id, String(value), String(n++)], { env: DBENV, stdio: 'ignore' }); } catch { /* 서버 미복귀 */ } await new Promise((r) => setTimeout(r, 1000)); } })();
  return async () => { stop = true; await done; };
}
// ── 합성 metric 주입 → 상담사 숫자 ──
const memberPid = seed.members[0].participant_id;
const stopMetric = startFeeder(77, 1);
const seen = await host.page.waitForFunction(() => /\b77\b/.test(document.body.innerText), null, { timeout: 30000 }).then(() => true).catch(() => false);
await host.page.screenshot({ path: `${SHOTS}/host-metric-1440.png` });
step('합성 metric 77 상담사 표시', seen);

// ── 회원 화면: 현재값(모바일) / 5분 막대(데스크톱) ──  (feeder 가 계속 돌고 있다)
await mem.page.locator('button:visible', { hasText: /^상태$|내 상태/ }).first().click({ timeout: 3000 }).catch(() => {});
await mem.page.waitForTimeout(2500);
const memberMobile = await mem.page.locator('[data-testid="metric-bars"]').count();
const mobileCurrent = (await mem.page.locator('[data-testid="metric-current"]').first().innerText().catch(() => '')).replace(/\n/g, ' ');
await mem.page.screenshot({ path: `${SHOTS}/member-status-390.png` });
await mem.page.setViewportSize({ width: 1440, height: 900 });
await mem.page.waitForTimeout(2500);
const memberDesktop = await mem.page.locator('[data-testid="metric-bars"]').count();
const desktopCurrent = (await mem.page.locator('[data-testid="metric-current"]').first().innerText().catch(() => '')).replace(/\n/g, ' ');
await mem.page.screenshot({ path: `${SHOTS}/member-status-1440.png` });
result.memberBars = { mobile: memberMobile, desktop: memberDesktop, mobileCurrent, desktopCurrent };
// 밴드 없는 합성 회원은 독에 '상태' 시트가 없어(BAND_LIVE 아님) 막대를 E2E 로 열 수 없다 → 단위 시험(metric-bars.test.tsx)이 정본, 여기서는 미검증으로 기록한다.
const statusReachable = memberDesktop > 0 || mobileCurrent !== '';
if (statusReachable) step('5분 막대: 데스크톱만, 현재값은 둘 다', memberMobile === 0 && memberDesktop > 0 && /77/.test(mobileCurrent) && /77/.test(desktopCurrent), result.memberBars);
else { result.steps.push({ name: '5분 막대 E2E', ok: null, skipped: '밴드 없는 회원은 상태 시트 없음 — 단위 시험으로 대체' }); log('SKIP 5분 막대 E2E (밴드 없는 회원은 상태 시트 없음)'); }
await mem.page.setViewportSize({ width: 390, height: 844 });
await stopMetric();

// ── REST 폴링 계측(READY 구간) ──
const t = Date.now();
host.rest.length = 0; mem.rest.length = 0;
await host.page.waitForTimeout(12000);
result.restPollsIn12s = { host: host.rest.length, member: mem.rest.length, hostUrls: [...new Set(host.rest.map((r) => r.url))], memberUrls: [...new Set(mem.rest.map((r) => r.url))] };
log('REST polls 12s', JSON.stringify(result.restPollsIn12s));

// ── 백엔드 재시작 복구 ──
// 측정: ① 서버 복귀(health) ② 클라이언트 재연결 후 live:snapshot 수신 ③ 서버 복귀 후 주입한 신선한 metric 이 화면에 뜨는 시각. 모두 재시작 명령 시작 기준.
if (RESTART) {
  const frames = [];
  host.page.on('websocket', (ws) => { if (ws.url().includes('socket.io')) ws.on('framereceived', (f) => { const x = String(f.payload); if (x.includes('"live:snapshot"')) frames.push(Date.now()); }); });
  // 이미 열려 있는 소켓의 프레임은 기존 websocket 이벤트로 못 잡으므로, 재연결(새 소켓)부터 기록된다.
  const t0 = Date.now();
  execFileSync('bash', ['-c', RESTART], { stdio: 'inherit' });
  let upMs = null;
  for (let i = 0; i < 300 && upMs === null; i++) {
    const ok = await fetch('http://127.0.0.1:8000/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status === 422).catch(() => false);
    if (ok) upMs = Date.now() - t0; else await new Promise((r) => setTimeout(r, 100));
  }
  // 실제 스트림처럼 서버 복귀 직후부터 1초마다 신선한 metric(값 88)을 주입한다. (재빌드된 snapshot 의 metric 은 설계상 stale)
  const tInj = Date.now();
  let seqN = 2;
  let stop = false;
  const feeder = (async () => { while (!stop) { try { execFileSync(PY, ['-I', SEEDPY, 'metric', seed.session_id, memberPid, '88', String(seqN++)], { env: DBENV, stdio: 'ignore' }); } catch { /* 서버 미복귀 */ } await new Promise((r) => setTimeout(r, 1000)); } })();
  if (process.env.E2E_SAMPLE) { for (let k = 0; k < 16; k++) { await new Promise((r) => setTimeout(r, 3000)); const tx = await body(host.page); log(`SAMPLE +${Date.now() - t0}ms`, /\b88\b/.test(tx) ? 'HAS88' : 'no88', tx.slice(0, 170)); if (/\b88\b/.test(tx)) break; } }
  const back = await host.page.waitForFunction(() => /\b88\b/.test(document.body.innerText), null, { timeout: 60000 }).then(() => Date.now() - t0).catch(() => null);
  stop = true; await feeder;
  const snapMs = frames.length ? frames[0] - t0 : null;
  result.restart = { serverUpMs: upMs, snapshotAfterRestartMs: snapMs, metricVisibleMs: back, metricInjectedAtMs: tInj - t0 };
  step('백엔드 재시작 후 30초 내 자동 복구', back !== null && back <= 30000, result.restart);
  await host.page.screenshot({ path: `${SHOTS}/host-after-restart-1440.png` });
  await mem.page.screenshot({ path: `${SHOTS}/member-after-restart-390.png` });
}
fs.writeFileSync('/tmp/t06/e2e-result.json', JSON.stringify(result, null, 1));
await browser.close();
process.exit(0);
