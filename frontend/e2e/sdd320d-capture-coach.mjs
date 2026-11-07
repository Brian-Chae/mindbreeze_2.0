// SDD-320 후속 3(320c) — 코치 D안(UI_V2 on) 화면 캡처·측정. 서버 없이 빌드 산출물을 Chrome 에 제공하고 모든 API 는 합성 데이터다.
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
const user = { id: 'c-1', email: 'coach@example.test', name: '합성 코치', role: 'counselor', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselor_code: 'ABC123' };
const row = (id, title, status, d, h, extra = {}) => ({ id, class_id: 'c1', area: 'meditation', seq: 3, title, type: 'meditation', custom_type_name: null, status, access_code: 'K7Q2', participant_mode: 'open', participant_count: 8, guest_count: 1, scheduled_at: iso(d, h, 0), started_at: null, ended_at: null, created_at: iso(1, 9, 0), has_record: false, record_status: null, has_summary: false, report_count: 0, pending_review_count: 0, ...extra });
const dash = { counselor_id: 'c-1', counselor_name: '합성 코치', org_id: null, org_name: null, org_kind: 'individual', total_classes: 3, in_progress_classes: 1, completed_classes: 1, total_participants: 12, total_members: 12, pending_review_count: 2, classes: [row('s1', '저녁의 호흡', 'scheduled', 8, 19), row('s2', '잠시 머무는 연습', 'scheduled', 9, 10), row('s0', '가을의 마음 산책', 'completed', 3, 19, { has_record: true, has_summary: true, pending_review_count: 2, report_count: 2 })] };
const hostClass = (id, title, status) => ({ id, title, status, schedule_mode: 'fixed', planned_session_count: 8, area: 'meditation', progress: { completed: 2, total: 8 }, session_count: 8, member_count: 8, next_session: { id: 's1', seq: 3, scheduled_at: iso(8, 19, 0), status: 'scheduled' }, has_open_session: false, host: { id: 'c-1', name: '합성 코치' }, is_instant: false });
const classes = { classes: [{ ...hostClass('c1', '저녁의 호흡', 'active'), has_open_session: process.env.OPEN !== '0', open_session_id: 's1' },  hostClass('c2', '잠시 머무는 연습', 'draft'), hostClass('c3', '가을의 마음 산책', 'completed')], total: 3 };
const rooms = { rooms: [{ id: 'r1', session_id: null, room_type: 'direct', host_id: 'c-1', name: null, peer_name: '김회원', peer_id: 'm-1', session_title: null, session_scheduled_at: null, participant_count: 2, created_at: iso(2, 9, 0), unread_count: 2, last_message_at: iso(7, 9, 30), display_name: '김회원', last_message: { content: '다음 회차 시간 확인했어요' } }], total: 1 };
const notifications = { notifications: [{ id: 'n1', type: 'report', title: '리포트 검토가 필요해요', body: '가을의 마음 산책 · 2건', is_read: false, extra: null, created_at: iso(7, 8, 0) }], total: 1, unread: 1 };
const clients = [{ id: 'm-1', concerns: [], name: '김회원', email: 'm1@example.test', gender: 'female', age: 34, phone_masked: '010-****-1234', member_type: 'member', last_session_at: iso(3, 19, 0), session_count: 4, classes: [{ id: 'c1', title: '저녁의 호흡' }], counselors: [] }, { id: 'm-2', concerns: [], name: '이회원', email: 'm2@example.test', gender: 'male', age: 41, phone_masked: null, member_type: 'member', last_session_at: null, session_count: 0, classes: [], counselors: [] }];
const screens = [
  { key: 'home', url: '/dashboard', waitFor: 'h1' },
  { key: 'classes', url: '/classes', waitFor: 'h1' },
  { key: 'class-detail', url: '/classes/c1', waitFor: 'h1' },
];
const widths = [390, 1440];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = []; const errors = [];
function lum(hex) { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const contrast = [];
for (const fg of ['#25212C', '#68616F', '#5F0080']) for (const bg of ['#F4F4F7', '#FFFFFF', '#EEE5F5']) contrast.push({ fg, bg, ratio: +ratio(fg, bg).toFixed(2) });
contrast.push({ fg: '#FFFFFF', bg: '#5F0080', ratio: +ratio('#FFFFFF', '#5F0080').toFixed(2) });

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
      if (/\/credentials\/?$/.test(p)) return json({ credentials: [{ id: 'cr1', type: 'license', status: 'pending', file_name: 'license.pdf', created_at: iso(5, 9, 0), expires_at: null, reject_reason: null }], verified_tier: 'email', missing: ['id_card', 'diploma'] });
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
      if (/\/clients/.test(p)) return json({ clients, total: 2, page: 1, size: 20, items: clients });
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

for (const width of widths) {
  const { context, page } = await open(width);
  for (const s of screens) {
    await page.goto(HOST + s.url, { waitUntil: 'load' });
    await page.waitForSelector(s.waitFor, { timeout: 15000, state: 'attached' }).catch(() => errors.push(`${width}/${s.key}: ${s.waitFor} 없음`));
    await page.waitForTimeout(1100);
    await page.screenshot({ path: path.join(out, `${s.key}-${width}.png`) });
    const gap = width < 768 ? await page.evaluate(async () => {
      const nav = document.querySelector('.floating-bottom-nav, .u2-nav'); const sc = document.querySelector('[data-mobile-swipe-page]');
      if (!nav || !sc) return null;
      const all = [sc, ...sc.querySelectorAll('*')]; all.forEach((e) => { if (e.scrollHeight > e.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; });
      await new Promise((r) => setTimeout(r, 200));
      let max = 0; sc.querySelectorAll('*').forEach((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (r.height > 0 && cs.position !== 'fixed' && cs.visibility !== 'hidden' && r.bottom < innerHeight + 4000) max = Math.max(max, r.bottom); });
      return Math.round(nav.getBoundingClientRect().top - Math.min(max, sc.getBoundingClientRect().bottom));
    }) : null;
    const m = await page.evaluate(() => {
      const html = document.documentElement;
      const scoped = html.classList.contains('u2-coach');
      const overflow = html.scrollWidth > html.clientWidth;
      const small = [];
      if (innerWidth < 768) document.querySelectorAll('main a, main button, main input, main select, header a, header button, nav a').forEach((el) => {
        const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
        if (r.width < 43.5 || r.height < 43.5) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14)}:${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      const text = document.body.innerText;
      const forbidden = (text.match(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/g) || []);
      const font = getComputedStyle(document.querySelector('h1') || document.body).fontFamily.split(',')[0];
      const mark = ['지금 바로 시작', '+ 새 클래스', '데이터 현황', '내 클래스', '최근 대화', '새 알림'].filter((t) => text.includes(t));
      const d = !!document.querySelector('.u2c');
      const grp = document.querySelectorAll('[data-settings-group]').length;
      const nav = document.querySelector('.floating-bottom-nav, .u2-nav'); let navCss = null;
      if (nav) { const a = nav.querySelector('a[aria-current="page"]') || nav.querySelector('a'); navCss = { bg: getComputedStyle(nav).backgroundColor, color: a ? getComputedStyle(a).color : null }; }
      return { scoped, overflow, small: small.slice(0, 8), forbidden, font, mark, d, grp, navCss };
    });
    results.push({ width, screen: s.key, navGap: gap, ...m });
  }
  await context.close();
}
{
  const { context, page } = await open(390, true);
  await page.goto(HOST + '/dashboard'); await page.waitForSelector('h1', { timeout: 15000, state: 'attached' }).catch(() => errors.push('reduced: h1 없음'));
  await page.waitForTimeout(800);
  const probe = await page.evaluate(() => Array.from(document.querySelectorAll('html.u2-coach, html.u2-coach *')).filter((el) => { const cs = getComputedStyle(el); return (parseFloat(cs.transitionDuration) > 0.001) || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.001); }).length);
  results.push({ screen: 'reduced-motion', animatedElements: probe });
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(out, 'measure.json'), JSON.stringify({ contrast, results, errors }, null, 2));
const bad = results.filter((r) => r.screen && r.width && ((r.screen === 'player-excluded' ? r.scoped : !r.scoped) || r.overflow || r.small?.length || r.forbidden?.length));
console.log(JSON.stringify({ total: results.length, bad: bad.map((b) => ({ w: b.width, s: b.screen, scoped: b.scoped, overflow: b.overflow, small: b.small, forbidden: b.forbidden })), errors, minContrast: Math.min(...contrast.map((c) => c.ratio)), reduced: results.find((r) => r.screen === 'reduced-motion') }, null, 1));
