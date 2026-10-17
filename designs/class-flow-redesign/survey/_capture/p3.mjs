import { launch, makePages, shootAll, forEachPage, closeAll, BASE } from './lib.mjs';
const SID_A = process.env.SID_A, CODE_A = process.env.CODE_A, CODE_B = process.env.CODE_B;
const browser = await launch({ fakeMedia: true });
const members = await makePages(browser, { login: true });

await forEachPage(members, (page) => page.goto(`${BASE}/app/sessions/${SID_A}`, { waitUntil: 'networkidle' }));
await shootAll('S-M04', members);

// 세션 상세 → 입장 버튼 클릭 (실제 경로)
await forEachPage(members, async (page) => {
  await page.getByRole('button', { name: '세션 입장하기' }).click();
  await page.waitForSelector('[role=tablist]', { timeout: 30000 });
});
await shootAll('S-M11', members, { full: true, settle: 2500 });

await forEachPage(members, async (page) => { await page.click('#preparation-tab-1'); await page.waitForTimeout(500); });
await shootAll('S-M12', members, { full: true });

await forEachPage(members, async (page) => { await page.click('#preparation-tab-2'); await page.waitForTimeout(800); });
await shootAll('S-M13', members, { full: true });

// 카메라 켜기까지 보여 주는 변형은 생략 — 3단계 모두 완료 → 시작 대기 화면
await forEachPage(members, async (page) => {
  await page.click('#preparation-tab-0');
  await page.getByRole('button', { name: '건너뛰기' }).click();     // 설문 건너뛰기 → 1단계 이동
  await page.getByRole('button', { name: '밴드 없이 진행하기' }).click();
  await page.click('#preparation-tab-2');
  await page.getByRole('button', { name: '기기 확인 완료' }).click();
  await page.waitForTimeout(1500);
});
await shootAll('S-M16', members, { full: true, settle: 1500 });

// 게스트 입장: 닉네임 입력 → 대기실
const guests = await makePages(browser, { login: false });
await forEachPage(guests, async (page, name) => {
  await page.goto(`${BASE}/join?code=${CODE_A}`, { waitUntil: 'networkidle' });
});
await shootAll('S-M21', guests, { full: true });
await forEachPage(guests, async (page, name) => {
  await page.fill('#guest-name', `조사게스트${name}`);
  await page.getByRole('button', { name: '클래스 참여하기' }).click();
  await page.waitForSelector('[role=tablist]', { timeout: 30000 });
});
await shootAll('S-M15', guests, { full: true, settle: 2000 });

await closeAll(browser, members); await closeAll(browser, guests).catch(() => {});
