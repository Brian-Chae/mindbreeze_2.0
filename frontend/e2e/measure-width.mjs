// 폭 실측: 합성 인증/빈 API로 페이지 본문 x·폭을 1440/1920에서 측정한다.
// 사용: VITE_API_BASE_URL=http://127.0.0.1:5441/api/v1 vite --port 5441 실행 후
//       node e2e/measure-width.mjs <label> <outdir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const [label = 'after', out = '/tmp/w'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const host = { id: 'qa-host', email: 'h@example.test', name: 'QA 상담사', role: 'counselor', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [] };
const member = { id: 'qa-member', email: 'm@example.test', name: 'QA 회원', role: 'client', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'google', counselors: [{ id: 'qa-host', name: 'QA 상담사', profile_image: null }] };
const mkClass = (i) => ({ id: `c${i}`, title: `MBSR 클래스 ${i}`, status: 'active', schedule_mode: 'fixed', planned_session_count: 8, area: 'meditation', progress: { completed: 1, total: 8 }, session_count: 8, next_session: { id: `s${i}`, seq: 2, scheduled_at: '2026-11-20T10:00:00+09:00', status: 'scheduled', host: { id: 'qa-host', name: 'QA 상담사' } }, has_open_session: false });
const classes = { classes: [1, 2, 3, 4].map(mkClass), total: 4 };
const pages = [
  ['host', '홈(상담사)', '/dashboard', '.ch-home'],
  ['host', '명상 클래스', '/classes', '.cs-structure-scroll > *'],
  ['host', '회원 목록', '/clients', null],
  ['host', '리포트', '/reports', null],
  ['host', '플레이그라운드', '/playground', null],
  
  ['host', '알림(유지)', '/notifications', null],
  ['member', '회원 홈', '/app', '.mh-home'],
  ['member', '내 클래스', '/app/classes', '.cs-structure-scroll > :not(style)'],
  ['member', '회원 리포트', '/app/reports', null],
];
const browser = await chromium.launch({ channel: 'chrome' });
const rows = [];
for (const [role, name, path, sel] of pages) {
  for (const w of [1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1000 }, locale: 'ko-KR' });
    const user = role === 'host' ? host : member;
    await ctx.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), user);
    await ctx.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/v1/')) return route.continue();
      const p = url.pathname;
      const j = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (p.endsWith('/auth/refresh')) return j({ access_token: 'qa', token_type: 'bearer' });
      if (/\/classes\/?$/.test(p)) return j(classes);
      if (/\/reports\/?$/.test(p)) return j({ reports: [], items: [], total: 0, page: 1, page_size: 20 });
      if (/\/clients\/?$/.test(p)) return j({ clients: [], items: [], total: 0 });
      if (process.env.LOGAPI) console.log('API', p);
      if (/chat\/rooms/.test(p)) return j({ rooms: [], total: 0 });
      if (/dashboard\/counselor/.test(p)) return j({ counselor_id: 'qa-host', counselor_name: 'QA 상담사', org_id: null, org_name: null, org_kind: 'individual', total_classes: 0, in_progress_classes: 0, completed_classes: 0, total_participants: 0, pending_review_count: 0, classes: [] });
      if (/me\/consents/.test(p)) return j({ tos: { agreed: true }, privacy: { agreed: true }, sensitive: { agreed: true }, marketing: { agreed: false }, research: { agreed: false } });
      if (/client\/counselors/.test(p)) return j([{ id: 'qa-host', name: 'QA 상담사', profile_image: null }]);
      if (/notifications/.test(p)) return j({ notifications: [], items: [], unread: 0, unread_count: 0, total: 0 });
      if (/notifications|unread/.test(p)) return j({ notifications: [], items: [], unread: 0, unread_count: 0, total: 0 });
      return j({ classes: [], rooms: [], sessions: [], reports: [], items: [], relationships: [], notifications: [], total: 0 });
    });
    await ctx.routeWebSocket(/socket\.io/, (s) => s.close());
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:5441${path}`);
    await page.waitForTimeout(2500);
    const m = await page.evaluate((sel) => {
      const sc = document.querySelector('[data-mobile-swipe-page]') || document.querySelector('.cs-structure-scroll');
      let el = sel ? document.querySelector(sel) : null;
      const wide = sc && sc.querySelector('[data-ui=page-wide]');
      if (!el && sc) el = wide || sc.firstElementChild;
      if (!sel && wide) el = wide;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const tr = document.querySelector('.mh-track');
      let track = null;
      if (tr) {
        const cs = [...tr.querySelectorAll('.mc-card')].map((c) => c.getBoundingClientRect());
        const t = tr.getBoundingClientRect();
        track = { n: cs.length, trackW: Math.round(t.width), cardW: cs[0] && Math.round(cs[0].width * 10) / 10, rightEdge: cs.length ? Math.round(cs[cs.length - 1].right - t.left) : 0 };
      }
      return { x: Math.round(r.x * 10) / 10, w: Math.round(r.width * 10) / 10, url: location.pathname, track };
    }, sel);
    rows.push({ label, role, name, vw: w, ...m });
    await page.screenshot({ path: `${out}/${label}-${name.replace(/[()/]/g, '')}-${w}.png` });
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/${label}.json`, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(label, r.vw, r.name, r.url, 'x=', r.x, 'w=', r.w, r.track ? JSON.stringify(r.track) : '');
