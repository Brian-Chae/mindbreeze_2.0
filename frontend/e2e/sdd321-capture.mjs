// SDD-321 — 기관 관리자 D안(UI_V2 on) 화면 캡처·측정. 서버 없이 빌드 산출물을 Chrome 에 제공하고 모든 API 는 합성 데이터다.
// 사용: node e2e/sdd321-capture.mjs <dist-v2 경로> <출력 디렉터리>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
const HOST = 'https://sdd321.local';
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.html': 'text/html', '.json': 'application/json' };
const iso = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();

const admin = { id: 'a-1', email: 'admin@example.test', name: '합성 기관관리자', role: 'org_admin', verified_tier: 'verified', onboarding_completed: true, auth_provider: 'email', counselors: [] };
const cls = (id, title, status, extra = {}) => ({ id, title, type: 'meditation', custom_type_name: null, status, access_code: 'AB' + id.toUpperCase().padEnd(4, 'X'), participant_mode: 'open', participant_count: 6, guest_count: 1, started_at: iso(2, 10, 0), ended_at: iso(2, 11, 0), has_record: true, has_summary: false, report_count: 1, pending_review_count: 0, ...extra });
const dashboard = {
  org_id: 'org-1', org_name: '마음숲 상담센터', org_code: 'MS2026', total_counselors: 3, total_classes: 12, total_participants: 40, total_members: 47, completed_classes: 7, in_progress_classes: 2,
  counselors: [
    { id: 'k1', name: '가코치', email: 'coach.ga@example.test', class_count: 5, participant_count: 21, completed_count: 3 },
    { id: 'k2', name: '나코치', email: 'coach.na@example.test', class_count: 4, participant_count: 14, completed_count: 3 },
    { id: 'k3', name: '다코치', email: 'coach.da@example.test', class_count: 3, participant_count: 12, completed_count: 1 },
  ],
  classes: [cls('c1', '저녁의 호흡 · 8회기 과정', 'completed'), cls('c2', '잠시 머무는 연습', 'in_progress', { has_record: false, ended_at: null }), cls('c3', '가을의 마음 산책', 'scheduled', { has_record: false, started_at: null, ended_at: null, participant_count: 0, guest_count: 0 }), cls('c4', '임상 상담 집중 코스', 'completed', { type: 'clinical' })],
};
const item = (id, name, over = {}) => ({ id, name, email: `${id}@example.test`, role: 'counselor', status: 'active', counselor_code: 'CD' + id.toUpperCase(), has_personal_office: false, invited_at: null, invite_expires_at: null, invite_type: null, ...over });
const counselors = [item('k1', '가코치', { has_personal_office: true }), item('k2', '나코치'), item('k3', '다코치', { status: 'suspended' }), item('k4', '라코치', { status: 'pending', counselor_code: null, invite_type: 'new_account', invite_expires_at: '2999-01-01T00:00:00Z' }), item('a1', '마관리자', { role: 'org_admin', counselor_code: null })];
const profile = { id: 'k1', email: 'k1@example.test', name: '가코치', role: 'counselor', status: 'active', org_id: 'org-1', org_name: '마음숲 상담센터', counselor_code: 'CDK1', phone: '010-1234-5678', profile_image: null, bio: null, gender: 'female', birth_date: '1990-01-02', postal_code: '12345', address_line1: '대전 유성구', address_line2: '101호', affiliation_type: null, years_of_experience: 5, specialties: ['명상'], qualifications: [], careers: [], version: 1 };
const activity = { sessions: [{ id: 's1', title: '저녁의 호흡 · 3회차', type: 'meditation', status: 'scheduled', scheduled_at: iso(8, 19, 30), started_at: null, participant_count: 6 }, { id: 's2', title: '저녁의 호흡 · 2회차', type: 'meditation', status: 'completed', scheduled_at: iso(4, 19, 30), started_at: iso(4, 19, 31), participant_count: 5 }], reports: [{ id: 'r1', session_id: 's2', title: '2회차 리포트', type: 'counselor', status: 'pending_review', created_at: iso(4, 21, 0) }] };
const orgInfo = { id: 'org-1', name: '마음숲 상담센터', ceo_name: '홍길동', biz_number: '123-45-67890', address: '대전광역시 유성구 테크노2로', phone: '042-000-0000', verified: true, verified_at: '2026-01-02', created_at: '2025-12-01' };
const searchResults = [{ id: 'o1', name: '마음숲 상담센터', address: '대전 유성구', verified: true }, { id: 'o2', name: '바람결 명상센터', address: '서울 마포구', verified: false }];
const requests = [{ id: 'q1', org_id: 'o1', org_name: '마음숲 상담센터', status: 'pending', reason: null, created_at: iso(5, 9, 0) }, { id: 'q2', org_id: 'o2', org_name: '바람결 명상센터', status: 'approved', reason: null, created_at: iso(3, 9, 0) }, { id: 'q3', org_id: 'o3', org_name: '하늘빛 센터', status: 'rejected', reason: '제출 서류가 부족합니다.', created_at: iso(1, 9, 0) }];

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['#25212C', '#F4F4F7'], ['#25212C', '#FFFFFF'], ['#68616F', '#FFFFFF'], ['#68616F', '#F4F4F7'], ['#5F0080', '#FFFFFF'], ['#5F0080', '#EEE5F5'], ['#FFFFFF', '#5F0080'], ['#FFFFFF', '#B3264B'], ['#FFFFFF', '#14593B'],
  ['#14593B', '#DDF3E8'], ['#6E4300', '#FFF0CF'], ['#8F1F3D', '#FBE3E8'], ['#1B467F', '#E3EDFB'], ['#68616F', '#F4F4F7'], ['#8F1F3D', '#FFFFFF']];
const contrast = pairs.map(([fg, bg]) => ({ fg, bg, ratio: +ratio(fg, bg).toFixed(2) }));

const screens = [
  { key: 'dashboard', url: '/dashboard/org', waitFor: 'h1' },
  { key: 'counselors', url: '/org/counselors', waitFor: 'table' },
  { key: 'counselors-history', url: '/org/counselors', waitFor: 'table', act: async (p) => { await p.getByRole('button', { name: '이력' }).first().click(); await p.waitForSelector('[role=tablist]'); await p.waitForTimeout(300); } },
  { key: 'counselors-edit', url: '/org/counselors', waitFor: 'table', act: async (p) => { await p.getByRole('button', { name: '정보 수정' }).first().click(); await p.waitForSelector('form[aria-label$="정보 수정"]'); await p.waitForTimeout(300); } },
  { key: 'counselors-invite', url: '/org/counselors', waitFor: 'table', act: async (p) => { await p.getByRole('button', { name: '코치 초대' }).first().click(); await p.waitForSelector('[role=dialog]'); await p.waitForTimeout(200); } },
  { key: 'counselors-suspend', url: '/org/counselors', waitFor: 'table', act: async (p) => { await p.getByRole('button', { name: '비활성화' }).first().click(); await p.waitForSelector('[role=dialog]'); await p.waitForTimeout(200); } },
  { key: 'management', url: '/org/org-1', waitFor: 'h1' },
  { key: 'search', url: '/org/search', waitFor: 'h1', act: async (p) => { await p.getByRole('button', { name: '검색' }).click(); await p.waitForSelector('.u2-org-result'); } },
  { key: 'requests', url: '/org/requests', waitFor: 'h1' },
];
const widths = [390, 393, 768, 1440];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = []; const errors = []; const fonts = [];

for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: width >= 1440 ? 900 : width === 768 ? 1024 : 844 }, serviceWorkers: 'block', deviceScaleFactor: 2 });
  await context.routeWebSocket('**/*', (s) => s.close());
  await context.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), admin);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
    if (url.hostname !== 'sdd321.local') return route.abort('blockedbyclient');
    if (route.request().method() === 'OPTIONS') return json({});
    if (p.startsWith('/api/')) {
      if (p.endsWith('/auth/refresh')) return json({ access_token: 'synthetic', token_type: 'bearer' });
      if (p.endsWith('/auth/users/me')) return json(admin);
      if (/\/dashboard\/org$/.test(p)) return json(dashboard);
      if (/\/org\/search$/.test(p)) return json(searchResults);
      if (/\/org\/requests$/.test(p)) return json(requests);
      if (/\/org\/org-1\/counselors\/[^/]+\/profile$/.test(p)) return json(profile);
      if (/\/org\/org-1\/counselors\/[^/]+\/activity$/.test(p)) return json(activity);
      if (/\/org\/org-1\/counselors$/.test(p)) return json(counselors);
      if (/\/org\/org-1$/.test(p)) return json(orgInfo);
      if (/\/reports\/counts/.test(p)) return json({ unread: 0, pending_review: 2 });
      if (/\/notifications\/unread-count/.test(p)) return json({ unread: 2 });
      if (/\/notifications/.test(p)) return json({ notifications: [], total: 0, unread: 2 });
      if (/\/chat\/rooms/.test(p)) return json({ rooms: [], total: 0 });
      return json({}, 200);
    }
    const asset = path.join(dist, p);
    const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(dist, 'index.html');
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  for (const s of screens) {
    await page.goto(HOST + s.url, { waitUntil: 'load' });
    await page.waitForSelector(s.waitFor, { timeout: 15000 }).catch(() => errors.push(`${width}/${s.key}: ${s.waitFor} 없음`));
    await page.waitForTimeout(700);
    if (s.act) await s.act(page).catch((e) => errors.push(`${width}/${s.key}: act ${e.message.split('\n')[0]}`));
    await page.screenshot({ path: path.join(out, `${s.key}-${width}.png`), fullPage: false });
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const scroller = document.querySelector('.u2-scroll') || doc;
      const isUi = !!document.querySelector('.ui-v2');
      const docOverflow = doc.scrollWidth > doc.clientWidth || document.body.scrollWidth > document.body.clientWidth || scroller.scrollWidth > scroller.clientWidth;
      const small = [];
      document.querySelectorAll('.ui-v2 a, .ui-v2 button, .ui-v2 input:not([type=checkbox]):not([type=radio]), .ui-v2 select, .ui-v2 [role=tab], .ui-v2 textarea').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest('.sr-only')) return;
        if (r.width < 43.5 || r.height < 43.5) small.push(`${el.tagName.toLowerCase()}:${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14)}:${Math.round(r.width)}x${Math.round(r.height)}`);
      });
      const h1 = document.querySelector('.ui-v2 h1');
      const h1Clipped = h1 ? h1.scrollWidth > h1.clientWidth + 1 : null;
      const forbidden = (document.body.innerText.match(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/g) || []);
      // 하단 가림: 모바일 내비 상단 대비 마지막 콘텐츠
      let hidden = false; let gap = null;
      const nav = document.querySelector('.u2-nav');
      if (nav && getComputedStyle(nav.parentElement).display !== 'none' && document.querySelector('.u2-scroll')) {
        const sc = document.querySelector('.u2-scroll'); sc.scrollTop = sc.scrollHeight;
        const navTop = nav.getBoundingClientRect().top;
        const kids = Array.from(sc.querySelectorAll('main > *')).filter((k) => getComputedStyle(k).position !== 'fixed'); // 고정 오버레이(대화상자)는 본문이 아니다
        const lastBottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom).filter((b) => b > 0), 0);
        gap = Math.round(navTop - lastBottom); hidden = lastBottom > navTop + 1;
      }
      return { isUi, docOverflow, small, h1Clipped, forbidden, hidden, gap, navPresent: !!nav, h1Text: h1 ? h1.textContent : null };
    });
    results.push({ width, screen: s.key, ...m });
    if (s.key === 'dashboard' || s.key === 'counselors') {
      const fontCheck = await (async () => {
        const client = await context.newCDPSession(page);
        await client.send('DOM.enable'); await client.send('CSS.enable');
        const { root } = await client.send('DOM.getDocument', { depth: -1 });
        const probe = async (sel) => {
          const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
          if (!nodeId) return null;
          const { fonts: f } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
          return f.map((x) => `${x.familyName}${x.isCustomFont ? ' (웹폰트)' : ' (시스템)'} ×${x.glyphCount}`).join(', ');
        };
        const r = { h1: await probe('.ui-v2 h1'), thead: await probe('.u2-table th'), cell: await probe('.u2-table td'), logo: width >= 768 ? await probe('[data-sidebar-brand] span') : await probe('.u2-logo-word') };
        await client.detach(); return r;
      })().catch((e) => ({ error: e.message }));
      fonts.push({ width, screen: s.key, ...fontCheck });
    }
    await page.screenshot({ path: path.join(out, `${s.key}-${width}-bottom.png`) });
  }
  // 사이드바 락업 실측(데스크톱)
  if (width >= 768) {
    await page.goto(HOST + '/dashboard/org'); await page.waitForSelector('[data-sidebar-brand]').catch(() => errors.push(`${width}: sidebar brand 없음`));
    const lock = await page.evaluate(() => { const b = document.querySelector('[data-sidebar-brand]>div:first-child'); if (!b) return null; const img = b.querySelector('img').getBoundingClientRect(); const sp = b.querySelector('span'); const cs = getComputedStyle(sp); return { symbolH: Math.round(img.height * 100) / 100, font: cs.fontFamily.slice(0, 40), size: cs.fontSize, weight: cs.fontWeight, gap: getComputedStyle(b).gap }; });
    results.push({ width, screen: 'sidebar-lockup', lock });
  }
  await context.close();
}
// prefers-reduced-motion
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', (s) => s.close());
  await context.addInitScript((u) => localStorage.setItem('mb_user', JSON.stringify(u)), admin);
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname;
    const json = (b) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': HOST, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(b) });
    if (url.hostname !== 'sdd321.local') return route.abort();
    if (route.request().method() === 'OPTIONS') return json({});
    if (p.startsWith('/api/')) { if (p.endsWith('/auth/refresh')) return json({ access_token: 's', token_type: 'bearer' }); if (p.endsWith('/auth/users/me')) return json(admin); if (/dashboard\/org$/.test(p)) return json(dashboard); if (/org-1\/counselors$/.test(p)) return json(counselors); return json({}); }
    const asset = path.join(dist, p); const file = path.extname(p) && fs.existsSync(asset) ? asset : path.join(dist, 'index.html');
    return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.goto(HOST + '/dashboard/org'); await page.waitForSelector('.ui-v2 h1', { timeout: 15000 }).catch(() => errors.push('reduced: h1 없음'));
  const probe = await page.evaluate(() => Array.from(document.querySelectorAll('.ui-v2, .ui-v2 *')).filter((el) => { const cs = getComputedStyle(el); return (parseFloat(cs.transitionDuration) > 0.001 && cs.transitionDuration !== '0s') || (cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0.001); }).length);
  results.push({ screen: 'reduced-motion', animatedElements: probe });
  await context.close();
}
await browser.close();
const summary = { contrast, results, fonts, errors };
fs.writeFileSync(path.join(out, 'measure.json'), JSON.stringify(summary, null, 2));
const bad = results.filter((r) => r.screen && r.width && r.screen !== 'sidebar-lockup' && (!r.isUi || r.docOverflow || r.small?.length || r.h1Clipped || r.forbidden?.length || r.hidden));
console.log(JSON.stringify({ total: results.length, bad: bad.map((b) => ({ w: b.width, s: b.screen, isUi: b.isUi, docOverflow: b.docOverflow, small: b.small, h1Clipped: b.h1Clipped, forbidden: b.forbidden, hidden: b.hidden, gap: b.gap })), errors, minContrast: Math.min(...contrast.map((c) => c.ratio)) }, null, 1));
