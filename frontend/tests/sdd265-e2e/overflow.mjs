// SDD-265: 390px/1440px 가로 넘침·화면 높이 실측 (playwright-core, mock 응답 fixture — 서버 접근 없음)
// 실행: (frontend/) node_modules/.bin/vite --port 5443 --host 127.0.0.1 &  → node tests/sdd265-e2e/overflow.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5443';
const OUT = process.env.OUT ?? `${process.env.TMPDIR ?? '/tmp'}/sdd265-shots`;
mkdirSync(OUT, { recursive: true });

const r = (e, v, p) => ({ expected: e, received: v, percent: p });
const prog = (o = {}) => ({ participants: { total: 40, counted: 38, all_received: 31, in_progress: 4, needs_attention: 2, expected_unknown: 1, not_collected: 2, ...o }, feature: r(48000, 47100, 98.1), raw: { eeg: r(3200, 3150, 98.4), ppg: r(1600, 1600, 100), acc: r(1600, 1590, 99.3) }, overall: r(54400, 53440, 98.2) });
const names = ['저녁 마음챙김', '호흡 명상', '아침 마음챙김'];
const item = (i) => {
  const warn = i < 2; const live = i === 2;
  return {
    class_id: 'c1', class_title: names[i % 3], session_id: `s${i}`, seq: 10 - i, session_status: live ? 'in_progress' : 'completed', organization_name: '마인드브리즈 심리상담 연구소 강남센터', host_name: '김코치',
    started_at: new Date(Date.now() - i * 86400000).toISOString(), band_not_connected: 1, last_received_at: new Date().toISOString(),
    participants: 40, needs_attention: warn ? 2 : 0, uploading: 0, received_unreconciled: 30, no_data: 0, excluded: 2, status: warn ? 'needs_attention' : 'received_unreconciled',
    participants_expected: 38, participants_arrived: warn ? 36 : 38, bytes_arrived: 1_180_000_000, bytes_expected: 1_250_000_000, bytes_basis: 'estimate', duration_min: 52, participant_minutes_total: 2082,
    progress: prog(warn ? {} : { needs_attention: 0, all_received: live ? 20 : 38, in_progress: live ? 18 : 0, expected_unknown: 0 }),
  };
};
const overview = { as_of: new Date().toISOString(), poll_interval_sec: 60, etag: 'W/"o"', total_candidates: 23, truncated: true, next_cursor: 'C1', has_more: true, scan_limited: false, items: Array.from({ length: 10 }, (_, i) => item(i)) };

const person = (i, state, extra = {}) => ({
  participant_id: `p${i}`, display_name: `참여자 ${String(i).padStart(2, '0')}`, is_guest: false, participation_status: 'active', collection_state: state === 'not_collected' ? 'excluded' : 'eligible', band_connected: true, report_included: true,
  feature: { received: 100, legacy_count: 0, internal_missing: 0, expected: 100, expected_basis: 'phone_report', completeness: 'all_received', last_received_at: new Date().toISOString() },
  raw: { signals: ['eeg', 'ppg', 'acc'].map((t) => ({ signal_type: t, registered: 5, uploaded: 5, pending: 0, failed: 0, internal_missing: 0, oldest_pending_at: null, expected: 5 })), last_received_at: new Date().toISOString(), completeness: 'all_received' },
  phone_report: null, status: state === 'needs_attention' ? 'needs_attention' : 'received_unreconciled', reasons: [],
  bytes_arrived: 31_000_000, measured_min: 51,
  progress: { state, feature: r(100, state === 'needs_attention' ? 97 : 100, 100), raw: { eeg: r(5, 5, 100), ppg: r(5, 5, 100), acc: r(5, state === 'needs_attention' ? 3 : 5, 100) }, total: r(115, 113, 98) },
  ...extra,
});
const people = [...[37, 38].map((i) => person(i, 'needs_attention')), ...Array.from({ length: 36 }, (_, i) => person(i + 1, 'all_received')), person(39, 'expected_unknown'), person(40, 'not_collected')];
const detail = {
  class_id: 'c1', session_id: 's0', session_status: 'completed', as_of: new Date().toISOString(), basis: 'server_received', poll_interval_sec: 60, etag: 'W/"d"',
  summary: { participants: 40, needs_attention: 2, uploading: 0, received_unreconciled: 36, no_data: 1, excluded: 1 }, participants: people, progress: prog(),
  participants_expected: 38, participants_arrived: 36, bytes_arrived: 1_180_000_000, bytes_expected: 1_250_000_000, bytes_basis: 'estimate', duration_min: 52, participant_minutes_total: 2082,
};
const mine = {
  as_of: new Date().toISOString(), basis: 'server_received', poll_interval_sec: 60, etag: 'W/"m"', total_candidates: 23, next_cursor: 'M1', has_more: true,
  items: Array.from({ length: 10 }, (_, i) => ({
    session_id: `m${i}`, class_id: 'c1', class_title: names[i % 3], seq: 10 - i, organization_name: '기관', session_status: 'completed', started_at: new Date(Date.now() - i * 86400000).toISOString(), ended_at: null,
    status: i === 0 ? 'received_unreconciled' : 'received_unreconciled', collection_state: 'eligible', progress_state: i === 0 ? 'in_progress' : 'all_received', percent: i === 0 ? 87.4 : 100,
    bytes_arrived: 27_000_000, bytes_expected: 31_000_000, duration_min: 52, measured_min: 51, last_received_at: new Date().toISOString(),
  })),
};

async function install(page, role) {
  await page.route(/\/api\/v1\//, async (route) => {
    const u = new URL(route.request().url()); const p = u.pathname;
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS', 'access-control-expose-headers': 'ETag, X-Poll-Interval' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) });
    if (p.endsWith('/auth/refresh')) return json({ access_token: 'qa', token_type: 'bearer' });
    if (p.endsWith('/upload-status/overview')) return json(overview);
    if (p.endsWith('/upload-status/me/sessions')) return json(mine);
    if (/\/sessions\/[^/]+\/upload-status$/.test(p)) return json(detail);
    return json({ items: [], total: 0, classes: [], sessions: [], relationships: [], rooms: [], notifications: [], invites: [], unread: 0, count: 0 });
  });
  await page.goto(`${BASE}/`);
  await page.evaluate((u) => localStorage.setItem('mb_user', JSON.stringify(u)), { id: 'u1', role, name: '테스터', email: 'qa@test.com', onboarding_completed: true, is_verified: true });
}

const cases = [
  { id: 'coach-list', role: 'counselor', path: '/upload-status' },
  { id: 'coach-detail', role: 'counselor', path: '/classes/c1/sessions/s0/upload-status', open: ['[data-testid="group-arrived"] summary', '[data-testid="group-waiting"] summary'] },
  { id: 'member', role: 'client', path: '/app/profile/upload-status' },
];
const results = [];
const browser = await chromium.launch();
for (const w of [390, 1440]) {
  for (const c of cases) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await install(page, c.role);
    await page.goto(`${BASE}${c.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    // 앱 셸은 내부 스크롤 영역에서 스크롤되므로 문서와 모든 스크롤 영역의 가로·세로 크기를 함께 잰다.
    const measure = () => page.evaluate(() => {
      const de = document.documentElement; const over = [];
      const scrollers = [de, ...[...document.querySelectorAll('*')].filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)];
      const maxH = Math.max(...scrollers.map((e) => e.scrollHeight));
      const maxOverW = Math.max(0, ...[de, ...scrollers].map((e) => e.scrollWidth - e.clientWidth));
      for (const el of document.querySelectorAll('body *')) { const b = el.getBoundingClientRect(); if (b.width > 0 && b.right > de.clientWidth + 1 && getComputedStyle(el).position !== 'fixed') over.push(`${el.tagName}.${String(el.className).slice(0, 40)}:${Math.round(b.right)}`); }
      return { scrollWidth: de.clientWidth + maxOverW, clientWidth: de.clientWidth, scrollHeight: maxH, over: over.slice(0, 5), text: document.body.innerText };
    });
    const m = await measure();
    if (process.env.BREAKDOWN && c.id === 'coach-list') console.log('BREAK', w, JSON.stringify(await page.evaluate(() => { const sc = document.querySelector('.mobile-menu-swipe-page'); const root = sc ?? document.body; const out = []; const walk = (el, d) => { for (const ch of el.children) { const h = Math.round(ch.getBoundingClientRect().height); if (h > 40 && d < 4) out.push('  '.repeat(d) + ch.tagName + '.' + String(ch.className).slice(0, 30) + (ch.getAttribute('data-testid') ? '#' + ch.getAttribute('data-testid') : '') + ' ' + h); if (d < 3) walk(ch, d + 1); } }; walk(root, 0); return out.slice(0, 45); }), null, 0));
    let expanded = null;
    if (c.open) { for (const sel of c.open) await page.locator(sel).first().click().catch(() => undefined); await page.waitForTimeout(200); expanded = await measure(); }
    await page.screenshot({ path: `${OUT}/${c.id}-${w}.png` });
    const text = (expanded ?? m).text;
    const banned = (text.match(/feature|원시|\braw\b|EEG|PPG|ACC|업로드|수신|종합점수|점수|좋음|나쁨|보증|완료/gi) ?? []);
    results.push({ rows: (await page.locator('[data-testid="overview-row"], [data-testid="upload-row"], [data-testid="my-upload-status"]').count()), head: text.replace(/\s+/g, ' ').slice(120, 260), screen: c.id, width: w, overflowPx: Math.max(0, m.scrollWidth - m.clientWidth), expandedOverflowPx: expanded ? Math.max(0, expanded.scrollWidth - expanded.clientWidth) : null, height: m.scrollHeight, overElements: (expanded ?? m).over, bannedWords: [...new Set(banned)], pageErrors: errors });
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/qa.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
