// SDD-318 F-E 캡처 — 5181 미리보기에서 회원 리포트 상세 시트를 390·1440 으로 캡처한다.
// /api/v1 요청은 전부 합성 응답으로 가로채며 실제 네트워크로 나가지 않는다(GET 외 요청도 합성 응답, 백엔드 쓰기 0).
import { chromium } from '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-preview318/frontend/node_modules/playwright/index.mjs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = (n) => fileURLToPath(new URL(n, import.meta.url));
const BASE = 'http://localhost:5181';
const user = { id: 'u-client', email: 'synthetic@example.test', name: '예시 회원', role: 'client', verified_tier: 'basic', onboarding_completed: true, auth_provider: 'email', counselors: [{ id: 'c-1', name: '예시 코치', profile_image: null, status: 'active' }], profile_prompt_dismissed: true };

// 20분, 30초 간격. 5~6분 구간은 측정 없음(빈 칸 확인용).
const timeline = Array.from({ length: 40 }, (_, i) => ({
  min: i * 0.5,
  concentration: 40 + i * 0.6 + (i % 3), relaxation: 34 + i * 0.75, stress: 0.55 - i * 0.004,
  heart_rate: 80 - i * 0.18, respiratory_rate: 17 - i * 0.085, sdnn: 38 + i * 0.5 + (i % 4),
})).filter((p) => !(p.min >= 5 && p.min < 6));

const base = {
  user_id: 'u-client', type: 'client', pdf_url: null, sent_at: '2026-11-09T10:00:00', is_read: false, created_at: '2026-11-09T10:00:00',
  session_title: '저녁의 호흡 · 2회차', session_type: 'meditation', scheduled_at: '2026-11-09T19:30:00', counselor_name: '예시 코치', status: 'sent',
};
const worn = { ...base, id: 'r-worn', session_id: 's-worn', content: {
  headline: '호흡에 다시 머문 시간', summary: '주변 소리에 관심이 향했던 경험과 호흡으로 돌아온 순간을 나눴어요. 마지막에는 어깨와 손의 감각을 돌아봤어요.',
  insights: ['호흡을 세는 과정이 관심을 다시 돌리는 계기가 되었다고 이야기했어요.'],
  counselor_comment: '생각을 없애려 하기보다, 떠오른 생각을 알아차리고 다시 돌아오는 시간을 함께 가졌어요. 다음 만남에서도 자신의 속도로 호흡을 살펴봐요.',
  quote: '생각이 떠오를 때마다 알아차리고, 다시 호흡으로 돌아왔어요.', duration_min: 20,
  eeg: { status: 'valid', score: 70, metrics: {}, timeline, narrative: {
    journey: '몸은 점차 이완으로, 마음은 차분한 안정으로 흘렀습니다.',
    closing: '오늘의 작은 쉼을 마음에 담고, 내일의 나에게도 같은 여유를 허락해 보세요.',
    body: '시간이 흐르면서 호흡수와 심박수는 내려가고, 심박변이는 올라갔어요.', mind: '생각이 떠오른 순간을 알아차리고, 다시 호흡으로 돌아왔어요.',
  } },
} };
const unworn = { ...base, id: 'r-unworn', session_id: 's-unworn', content: {
  headline: '호흡에 다시 머문 시간', summary: worn.content.summary, insights: worn.content.insights, counselor_comment: worn.content.counselor_comment, quote: worn.content.quote,
  eeg: { status: 'not_measured', score: null, metrics: {}, timeline: [] },
} };
const reports = { 'r-worn': worn, 'r-unworn': unworn };

async function run(browser, { w, h, kind }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; const blocked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((u) => { localStorage.setItem('mb_user', JSON.stringify(u)); localStorage.setItem('mb_consent_done', '1'); }, user);
  await page.route(/\/api\/v1\//, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname.replace(/^.*\/api\/v1/, '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET' && p !== '/auth/refresh') { blocked.push(`${req.method()} ${p}`); return json({ ok: true }); }
    if (p === '/auth/refresh') return json({ access_token: 'synthetic-token', token_type: 'bearer' });
    if (p === '/auth/users/me') return json(user);
    if (p === '/chat/rooms') return json({ rooms: [], total: 0 });
    if (p === '/client/counselors') return json(user.counselors);
    if (p === '/reports/counts') return json({ unread: 1, pending_review: 0 });
    const m = p.match(/^\/reports\/([^/]+)$/);
    if (m && reports[m[1]]) return json(reports[m[1]]);
    if (p === '/reports') return json({ reports: Object.values(reports), total: 2 });
    return json({ items: [], rooms: [], notifications: [], total: 0, unread: 0 }, 200);
  });
  await page.goto(`${BASE}/app/reports?report=${kind === 'unworn' ? 'r-unworn' : 'r-worn'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.waitForSelector('[data-testid="ui-v2-report-body"]', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  // 시트 스크롤 영역을 전체 높이로 펼쳐 풀 캡처한다.
  const info = await page.evaluate(() => {
    const sc = document.querySelector('.u2-sheet-scroll'); const dlg = document.querySelector('dialog.u2-sheet-dialog');
    const body = document.querySelector('[data-testid="ui-v2-report-body"]');
    const overflow = body.scrollWidth - body.clientWidth;
    const order = [...document.querySelectorAll('[data-section]')].map((n) => n.getAttribute('data-section'));
    const bars = document.querySelectorAll('.u2r3-bar').length; const empties = document.querySelectorAll('[data-empty="true"]').length;
    const boxes = [...document.querySelectorAll('[data-testid="change-box"]')].map((n) => n.textContent);
    const captions = [...document.querySelectorAll('.u2r3-caption')].map((n) => n.textContent);
    const slots = [...document.querySelectorAll('.u2r3-plot')].map((n) => n.children.length);
    return { scrollH: sc.scrollHeight, overflow, order, bars, empties, boxes, captions, slots, text: body.innerText };
  });
  await page.setViewportSize({ width: w, height: Math.min(Math.max(info.scrollH + 120, h), 9000) });
  await page.waitForTimeout(500);
  const full = out(`${kind}-report-v3-${w}.png`);
  await page.locator('dialog.u2-sheet-dialog').screenshot({ path: full });
  await page.setViewportSize({ width: w, height: h });
  await ctx.close();
  return { w, kind, ...info, text: undefined, errors, blocked, banned: (info.text.match(/점수|좋아졌|나빠졌|주의가 필요|불안정|안정적으로|산만했|긴장이 남|PDF|다운로드|증가|감소/g) ?? []) };
}

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
for (const kind of ['worn', 'unworn']) for (const w of [390, 1440]) results.push(await run(browser, { w, h: w === 390 ? 844 : 900, kind }));
await browser.close();
await writeFile(out('meta-fe.json'), JSON.stringify({ synthetic: true, note: '실제 dev 리포트가 아닌 합성 API(route 가로채기) 캡처. 백엔드 호출 없음.', results }, null, 2));
console.log(JSON.stringify(results, null, 1));
