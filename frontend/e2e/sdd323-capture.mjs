// SDD-323 — 기관 구성원 화면 캡처·실측. 빌드 산출물(VITE_UI_V2=true)을 Chrome 에 제공하고 모든 API 는 plan §2 계약을 흉내 낸 합성 응답이다.
// 사용: node e2e/sdd323-capture.mjs <dist 경로> <출력 디렉터리> [primary|admin]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
const viewer = process.argv[4] === 'admin' ? 'admin' : 'primary';
fs.mkdirSync(out, { recursive: true });
const HOST = 'https://sdd323.local';
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html', '.json': 'application/json' };
const iso = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();

const me = { id: viewer === 'primary' ? 'a1' : 'a2', email: 'admin@example.test', name: viewer === 'primary' ? '윤서윤' : '정민서', role: 'org_admin', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'email', counselors: [] };
const dashboard = { org_id: 'org-1', org_name: '예시 마음센터', org_code: 'MS2026', total_counselors: 3, total_classes: 12, total_participants: 40, total_members: 47, completed_classes: 7, in_progress_classes: 2, counselors: [], classes: [] };
const base = (id, name, over = {}) => ({ id, name, email: `${id}@example.test`, role: 'counselor', status: 'active', membership_status: 'active', account_status: 'active', is_primary_admin: false, is_self: false, class_count: 0, last_activity_at: null, has_personal_office: false, counselor_code: 'CD' + id.toUpperCase(), allowed_actions: [], blocked_reasons: {}, ...over });
const rows = () => {
  const primary = viewer === 'primary';
  const coachActs = ['detail', 'edit_profile', 'resend_invite', 'remove', ...(primary ? ['promote'] : [])].filter((a) => a !== 'resend_invite');
  return [
    base('k1', '김하늘', { class_count: 3, last_activity_at: iso(9, 9, 20), has_personal_office: true, allowed_actions: coachActs }),
    base('k2', '이도윤', { class_count: 2, last_activity_at: iso(8, 14, 0), allowed_actions: coachActs }),
    base('k3', '박지안', { class_count: 1, last_activity_at: iso(7, 10, 0), allowed_actions: coachActs }),
    base('k4', '최시우', { class_count: 0, last_activity_at: null, allowed_actions: coachActs }),
    base('a1', '윤서윤', { role: 'org_admin', is_primary_admin: true, is_self: primary, allowed_actions: ['detail'] }),
    base('a2', '정민서', { role: 'org_admin', is_self: !primary, allowed_actions: primary ? ['detail', 'revoke_admin', 'transfer_primary', 'remove'] : ['detail'] }),
    base('i1', '한서아', { status: 'pending', membership_status: 'invited', account_status: 'pending', invite_type: 'new_account', invited_at: iso(1, 9, 0), invite_expires_at: '2999-11-16T00:00:00Z', allowed_actions: ['resend_invite'] }),
    base('i2', '오지호', { role: 'org_admin', status: 'pending', membership_status: 'invited', account_status: 'pending', invite_type: 'org_membership', invited_at: iso(1, 9, 0), invite_expires_at: iso(2, 9, 0), allowed_actions: ['resend_invite'] }),
    base('i3', '이도윤', { invite_type: 'new_account', invited_at: iso(1, 9, 0), allowed_actions: ['detail'], id: 'k2' }),
  ];
};
const requests = [
  { id: 'q1', org_id: 'org-1', org_name: '예시 마음센터', status: 'pending', reason: null, created_at: iso(9, 10, 30), applicant_name: '문유진', applicant_email: 'yujin@example.test' },
  { id: 'q2', org_id: 'org-1', org_name: '예시 마음센터', status: 'rejected', reason: '서류 미비', created_at: iso(3, 10, 0), applicant_name: '송민', applicant_email: 'min@example.test', handled_at: iso(4, 9, 0) },
];
const activity = { sessions: [{ id: 's1', title: '아침 마음챙김', type: 'meditation', status: 'in_progress', scheduled_at: null, started_at: iso(9, 9, 20), participant_count: 5 }, { id: 's2', title: '호흡과 휴식', type: 'meditation', status: 'scheduled', scheduled_at: iso(10, 14, 0), started_at: null, participant_count: 4 }], reports: [], classes: [{ id: 'c1', name: '아침 마음챙김', status: 'open', member_count: 5 }, { id: 'c2', name: '주말 호흡 명상', status: 'scheduled', member_count: 4 }], client_count: 12 };
const profile = { id: 'k1', email: 'k1@example.test', name: '김하늘', role: 'counselor', status: 'active', org_id: 'org-1', org_name: '예시 마음센터', counselor_code: 'CDK1', phone: '010-0000-0000', profile_image: null, bio: null, gender: 'female', birth_date: '1990-01-02', postal_code: '12345', address_line1: '대전', address_line2: '101호', affiliation_type: null, years_of_experience: 5, specialties: [], qualifications: [], careers: [], version: 1 };

const screens = [
  { key: 'coaches', url: '/counselors', waitFor: '.u2m-tabs' },
  { key: 'admins', url: '/counselors?tab=admins', waitFor: '.u2m-tabs' },
  { key: 'invites', url: '/counselors?tab=invites', waitFor: '.u2m-tabs' },
  { key: 'requests', url: '/counselors?tab=requests', waitFor: '.u2m-tabs' },
  { key: 'detail', url: '/counselors?member=k1', waitFor: '[role=dialog]', wait: 800 },
  { key: 'revoke', url: '/counselors?tab=admins', waitFor: '.u2m-tabs', act: async (p) => { await p.getByRole('button', { name: '정민서 권한 회수' }).first().click(); await p.waitForSelector('[role=dialog]'); } },
  { key: 'transfer', url: '/counselors?tab=admins', waitFor: '.u2m-tabs', act: async (p) => { await p.getByRole('button', { name: '정민서 대표 지정' }).first().click(); await p.waitForSelector('[role=dialog]'); } },
  { key: 'invite-form', url: '/counselors', waitFor: '.u2m-tabs', act: async (p) => { await p.locator('button[data-header-action=primary]:visible').first().click(); await p.waitForSelector('[role=dialog]'); } },
  { key: 'dashboard', url: '/dashboard/org', waitFor: '.u2m-summary' },
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const widths = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [1440, 390];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = []; const errors = [];
for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: width >= 1440 ? 900 : 844 }, serviceWorkers: 'block', deviceScaleFactor: 2 });
  await context.routeWebSocket('**/*', (s) => s.close());
  await context.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), me);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(`${width} console: ${m.text().slice(0, 160)}`); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
    if (url.hostname !== 'sdd323.local') return route.abort('blockedbyclient');
    if (route.request().method() === 'OPTIONS') return json({});
    if (p.startsWith('/api/')) {
      if (p.endsWith('/auth/refresh')) return json({ access_token: 'synthetic', token_type: 'bearer' });
      if (p.endsWith('/auth/users/me')) return json(me);
      if (/\/dashboard\/org$/.test(p)) return json(dashboard);
      if (/\/org\/org-1\/requests$/.test(p)) return json(requests);
      if (/\/org\/org-1\/counselors\/[^/]+\/profile$/.test(p)) return json(profile);
      if (/\/org\/org-1\/counselors\/[^/]+\/activity$/.test(p)) return json(activity);
      if (/\/org\/org-1\/counselors$/.test(p)) return json(rows().filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i));
      if (/\/reports\/counts/.test(p)) return json({ unread: 0, pending_review: 2 });
      if (/\/notifications\/unread-count/.test(p)) return json({ unread: 2 });
      if (/\/notifications/.test(p)) return json({ notifications: [], total: 0, unread: 2 });
      if (/\/chat\/rooms/.test(p)) return json({ rooms: [], total: 0 });
      return json({}, 200);
    }
    const asset = path.join(dist, p);
    const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(dist, 'index.html');
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  for (const s of screens.filter((x) => !ONLY || ONLY.includes(x.key))) {
    await page.goto(HOST + s.url, { waitUntil: 'load' });
    await page.waitForSelector(s.waitFor, { timeout: 8000 }).catch(async () => errors.push(`${width}/${s.key}: ${s.waitFor} 없음 :: ${(await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)}`));
    await page.waitForTimeout(s.wait ?? 600);
    if (s.act) await s.act(page).catch((e) => errors.push(`${width}/${s.key}: act ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `impl-${viewer === 'admin' ? 'plain-' : ''}${s.key}-${width}.png`), fullPage: false });
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const scroller = document.querySelector('.u2-scroll') || doc;
      const docOverflow = doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > document.body.clientWidth || scroller.scrollWidth > scroller.clientWidth;
      const small = [];
      document.querySelectorAll('.ui-v2 a, .ui-v2 button, .ui-v2 input:not([type=checkbox]):not([type=radio]), .ui-v2 select, .ui-v2 textarea').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest('.sr-only, .u2m-sr')) return;
        if (r.width < 43.5 || r.height < 43.5) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14)}:${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      const h1 = document.querySelector('.ui-v2 h1, header h1, h1');
      const forbidden = (document.body.innerText.match(/점수|종합점수|좋음|나쁨|보증|100\s*%|정지|재활성|비활성화/g) || []);
      const chips = [...document.querySelectorAll('.u2-pill')].filter((c) => c.getBoundingClientRect().height > 40).length;
      const visibleTable = !!document.querySelector('.u2m-table') && getComputedStyle(document.querySelector('.u2m-table')).display !== 'none';
      const visibleCards = !!document.querySelector('.u2m-cards') && getComputedStyle(document.querySelector('.u2m-cards')).display !== 'none';
      const side = document.querySelector('aside');
      return { docOverflow, small, h1: h1 ? { text: h1.textContent, size: getComputedStyle(h1).fontSize } : null, forbidden, wrappedChips: chips, visibleTable, visibleCards, sidebarW: side ? Math.round(side.getBoundingClientRect().width) : null, bg: getComputedStyle(document.body).backgroundColor };
    });
    results.push({ width, screen: s.key, ...m });
  }
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(out, `impl-metrics${viewer === 'admin' ? '-plain' : ''}.json`), JSON.stringify({ results, errors }, null, 2));
const bad = results.filter((r) => r.docOverflow || r.forbidden.length || r.wrappedChips);
console.log(JSON.stringify({ screens: results.length, errors, overflowOrForbidden: bad.map((r) => `${r.width}/${r.screen}`), smallTargets: results.filter((r) => r.small.length).map((r) => `${r.width}/${r.screen}: ${r.small.slice(0, 4).join(' | ')}`) }, null, 1));
