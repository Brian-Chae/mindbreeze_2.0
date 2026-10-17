import { launch, makePages, shootAll, forEachPage, closeAll, apiLogin, authH, API, BASE } from './lib.mjs';
const cou = await apiLogin(process.env.MB_COUNSELOR_EMAIL, process.env.MB_COUNSELOR_PW);
const list = await (await fetch(`${API}/sessions`, { headers: authH(cou.access_token) })).json();
const closed = list.sessions.find((s) => s.status === 'completed' && s.access_code);
const CODE_B = process.env.CODE_B;
const browser = await launch();
const guests = await makePages(browser, { login: false });
const members = await makePages(browser, { login: true });

await forEachPage(guests, (page) => page.goto(`${BASE}/join`, { waitUntil: 'networkidle' }));
await shootAll('S-M07', guests, { full: true });

await forEachPage(guests, async (page) => {
  await page.fill('#class-code', 'ZZZZZZ');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]');
});
await shootAll('S-M08', guests);

await forEachPage(guests, (page) => page.goto(`${BASE}/join?code=${CODE_B}`, { waitUntil: 'networkidle' }));
await shootAll('S-M09', guests, { full: true });

await forEachPage(members, (page) => page.goto(`${BASE}/join?code=${CODE_B}`, { waitUntil: 'networkidle' }));
await shootAll('S-M10', members, { full: true });

if (closed) {
  await forEachPage(guests, (page) => page.goto(`${BASE}/join?code=${closed.access_code}`, { waitUntil: 'networkidle' }));
  await shootAll('S-M22', guests);
}
await closeAll(browser, guests); await closeAll(browser, members).catch(() => {});
