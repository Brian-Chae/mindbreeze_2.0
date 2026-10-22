// SDD-230 구현 화면 캡처 — Vite dev 서버 + API mock(가상 데이터). 서버·DB·.env 접근 없음.
// 사용: MB_PLAYWRIGHT_PATH=<playwright 경로> MB_BASE=http://localhost:5199 node capture.cjs
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.MB_PLAYWRIGHT_PATH);
const BASE = process.env.MB_BASE || 'http://localhost:5199';
const NOW = Date.now();
const iso = (d, h = 0) => new Date(NOW - d * 86400000 - h * 3600000).toISOString();
const clients = [
  ['u1', '윤가온', 'female', 34, '010-****-1234', [['c1', '아침 명상'], ['c2', '수면 클래스']], 1, '수업·상담 참여'],
  ['u2', '박하늘', 'male', 41, '010-****-5678', [['c1', '아침 명상']], 3, '밴드 측정'],
  ['u3', '이서연', null, null, null, [], null, null],
  ['u4', '최도윤', 'male', 29, '010-****-9012', [['c2', '수면 클래스']], 12, '수업 체크인'],
  ['u5', '정하은', 'female', 52, '010-****-3456', [], 40, '수업·상담 참여'],
].map(([id, name, gender, age, phone, cls, d, src]) => ({
  id, name, email: `${id}@example.test`, concerns: [], last_session_at: d ? iso(d) : null,
  gender, age, phone_masked: phone, classes: cls.map(([i, t]) => ({ id: i, title: t })),
  last_activity_at: d ? iso(d) : null, last_activity_source: src,
}));
const profile = {
  id: 'u1', name: '윤가온', email: 'u1@example.test', phone: null, phone_masked: '010-****-1234', gender: 'female',
  birth_date: null, age: 34, concerns: ['수면', '불안'], interests: ['명상'], bio: null, profile_image_url: null, memo: '가상 메모 — 다음 회차 호흡 안내 점검',
};
const activity = {
  items: [
    { id: 'a1', type: 'session', occurred_at: iso(1), title: '아침 명상 4회차', class_title: '아침 명상', session_id: 's1', note: null },
    { id: 'a2', type: 'checkin', occurred_at: iso(1, -0.1), title: '아침 명상 4회차', class_title: '아침 명상', session_id: 's1', note: '수업 전후 체크인' },
    { id: 'a3', type: 'measurement', occurred_at: iso(1, 0.2), title: '아침 명상 4회차', class_title: '아침 명상', session_id: 's1', note: '밴드 측정 기록' },
    { id: 'a4', type: 'session', occurred_at: iso(8), title: '수면 클래스 2회차', class_title: '수면 클래스', session_id: 's2', note: null },
  ], next_cursor: null, ai_included: false,
};
const reports = {
  reports: [
    { id: 'r1', session_id: 's1', title: '아침 명상 4회차', type: 'client', type_label: '회원용', status: 'completed', status_label: '승인됨', occurred_at: iso(1), created_at: iso(1) },
    { id: 'r2', session_id: 's1', title: '아침 명상 4회차', type: 'counselor', type_label: '상담사용', status: 'pending_review', status_label: '검토 중', occurred_at: iso(1), created_at: iso(1) },
    { id: 'r3', session_id: 's2', title: '수면 클래스 2회차', type: 'client', type_label: '회원용', status: 'completed', status_label: '승인됨', occurred_at: iso(8), created_at: iso(8) },
  ],
  changes: [
    { report_id: 'r1', title: '아침 명상 4회차', occurred_at: iso(1), state: 'computed', summary: '이완 편안한 쪽으로 이동 · 전반 대비 +8.2 / 긴장 편안한 쪽으로 이동 · 전반 대비 -5.1', metrics: [] },
    { report_id: 'r3', title: '수면 클래스 2회차', occurred_at: iso(8), state: 'not_measured', summary: '밴드 미측정 회차 (측정 없음은 나쁜 상태가 아닙니다)', metrics: [] },
  ],
};
(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const out = __dirname;
  const audit = [];
  for (const width of [1440, 1194, 390]) {
    for (const view of ['table', 'cards', 'group', 'detail']) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('http://localhost:8000/**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const p = url.pathname.replace('/api/v1', '');
        let body = {};
        if (p === '/auth/refresh') body = { access_token: 'mock', token_type: 'bearer' };
        else if (p === '/clients') {
          const cid = url.searchParams.get('class_id');
          const list = cid ? clients.filter((c) => c.classes.some((k) => k.id === cid)) : clients;
          body = { clients: list, total: list.length, page: 1, class_options: [{ id: 'c1', title: '아침 명상' }, { id: 'c2', title: '수면 클래스' }] };
        } else if (p === '/clients/u1') body = profile;
        else if (p === '/clients/u1/activity') body = activity;
        else if (p === '/clients/u1/reports') body = reports;
        else if (p === '/chat/rooms') body = { rooms: [] };
        else if (p.includes('unread')) body = { count: 0, unread: 0 };
        else body = [];
        return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      });
      await page.addInitScript((mode) => {
        localStorage.setItem('mb_user', JSON.stringify({ id: 'me', email: 'c@example.test', name: '김상담', role: 'counselor', verified_tier: 'email', onboarding_completed: true, auth_provider: 'email', counselors: [] }));
        localStorage.setItem('mb_clients_view', mode);
      }, view === 'cards' ? 'cards' : 'table');
      const url = view === 'detail' ? '/clients/u1' : view === 'group' ? '/clients?group=class' : '/clients';
      await page.goto(BASE + url);
      await page.waitForSelector(view === 'detail' ? 'text=활동 타임라인' : 'text=윤가온', { timeout: 20000 });
      await page.waitForTimeout(800);
      await page.evaluate(() => document.fonts.ready);
      const file = `${view}-${width}.png`;
      await page.screenshot({ path: path.join(out, file), fullPage: true });
      const m = await page.evaluate(() => {
        const tw = document.querySelector('[data-testid="client-table-scroll"]');
        const small = [...document.querySelectorAll('button, a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40; }).map((e) => `${e.textContent.trim().slice(0, 20)}:${Math.round(e.getBoundingClientRect().height)}`);
        return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, tableScroll: tw ? tw.scrollWidth > tw.clientWidth : null, small: small.slice(0, 8), text: document.body.innerText.includes('온라인') || document.body.innerText.includes('종합') };
      });
      audit.push({ file, errors, ...m, pageOverflow: m.pageWidth > m.viewport });
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'layout-audit.json'), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit.map((a) => ({ f: a.file, overflow: a.pageOverflow, tableScroll: a.tableScroll, err: a.errors.length, banned: a.text, small: a.small }))));
})();
