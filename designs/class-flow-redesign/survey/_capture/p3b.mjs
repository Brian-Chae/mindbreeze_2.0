import { launch, makePages, shootAll, forEachPage, closeAll, BASE } from './lib.mjs';
const CODE_A = process.env.CODE_A, CODE_B = process.env.CODE_B;
// 마이크 거부: fake 미디어 플래그 없이 실행(헤드리스에서 권한 프롬프트는 자동 거부)
const b1 = await launch({ fakeMedia: false });
const m1 = await makePages(b1, { login: true });
await forEachPage(m1, async (page) => {
  await page.goto(`${BASE}/join?code=${CODE_A}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[role=tablist]', { timeout: 30000 });
  await page.click('#preparation-tab-2');
  await page.waitForTimeout(2500);
});
await shootAll('S-M14', m1, { full: true });
await closeAll(b1, m1);

// 오프라인·1:1 클래스(B) 대기실 — BGM 없음
const b2 = await launch({ fakeMedia: true });
const m2 = await makePages(b2, { login: true });
await forEachPage(m2, async (page) => {
  await page.goto(`${BASE}/join?code=${CODE_B}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[role=tablist]', { timeout: 30000 });
});
await shootAll('S-M23', m2, { full: true, settle: 2000 });
await closeAll(b2, m2);
