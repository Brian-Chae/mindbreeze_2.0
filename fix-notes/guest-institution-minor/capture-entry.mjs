// 합성 API만 사용하여 390px 실제 입장 폼·요청을 검증한다.
// 실행: node fix-notes/guest-institution-minor/capture-entry.mjs (로컬 Vite :5187 필요)
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
const out = new URL('./screenshots/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  // HTTP 모킹과 별도로 WebSocket도 차단하여 외부 연결을 만들지 않는다.
  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname === '/') socket.connectToServer();
    else socket.close();
  });
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  const sid = '11111111-1111-4111-8111-111111111111';
  const pid = '22222222-2222-4222-8222-222222222222';
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    // localhost 프론트 자산 외 모든 외부 요청을 차단한다.
    if (url.pathname.startsWith('/api/') || url.pathname.includes('/socket.io')) {
      const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname.endsWith('/sessions/enter/verify')) return respond({ title: '학교 마음챙김 수업', scheduled_at: null, host_name: '테스트 교사' });
      if (url.pathname.endsWith('/sessions/enter')) {
        requests.push(req.postDataJSON());
        return respond({ entry_credential: 'synthetic-entry-credential', expires_at: null, participant_id: pid, is_guest: true, is_waitlisted: false,
          session: { id: sid, type: 'meditation', title: '학교 마음챙김 수업', host_name: '테스트 교사', status: 'open', scheduled_at: null, started_at: null, duration_min: 10, location_type: 'offline', participant_mode: 'group', linkband_mode: 'none', record_audio: true, record_video: false, participants: [] } });
      }
      if (url.pathname.includes('/entry-state')) return respond({ session_id: sid, status: 'open', guest_state: 'waiting', in_progress: false, ended: false, participant_id: pid, is_waitlisted: false, report_included: false, started_at: null, ended_at: null, chat_enabled: false, band_connected: false });
      return respond({ detail: '합성 검증: 외부 API 차단' }, 401);
    }
    if (url.origin === 'http://127.0.0.1:5187') return route.continue();
    return route.abort();
  });
  await page.goto('http://127.0.0.1:5187/join');
  await page.locator('input').first().fill('0042');
  await page.locator('#fm-name').waitFor();
  await page.locator('#fm-name').fill('3반 7번');
  await page.getByRole('radio', { name: '선택 안 함', exact: true }).click();
  await page.getByRole('listbox', { name: '출생 연도', exact: true }).getByRole('option', { name: '2018년', exact: true }).click();
  await page.getByRole('listbox', { name: '출생 월', exact: true }).getByRole('option', { name: '3월', exact: true }).click();
  const monthDial = page.getByRole('listbox', { name: '출생 월', exact: true });
  // 실제 스크롤 정착과 키보드 선택을 별도로 확인하고 3월로 돌린다.
  await monthDial.evaluate(el => { el.scrollTop = 4 * 44; });
  await page.waitForFunction(() => document.querySelector('[aria-label="출생 월"] [aria-selected="true"]')?.textContent === '4월');
  await monthDial.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('[aria-label="출생 월"] [aria-selected="true"]')?.textContent === '3월');
  await page.locator('#fm-email').fill('teacher@example.com');
  await page.locator('#fm-email2').fill('teacher@example.com');
  await page.getByRole('checkbox').click();
  const metrics = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    nameHint: document.getElementById('fm-name-hint')?.textContent,
    yearDials: document.querySelectorAll('[role="listbox"][aria-label="출생 연도"]').length,
    monthDials: document.querySelectorAll('[role="listbox"][aria-label="출생 월"]').length,
    monthInputs: document.querySelectorAll('input[type="month"]').length,
    selectedYear: document.querySelector('[aria-label="출생 연도"] [aria-selected="true"]')?.textContent,
    selectedMonth: document.querySelector('[aria-label="출생 월"] [aria-selected="true"]')?.textContent,
    dateInputs: document.querySelectorAll('input[type="date"]').length,
    researchControls: [...document.querySelectorAll('button,label')].filter(e => /연구.*동의/.test(e.textContent)).length,
    hintFontSize: getComputedStyle(document.getElementById('fm-name-hint')).fontSize,
  }));
  assert.equal(metrics.width, 390);
  assert.equal(metrics.scrollWidth, 390);
  assert.equal(metrics.nameHint, '실명이 아니어도 됩니다(별명·반 번호 가능)');
  assert.equal(metrics.yearDials, 1);
  assert.equal(metrics.monthDials, 1);
  assert.equal(metrics.monthInputs, 0);
  assert.equal(metrics.selectedYear, '2018년');
  assert.equal(metrics.selectedMonth, '3월');
  assert.equal(metrics.dateInputs, 0);
  assert.equal(metrics.researchControls, 0);
  await page.screenshot({ path: fileURLToPath(new URL('entry-consent-390.png', out)), fullPage: true });
  await page.evaluate(() => { for (const e of document.querySelectorAll('*')) { if (e.scrollTop && e.getAttribute('role') !== 'listbox') e.scrollTop = 0; } });
  await page.screenshot({ path: fileURLToPath(new URL('entry-390.png', out)), fullPage: true });
  await page.getByRole('button', { name: '입장하기', exact: true }).click();
  await page.waitForURL(`**/class/${sid}/enter`);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].birth_year_month, '2018-03');
  assert.equal(requests[0].name, '3반 7번');
  assert.equal('birth_date' in requests[0], false);
  // 준비 안내에서도 연구 동의가 보이지 않아야 한다.
  const enter = page.getByRole('button', { name: '입장하기', exact: true });
  await page.locator('#fm-name').waitFor({ state: 'detached' });
  await enter.waitFor({ timeout: 6000 }).catch(async error => { console.log('입장 확인 화면', await page.locator('body').innerText(), errors); throw error; });
  await enter.click();
  await page.getByRole('heading', { name: '기록 안내', exact: true }).waitFor({ timeout: 8000 }).catch(async error => { console.log('실패 화면', await page.locator('body').innerText(), errors); throw error; });
  assert.equal(await page.getByRole('region', { name: '연구 동의', exact: true }).count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('notice-390.png', out)), fullPage: true });
  await page.goto('http://127.0.0.1:5187/class-members/33333333-3333-4333-8333-333333333333');
  await page.getByLabel('이름', { exact: true }).waitFor();
  assert.equal(await page.getByRole('listbox', { name: '출생 연도', exact: true }).count(), 1);
  assert.equal(await page.getByRole('listbox', { name: '출생 월', exact: true }).count(), 1);
  assert.equal(await page.locator('input[type="month"]').count(), 0);
  assert.equal(await page.locator('input[type="date"]').count(), 0);
  assert.equal(await page.getByText('[선택] 연구 목적 활용 동의', { exact: true }).count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('membership-390.png', out)), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(new URL('metrics-390.json', out), JSON.stringify({ ...metrics, request: requests[0], pageErrors: errors, api: '합성 응답만 사용; 실서버 연결 없음' }, null, 2));
  console.log(JSON.stringify({ ...metrics, request: requests[0], pageErrors: errors }, null, 2));
} finally { await browser.close(); }
