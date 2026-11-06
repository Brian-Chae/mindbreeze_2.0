// SDD-318 — D안(UI_V2 on) 5화면 캡처·측정. 서버 없이 빌드 산출물을 Chrome 에 제공하고 모든 API 는 합성 데이터다.
// 사용: node e2e/sdd318-capture.mjs <dist-v2 경로> <출력 디렉터리>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
const HOST = 'https://sdd318.local';
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html', '.json': 'application/json' };

const iso = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();
const user = { id: 'u-1', email: 'client@example.test', name: '합성 회원', role: 'client', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [{ id: 'h-1', name: '가', profile_image: null }] };
const cls = (id, title, status, completed, total, next, mem) => ({ id, title, status, schedule_mode: 'fixed', planned_session_count: total, area: 'meditation', progress: { completed, total }, session_count: total, next_session: next, has_open_session: false, host: { id: 'h-1', name: '가' }, membership: { status: mem } });
const classes = { classes: [
  cls('c1', '저녁의 호흡', 'active', 2, 8, { id: 's3', seq: 3, scheduled_at: iso(6, 19, 30), status: 'scheduled', host: { id: 'h-1', name: '가' } }, 'active'),
  cls('c2', '잠시 머무는 연습', 'ready', 0, 6, { id: 's9', seq: 1, scheduled_at: iso(8, 10, 0), status: 'scheduled', host: { id: 'h-2', name: '나' } }, 'active'),
  cls('c3', '가을의 마음 산책', 'completed', 4, 4, null, 'completed'),
], total: 3 };
const detail = { ...classes.classes[0], location_type: 'online', location_address: null, linkband_mode: 'optional', record_audio: false, capacity: 12, participant_mode: 'open', default_duration_min: 60, host_view: null };
const sess = (id, seq, d, h, st) => ({ id, seq, scheduled_at: iso(d, h, 30), status: st, session_kind: 'meditation', host: { id: 'h-1', name: '가' }, host_state: 'active' });
const sessions = { sessions: [sess('s3', 3, 6, 19, 'scheduled'), sess('s2', 2, 4, 19, 'completed'), sess('s1', 1, 2, 19, 'completed')], total: 3 };
const rep = (id, title, extra) => ({ id, session_id: 's-' + id, user_id: 'u-1', type: 'client', pdf_url: null, sent_at: iso(4, 21, 0), is_read: false, created_at: iso(4, 21, 0), session_title: title, counselor_name: '가', session_type: 'meditation', scheduled_at: iso(4, 19, 30), content: { headline: '호흡에 다시 머문 시간', summary: '떠오른 생각을 알아차리고 호흡으로 돌아오는 연습을 했어요.' }, ...extra });
const reports = { reports: [rep('r1', '저녁의 호흡 · 2회차', {}), rep('r2', '저녁의 호흡 · 1회차', { sent_at: null, in_review: true, content: {} }), rep('r3', '가을의 마음 산책', { is_read: true, counselor_name: '다', content: { headline: '잠시 머문 시간', summary: '몸의 감각에 주의를 기울이며 잠시 머물렀어요.' } })], total: 3 };
const membershipMine = { class_id: 'c1', revision: 1, member: { id: 'm1', user_id: 'u-1', status: 'active', display_name: '합성 회원', waitlist_position: null }, capabilities: { leave: true, waitlist: false }, consents: {}, attendance_summary: { attended: 1, absent: 0, excused: 0, expected: 1 } };
const notifications = { notifications: [{ id: 'n1', type: 'report', title: '리포트가 도착했어요', body: '저녁의 호흡 · 2회차 기록', is_read: false, extra: null, created_at: iso(5, 9, 0) }], total: 1, unread: 1 };

const screens = [
  { key: 'home', url: '/app', waitFor: 'h1' },
  { key: 'classes', url: '/app/classes', waitFor: 'h1' },
  { key: 'class-detail', url: '/app/classes/c1', waitFor: 'h1' },
  { key: 'reports', url: '/app/reports', waitFor: 'h1' },
  { key: 'report-detail', url: '/app/reports?report=r1', waitFor: 'dialog[open] h1' },
];
const widths = [390, 393, 768];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = []; const errors = [];

function lum(hex) { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const contrast = [];
for (const fg of ['#25212C', '#68616F', '#5F0080']) for (const bg of ['#F4F4F7', '#FFFFFF', '#EEE5F5']) contrast.push({ fg, bg, ratio: +ratio(fg, bg).toFixed(2) });
contrast.push({ fg: '#FFFFFF', bg: '#5F0080', ratio: +ratio('#FFFFFF', '#5F0080').toFixed(2) });

for (const width of widths) {
  for (const reduced of [false]) {
    const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : 844 }, serviceWorkers: 'block', deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await context.routeWebSocket('**/*', (s) => s.close());
    await context.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), user);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
      if (url.hostname !== 'sdd318.local') return route.abort('blockedbyclient');
      if (route.request().method() === 'OPTIONS') return json({});
      if (p.startsWith('/api/')) {
        if (p.endsWith('/auth/refresh')) return json({ access_token: 'synthetic', token_type: 'bearer' });
        if (p.endsWith('/auth/users/me')) return json(user);
        if (/\/client\/counselors/.test(p)) return json(user.counselors);
        if (/\/classes\/c1\/me\/membership/.test(p)) return json(membershipMine);
        if (/\/classes\/c1\/me\/attendance/.test(p)) return json({ sessions: [], total: 0 });
        if (/\/classes\/c1\/sessions/.test(p)) return json(sessions);
        if (/\/classes\/c1\/?$/.test(p)) return json(detail);
        if (/\/classes\/?$/.test(p)) return json(classes);
        if (/\/counseling/.test(p)) return json({ relationships: [], total: 0 });
        if (/\/reports\/counts/.test(p)) return json({ unread: 1 });
        if (/\/reports\/r1$/.test(p)) return json(reports.reports[0]);
        if (/\/reports\/?$/.test(p)) return json(reports);
        if (/\/notifications\/unread-count/.test(p)) return json({ unread: 1 });
        if (/\/notifications/.test(p)) return json(notifications);
        if (/\/chat\/rooms/.test(p)) return json({ rooms: [], total: 0 });
        if (/\/sessions\/?$/.test(p)) return json({ sessions: [], total: 0 });
        return json({}, 200);
      }
      const asset = path.join(dist, p);
      const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(dist, 'index.html');
      return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    for (const s of screens) {
      await page.goto(HOST + s.url, { waitUntil: 'load' });
      await page.waitForSelector(s.waitFor, { timeout: 15000 }).catch(() => errors.push(`${width}/${s.key}: ${s.waitFor} 없음`));
      await page.waitForTimeout(900);
      const file = path.join(out, `${s.key}-${width}.png`);
      await page.screenshot({ path: file });
      // 스크롤 끝 캡처 + 측정
      const m = await page.evaluate(() => {
        const root = document.querySelector('dialog[open] .u2-sheet-scroll') || document.querySelector('.u2-scroll');
        const isUi = !!document.querySelector('.ui-v2');
        const doc = document.documentElement;
        const overflow = doc.scrollWidth > doc.clientWidth || (root && root.scrollWidth > root.clientWidth);
        const small = [];
        const scope = document.querySelector('dialog[open]') || document;
        scope.querySelectorAll('.ui-v2 a, .ui-v2 button, .ui-v2 input, .ui-v2 select, .ui-v2 [role=tab]').forEach((el) => {
          const target = el.matches('input[type=checkbox],input[type=radio]') ? (el.closest('label') || el) : el;
          const r = target.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.width < 43.5 || r.height < 43.5) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14)}:${Math.round(r.width)}x${Math.round(r.height)}`);
        });
        const offenders = [];
        const limit = (document.querySelector('dialog[open] .u2-sheet-scroll') || root || doc).clientWidth;
        (document.querySelector('dialog[open]') || document).querySelectorAll('.ui-v2 *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > limit + 1 && !el.closest('svg')) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}:${Math.round(r.right)}>${limit}`);
        });
        const h1 = document.querySelector('dialog[open] h1, .ui-v2 h1');
        const h1Clipped = h1 ? h1.scrollWidth > h1.clientWidth + 1 : null;
        const text = (document.querySelector('dialog[open]') || document.body).innerText;
        const forbidden = (text.match(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/g) || []);
        if (root) root.scrollTop = root.scrollHeight;
        const nav = document.querySelector('.u2-nav');
        let hidden = false; let gap = null;
        if (nav && getComputedStyle(nav.parentElement).display !== 'none' && root && !document.querySelector('dialog[open]')) {
          const navTop = nav.getBoundingClientRect().top;
          const kids = Array.from(root.querySelectorAll('main > *, main section, main a, main p'));
          const bottoms = kids.map((k) => k.getBoundingClientRect().bottom).filter((b) => b > 0);
          const lastBottom = Math.max(...bottoms, 0);
          gap = Math.round(navTop - lastBottom);
          hidden = lastBottom > navTop + 1;
        }
        return { offenders: offenders.slice(0, 6), isUi, overflow: !!overflow, small, h1Clipped, forbidden, hidden, gap, navPresent: !!nav };
      });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(out, `${s.key}-${width}-bottom.png`) });
      results.push({ width, screen: s.key, ...m });
    }
    await context.close();
  }
}
// prefers-reduced-motion: reduce 검사
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', (s) => s.close());
  await context.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), user);
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname;
    const json = (b) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(b) });
    if (url.hostname !== 'sdd318.local') return route.abort();
    if (route.request().method() === 'OPTIONS') return json({});
    if (p.startsWith('/api/')) { if (/client\/counselors/.test(p)) return json(user.counselors); if (p.endsWith('/auth/refresh')) return json({ access_token: 's', token_type: 'bearer' }); if (p.endsWith('/auth/users/me')) return json(user); if (/\/classes\/?$/.test(p)) return json(classes); if (/counseling/.test(p)) return json({ relationships: [], total: 0 }); return json({}); }
    const asset = path.join(dist, p); const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(dist, 'index.html');
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto(HOST + '/app/classes'); await page.waitForSelector('.ui-v2 h1', { timeout: 15000 }).catch(() => errors.push('reduced: h1 없음'));
  const probe = await page.evaluate(() => Array.from(document.querySelectorAll('.ui-v2, .ui-v2 *')).filter((el) => { const cs = getComputedStyle(el); return (parseFloat(cs.transitionDuration) > 0.001 && cs.transitionDuration !== '0s') || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.001); }).length);
  results.push({ screen: 'reduced-motion', animatedElements: probe });
  await context.close();
}
await browser.close();
const summary = { contrast, results, errors };
fs.writeFileSync(path.join(out, 'measure.json'), JSON.stringify(summary, null, 2));
const bad = results.filter((r) => r.screen && r.width && (!r.isUi || r.overflow || r.small?.length || r.h1Clipped || r.forbidden?.length || r.hidden));
console.log(JSON.stringify({ total: results.length, bad: bad.map((b) => ({ w: b.width, s: b.screen, isUi: b.isUi, overflow: b.overflow, small: b.small, h1Clipped: b.h1Clipped, forbidden: b.forbidden, hidden: b.hidden, gap: b.gap })), errors, minContrast: Math.min(...contrast.map((c) => c.ratio)) }, null, 1));
