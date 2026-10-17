import { launch, makePages, shootAll, forEachPage, closeAll, apiLogin, authH, API, BASE } from './lib.mjs';
const mem = await apiLogin(process.env.MB_CLIENT_EMAIL, process.env.MB_CLIENT_PW);
const list = await (await fetch(`${API}/sessions`, { headers: authH(mem.access_token) })).json();
const byTitle = (t) => list.sessions.find((s) => s.title === t);
const SID_A = process.env.SID_A;
const done = list.sessions.find((s) => s.status === 'completed' && s.title === 'E2E 검증 클래스 1006');
const canc = list.sessions.find((s) => s.status === 'cancelled');
const browser = await launch();
const pages = await makePages(browser, { login: true });

// S-M00: 상담사 미연결 회원 (counselors API 를 빈 배열로 모킹 — 재현 불가 상태)
await forEachPage(pages, async (page) => {
  await page.route('**/api/v1/client/counselors', (r) => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue());
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
});
await shootAll('S-M00', pages);
await forEachPage(pages, async (page) => { await page.unroute('**/api/v1/client/counselors'); });

await forEachPage(pages, (page) => page.goto(`${BASE}/app`, { waitUntil: 'networkidle' }));
await shootAll('S-M01', pages);

await forEachPage(pages, (page) => page.goto(`${BASE}/app/sessions`, { waitUntil: 'networkidle' }));
await shootAll('S-M02', pages);

// S-M20: 세션 신청 모달
await forEachPage(pages, async (page, name) => {
  await page.getByRole('button', { name: '세션 신청하기' }).first().click();
  await page.waitForSelector('[role=dialog]');
});
await shootAll('S-M20', pages);
await forEachPage(pages, async (page) => { await page.keyboard.press('Escape'); });

await forEachPage(pages, (page) => page.goto(`${BASE}/app/sessions/${SID_A}`, { waitUntil: 'networkidle' }));
await shootAll('S-M03', pages);

await forEachPage(pages, (page) => page.goto(`${BASE}/app/sessions/${done.id}`, { waitUntil: 'networkidle' }));
await shootAll('S-M05', pages);
await forEachPage(pages, (page) => page.goto(`${BASE}/app/sessions/${canc.id}`, { waitUntil: 'networkidle' }));
await shootAll('S-M06', pages);
await closeAll(browser, pages);
