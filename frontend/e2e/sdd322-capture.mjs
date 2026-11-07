// SDD-322 — 알림 화면 D안(UI_V2 on) 캡처·측정. 서버 없이 빌드 산출물을 Chrome 에 제공하고 모든 API 는 합성 데이터다.
// 사용: node e2e/sdd322-capture.mjs <dist-v2 경로> <출력 디렉터리>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
const HOST = 'https://sdd322.local';
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html', '.json': 'application/json' };
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

const users = {
  client: { id: 'c-1', email: 'client@example.test', name: '합성 회원', role: 'client', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'email', counselors: [{ id: 'k1', name: '가코치', profile_image: null }] },
  org: { id: 'a-1', email: 'admin@example.test', name: '합성 기관관리자', role: 'org_admin', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'email', counselors: [] },
  coach: { id: 'k-1', email: 'coach@example.test', name: '합성 코치', role: 'counselor', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'email', counselors: [] },
};
const notes = [
  { id: 'n1', type: 'session', title: '오늘 저녁 클래스가 곧 시작돼요', body: '저녁의 호흡 · 3회차가 19:30에 시작해요. 편한 자리에서 입장해 주세요.', is_read: false, extra: null, created_at: ago(3) },
  { id: 'n2', type: 'chat', title: '가코치님이 메시지를 보냈어요', body: '오늘 연습한 호흡 어땠는지 편하게 남겨 주세요.', is_read: false, extra: { schema_version: 1, event_type: 'chat_message', target_type: 'chat_room', target_id: 'room-1' }, created_at: ago(70) },
  { id: 'n3', type: 'report', title: '새 리포트가 준비되었어요', body: '2회차 리포트를 확인할 수 있어요.', is_read: true, extra: null, created_at: ago(60 * 30) },
  { id: 'n4', type: 'system', title: '아주 긴 제목이 들어와도 줄바꿈으로 안전하게 보이는지 확인하기 위한 합성 알림 제목입니다 가나다라마바사아자차카타파하', body: '긴 본문 합성: ' + '마음을 천천히 가라앉히는 연습을 이어가요. '.repeat(6), is_read: true, extra: null, created_at: ago(60 * 24 * 9) },
];
const prefs = { email: { session_booked: true, session_cancelled: false, chat_message: true }, in_app: { session_booked: true, session_cancelled: true, chat_message: false } };

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['#25212C', '#FFFFFF'], ['#68616F', '#FFFFFF'], ['#68616F', '#F4F4F7'], ['#5F0080', '#FFFFFF'], ['#5F0080', '#EEE5F5'], ['#8F1F3D', '#FFFFFF'], ['#FFFFFF', '#5F0080'], ['#6B6472', '#FFFFFF']];
const contrast = pairs.map(([fg, bg]) => ({ fg, bg, ratio: +ratio(fg, bg).toFixed(2) }));

const screens = [
  { key: 'client', user: 'client', url: '/app/notifications', waitFor: '.u2-notif-item' },
  { key: 'client-expand', user: 'client', url: '/app/notifications', waitFor: '.u2-notif-item', act: async (p) => { await p.locator('.u2-notif-row').nth(3).click(); await p.waitForSelector('.u2-notif-expanded'); } },
  { key: 'client-empty', user: 'client', url: '/app/notifications', waitFor: '.u2-notif-empty', empty: true },
  { key: 'client-error', user: 'client', url: '/app/notifications', waitFor: '.u2-notif-error', fail: true },
  { key: 'org', user: 'org', url: '/notifications', waitFor: '.u2-notif-item' },
  { key: 'org-prefs', user: 'org', url: '/notifications', waitFor: '.u2-notif-item', act: async (p) => { await p.getByRole('button', { name: '설정' }).click(); await p.waitForSelector('[role=switch]'); } },
  { key: 'org-empty', user: 'org', url: '/notifications', waitFor: '.u2-notif-empty', empty: true },
  { key: 'coach', user: 'coach', url: '/notifications', waitFor: '.max-w-2xl .space-y-2 > button' },
  { key: 'coach-prefs', user: 'coach', url: '/notifications', waitFor: '.max-w-2xl .space-y-2 > button', act: async (p) => { await p.getByRole('button', { name: '설정' }).click(); await p.waitForSelector('[role=switch]'); } },
  { key: 'coach-empty', user: 'coach', url: '/notifications', waitFor: '.max-w-2xl [class*=border-dashed]', empty: true },
];
const widths = [390, 768, 1440];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = []; const errors = []; const fonts = [];

for (const width of widths) {
  for (const s of screens) {
    const context = await browser.newContext({ viewport: { width, height: width >= 1440 ? 900 : width === 768 ? 1024 : 844 }, serviceWorkers: 'block', deviceScaleFactor: 2 });
    await context.routeWebSocket('**/*', (ws) => ws.close());
    await context.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), users[s.user]);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${width}/${s.key}: ${e.message}`));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url()); const p = url.pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
      if (url.hostname !== 'sdd322.local') return route.abort('blockedbyclient');
      if (route.request().method() === 'OPTIONS') return json({});
      if (p.startsWith('/api/')) {
        if (p.endsWith('/auth/refresh')) return json({ access_token: 'synthetic', token_type: 'bearer' });
        if (p.endsWith('/auth/users/me')) return json(users[s.user]);
        if (/\/notifications\/preferences/.test(p)) return json(prefs);
        if (/\/notifications\/unread-count/.test(p)) return json({ unread: 2 });
        if (/\/notifications/.test(p)) return s.fail ? json({ detail: '합성 서버 오류' }, 500) : json({ notifications: s.empty ? [] : notes, total: s.empty ? 0 : notes.length, unread: s.empty ? 0 : 2 });
        if (/\/reports\/counts/.test(p)) return json({ unread: 0, pending_review: 0 });
        if (/\/chat\/rooms/.test(p)) return json({ rooms: [], total: 0 });
        if (/\/client\/counselors/.test(p)) return json(users.client.counselors);
        return json({}, 200);
      }
      const asset = path.join(dist, p);
      const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(dist, 'index.html');
      return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await page.goto(HOST + s.url, { waitUntil: 'load' });
    await page.waitForSelector(s.waitFor, { timeout: 15000 }).catch(() => errors.push(`${width}/${s.key}: ${s.waitFor} 없음`));
    await page.waitForTimeout(700);
    if (s.act) await s.act(page).catch((e) => errors.push(`${width}/${s.key}: act ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `${s.key}-${width}.png`), fullPage: false });
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const scroller = document.querySelector('.u2-scroll') || doc;
      const isUi = !!document.querySelector('.ui-v2');
      const coach = doc.classList.contains('u2-coach');
      const docOverflow = doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > document.body.clientWidth || scroller.scrollWidth > scroller.clientWidth;
      const scope = isUi ? '.ui-v2' : '[data-mobile-swipe-page]';
      const small = [];
      document.querySelectorAll(`${scope} a, ${scope} button, ${scope} [role=switch], ${scope} input:not([type=checkbox]):not([type=radio]), ${scope} select`).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest('.sr-only')) return;
        if (r.width < 43.5 || r.height < 43.5) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14)}:${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      // 합성 서버 문구(알림 제목·본문)는 표시만이라 제외하고, 화면 크롬 문구만 금지 표현을 검사한다.
      const chrome = Array.from(document.querySelectorAll('h1,h2,h3,header p,small,.u2-textlink,.u2-secondary,.u2-primary,.u2-chip,.u2-notif-unread,.u2-notif-error,.u2-notif-empty')).map((e) => e.textContent).join(' ');
      const forbidden = chrome.match(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/g) || [];
      const h1 = document.querySelector('h1');
      const h1Clipped = h1 ? h1.scrollWidth > h1.clientWidth + 1 : null;
      const rows = Array.from(document.querySelectorAll('.u2-notif-row, main .max-w-2xl > .space-y-2 > button'));
      const rowOverflow = rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length;
      let hidden = false; let gap = null;
      const nav = document.querySelector('.u2-nav');
      if (nav && getComputedStyle(nav.parentElement).display !== 'none' && document.querySelector('.u2-scroll')) {
        const sc = document.querySelector('.u2-scroll'); sc.scrollTop = sc.scrollHeight;
        const navTop = nav.getBoundingClientRect().top;
        const kids = Array.from(sc.querySelectorAll('main > *')).filter((k) => getComputedStyle(k).position !== 'fixed');
        const lastBottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom).filter((b) => b > 0), 0);
        gap = Math.round(navTop - lastBottom); hidden = lastBottom > navTop + 1;
      }
      const currents = document.querySelectorAll('.u2-nav [aria-current="page"]').length;
      return { isUi, coach, docOverflow, small, h1Clipped, forbidden, rowOverflow, hidden, gap, navCurrent: nav ? currents : null, rowCount: rows.length };
    });
    results.push({ width, screen: s.key, ...m });
    if ((s.key === 'client' || s.key === 'org') && width !== 768) {
      const f = await (async () => {
        const client = await context.newCDPSession(page);
        await client.send('DOM.enable'); await client.send('CSS.enable');
        const { root } = await client.send('DOM.getDocument', { depth: -1 });
        const probe = async (sel) => {
          const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
          if (!nodeId) return null;
          const { fonts: ff } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
          return ff.map((x) => `${x.familyName}${x.isCustomFont ? ' (웹폰트)' : ' (시스템)'} ×${x.glyphCount}`).join(', ');
        };
        const r = { h1: await probe('.ui-v2 h1'), title: await probe('.u2-notif-title'), text: await probe('.u2-notif-text') };
        await client.detach(); return r;
      })().catch((e) => ({ error: e.message }));
      fonts.push({ width, screen: s.key, ...f });
    }
    await context.close();
  }
}
// prefers-reduced-motion (내담자·기관)
let animated = 0;
for (const u of ['client', 'org']) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', (ws) => ws.close());
  await context.addInitScript((x) => localStorage.setItem('mb_user', JSON.stringify(x)), users[u]);
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname;
    const json = (b) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(b) });
    if (url.hostname !== 'sdd322.local') return route.abort();
    if (route.request().method() === 'OPTIONS') return json({});
    if (p.startsWith('/api/')) { if (p.endsWith('/auth/refresh')) return json({ access_token: 's', token_type: 'bearer' }); if (p.endsWith('/auth/users/me')) return json(users[u]); if (/notifications\/preferences/.test(p)) return json(prefs); if (/\/notifications/.test(p)) return json({ notifications: notes, total: 4, unread: 2 }); return json({}); }
    const asset = path.join(dist, p); const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(dist, 'index.html');
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto(HOST + (u === 'client' ? '/app/notifications' : '/notifications')); await page.waitForSelector('.u2-notif-item', { timeout: 15000 }).catch(() => errors.push(`reduced/${u}: 목록 없음`));
  if (u === 'org') { await page.getByRole('button', { name: '설정' }).click().catch(() => undefined); await page.waitForSelector('[role=switch]').catch(() => undefined); }
  animated += await page.evaluate(() => Array.from(document.querySelectorAll('.ui-v2, .ui-v2 *')).filter((el) => { const cs = getComputedStyle(el); return (parseFloat(cs.transitionDuration) > 0.001 && cs.transitionDuration !== '0s') || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.001); }).length);
  await context.close();
}
results.push({ screen: 'reduced-motion', animatedElements: animated });
await browser.close();
fs.writeFileSync(path.join(out, 'measure.json'), JSON.stringify({ contrast, results, fonts, errors }, null, 2));
const bad = results.filter((r) => r.screen && r.width && (r.docOverflow || r.small?.length || r.h1Clipped || r.forbidden?.length || r.rowOverflow || r.hidden || (r.screen.startsWith('client') || r.screen.startsWith('org') ? !r.isUi : !r.coach)));
console.log(JSON.stringify({ total: results.length, bad: bad.map((b) => ({ w: b.width, s: b.screen, isUi: b.isUi, coach: b.coach, docOverflow: b.docOverflow, small: b.small, h1Clipped: b.h1Clipped, forbidden: b.forbidden, rowOverflow: b.rowOverflow, hidden: b.hidden, gap: b.gap })), errors, animated, minContrast: Math.min(...contrast.map((c) => c.ratio)) }, null, 1));
