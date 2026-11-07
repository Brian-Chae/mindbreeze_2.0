// SDD-320 후속 — 하단 메뉴 반전 3역할 확인. 사용: node e2e/sdd320b-nav-probe.mjs <dist> <out> <client|org_admin|counselor>
// SDD-320 후속(320b) — 코치 D안(UI_V2 on) 화면 캡처·측정. 서버 없이 빌드 산출물을 Chrome 에 제공하고 모든 API 는 합성 데이터다.
// 사용: node e2e/sdd320b-capture.mjs <dist-v2 경로> <출력 디렉터리>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
const HOST = 'https://sdd320.local';
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.html': 'text/html', '.json': 'application/json' };
const iso = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();
const ROLE = process.argv[4] || 'counselor';
const user = { id: 'c-1', email: 'coach@example.test', name: '합성 사용자', role: ROLE, counselors: [], verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselor_code: 'ABC123' };
const row = (id, title, status, d, h, extra = {}) => ({ id, class_id: 'c1', area: 'meditation', seq: 3, title, type: 'meditation', custom_type_name: null, status, access_code: 'K7Q2', participant_mode: 'open', participant_count: 8, guest_count: 1, scheduled_at: iso(d, h, 0), started_at: null, ended_at: null, created_at: iso(1, 9, 0), has_record: false, record_status: null, has_summary: false, report_count: 0, pending_review_count: 0, ...extra });
const dash = { counselor_id: 'c-1', counselor_name: '합성 코치', org_id: null, org_name: null, org_kind: 'individual', total_classes: 3, in_progress_classes: 1, completed_classes: 1, total_participants: 12, total_members: 12, pending_review_count: 2, classes: [row('s1', '저녁의 호흡', 'scheduled', 8, 19), row('s2', '잠시 머무는 연습', 'scheduled', 9, 10), row('s0', '가을의 마음 산책', 'completed', 3, 19, { has_record: true, has_summary: true, pending_review_count: 2, report_count: 2 })] };
const hostClass = (id, title, status) => ({ id, title, status, schedule_mode: 'fixed', planned_session_count: 8, area: 'meditation', progress: { completed: 2, total: 8 }, session_count: 8, member_count: 8, next_session: { id: 's1', seq: 3, scheduled_at: iso(8, 19, 0), status: 'scheduled' }, has_open_session: false, host: { id: 'c-1', name: '합성 코치' }, is_instant: false });
const classes = { classes: [hostClass('c1', '저녁의 호흡', 'active'), hostClass('c2', '잠시 머무는 연습', 'draft'), hostClass('c3', '가을의 마음 산책', 'completed')], total: 3 };
const rooms = { rooms: [{ id: 'r1', session_id: null, room_type: 'direct', host_id: 'c-1', name: null, peer_name: '김회원', peer_id: 'm-1', session_title: null, session_scheduled_at: null, participant_count: 2, created_at: iso(2, 9, 0), unread_count: 2, last_message_at: iso(7, 9, 30), display_name: '김회원', last_message: { content: '다음 회차 시간 확인했어요' } }], total: 1 };
const notifications = { notifications: [{ id: 'n1', type: 'report', title: '리포트 검토가 필요해요', body: '가을의 마음 산책 · 2건', is_read: false, extra: null, created_at: iso(7, 8, 0) }], total: 1, unread: 1 };
const clients = [{ id: 'm-1', name: '김회원', email: 'm1@example.test', status: 'active', joined_at: iso(1, 9, 0), class_count: 2, last_session_at: iso(3, 19, 0) }, { id: 'm-2', name: '이회원', email: 'm2@example.test', status: 'active', joined_at: iso(2, 9, 0), class_count: 1, last_session_at: iso(3, 19, 0) }];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const cls = (id, title, status, extra = {}) => ({ id, title, type: 'meditation', custom_type_name: null, status, access_code: 'AB' + id.toUpperCase().padEnd(4, 'X'), participant_mode: 'open', participant_count: 6, guest_count: 1, started_at: iso(2, 10, 0), ended_at: iso(2, 11, 0), has_record: true, has_summary: false, report_count: 1, pending_review_count: 0, ...extra });
const dashboard = {
  org_id: 'org-1', org_name: '마음숲 상담센터', org_code: 'MS2026', total_counselors: 3, total_classes: 12, total_participants: 40, total_members: 47, completed_classes: 7, in_progress_classes: 2,
  counselors: [
    { id: 'k1', name: '가코치', email: 'coach.ga@example.test', class_count: 5, participant_count: 21, completed_count: 3 },
    { id: 'k2', name: '나코치', email: 'coach.na@example.test', class_count: 4, participant_count: 14, completed_count: 3 },
    { id: 'k3', name: '다코치', email: 'coach.da@example.test', class_count: 3, participant_count: 12, completed_count: 1 },
  ],
  classes: [cls('c1', '저녁의 호흡 · 8회기 과정', 'completed'), cls('c2', '잠시 머무는 연습', 'in_progress', { has_record: false, ended_at: null }), cls('c3', '가을의 마음 산책', 'scheduled', { has_record: false, started_at: null, ended_at: null, participant_count: 0, guest_count: 0 }), cls('c4', '임상 상담 집중 코스', 'completed', { type: 'clinical' })],
};
const item = (id, name, over = {}) => ({ id, name, email: `${id}@example.test`, role: 'counselor', status: 'active', counselor_code: 'CD' + id.toUpperCase(), has_personal_office: false, invited_at: null, invite_expires_at: null, invite_type: null, ...over });
const counselors = [item('k1', '가코치', { has_personal_office: true }), item('k2', '나코치'), item('k3', '다코치', { status: 'suspended' }), item('k4', '라코치', { status: 'pending', counselor_code: null, invite_type: 'new_account', invite_expires_at: '2999-01-01T00:00:00Z' }), item('a1', '마관리자', { role: 'org_admin', counselor_code: null })];

async function open(width, reduced = false) {
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : width === 768 ? 1024 : 844 }, serviceWorkers: 'block', deviceScaleFactor: width === 1440 ? 1 : 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await context.routeWebSocket('**/*', (s) => s.close());
  await context.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), user);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
    if (url.hostname !== 'sdd320.local') return route.abort('blockedbyclient');
    if (route.request().method() === 'OPTIONS') return json({});
    if (p.startsWith('/api/')) {
      if (p.endsWith('/auth/refresh')) return json({ access_token: 'synthetic', token_type: 'bearer' });
      if (p.endsWith('/auth/users/me')) return json(user);
      if (/dashboard\/org$/.test(p)) return json(dashboard);
      if (/dashboard\/counselor/.test(p)) return json(dash);
      if (/chat\/rooms/.test(p)) return json(rooms);
      if (/notifications\/preferences/.test(p)) return json({ email: {}, in_app: {}, push: {} });
      if (/reports\/hierarchy/.test(p)) return json({ summary: { needs_review: 2, failed_delivery: 0, generation_failed: 0, total_sessions: 1, total_members: 2 }, groups: [{ key: 'c1', kind: 'class', class_id: 'c1', title: '가을의 마음 산책', needs_review: 2, session_total: 1, sessions: [{ session_id: 's0', title: '가을의 마음 산책', type: 'meditation', scheduled_at: iso(3, 19, 0), counselor_id: 'c-1', counselor_name: '합성 코치', participant_count: 2, matched_count: 2, needs_review: 2, delivery_failed: 0, common_report: null, members: [] }] }], total_sessions: 1, page: 1, limit: 10 });
      if (/reports\/auto-approve/.test(p)) return json({ enabled: false });
      if (/notifications\/unread-count/.test(p)) return json({ unread: 1 });
      if (/notifications/.test(p)) return json(notifications);
      if (/reports\/counts/.test(p)) return json({ unread: 0, pending_review: 2 });
      if (/\/reports\/?$/.test(p)) return json({ reports: [], total: 0 });
      if (/\/classes\/c1\/?$/.test(p)) return json({ ...hostClass('c1', '저녁의 호흡', 'active'), location_type: 'online', linkband_mode: 'optional', record_audio: false, capacity: 12, participant_mode: 'open', default_duration_min: 60 });
      if (/\/classes\/?$/.test(p)) return json(classes);
      if (/\/clients/.test(p)) return json({ clients, total: 2, items: clients });
      if (/notification-preferences|preferences/.test(p)) return json({ preferences: [], items: [], events: {}, channels: {} });
      if (/users\/me\/consents/.test(p)) { const c = { agreed: false, version: null, agreed_at: null, withdrawn_at: null }; return json({ tos: { ...c, agreed: true }, privacy: { ...c, agreed: true }, sensitive: { ...c, agreed: true }, eeg: c, research: c }); }
      if (/upload-status/.test(p)) return json({ summary: { needs_attention: 0, uploading: 0, received_unreconciled: 0, no_data: 0, excluded: 0 }, participants: [], items: [], total: 0 });
      if (/auth\/(sessions|consents|privacy|devices)|consents|blocks|blocked/.test(p)) return json({ items: [], consents: [], blocks: [], users: [], sessions: [], total: 0 });
      if (/counselor-agent|agent/.test(p)) return json({ unread: 0, items: [] });
      return json({ items: [], sessions: [], classes: [], total: 0 });
    }
    const asset = path.join(dist, p); const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(dist, 'index.html');
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  return { context, page };
}


const target = { client: '/app', org_admin: process.argv[5] || '/dashboard/org', counselor: '/dashboard' }[ROLE];
const out2 = [];
{
  const { context, page } = await open(390);
  await page.goto(HOST + target, { waitUntil: 'load' });
  await page.waitForSelector('.u2-nav, .floating-bottom-nav', { timeout: 15000 }).catch(() => errors.push('nav 없음'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `nav-${ROLE}-390.png`) });
  const m = await page.evaluate(() => {
    const nav = document.querySelector('.u2-nav, .floating-bottom-nav'); if (!nav) return null;
    const items = [...nav.querySelectorAll('a,button')].map((a) => ({ t: (a.textContent || '').trim().slice(0, 8), cur: a.getAttribute('aria-current') === 'page', color: getComputedStyle(a).color }));
    const r = nav.getBoundingClientRect(); const wrap = nav.parentElement.getBoundingClientRect();
    return { cls: nav.className.slice(0, 40), bg: getComputedStyle(nav).backgroundColor, items, bottomGap: Math.round(innerHeight - r.bottom), height: Math.round(r.height), scoped: document.documentElement.classList.contains('u2-coach'), ui: !!document.querySelector('.ui-v2') };
  });
  out2.push(m);
  await context.close();
}
await browser.close();
console.log(JSON.stringify({ role: ROLE, errors, out2 }, null, 1));
