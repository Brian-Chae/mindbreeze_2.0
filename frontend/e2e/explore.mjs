// SDD-207 야간 탐색기: 역할별로 화면을 순회하며 문제를 수집한다. 읽기 전용(링크 이동만).
// 실행: E2E_PASSWORD=... node e2e/explore.mjs  → e2e/explore-result.json
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'https://dev.mindbreeze.looxidlabs.com';
const PW = process.env.E2E_PASSWORD;
const D = 'e2e.looxidlabs.com';
const ROLES = [
  { role: 'client', email: `e2e-client@${D}`, home: '/app' },
  { role: 'counselor', email: `e2e-counselor@${D}`, home: '/dashboard' },
  { role: 'org_admin', email: `e2e-orgadmin@${D}`, home: '/dashboard/org' },
];
const MAX_PAGES = Number(process.env.MAX_PAGES || 30);
const SKIP = /logout|\/login|\/register|\/invite|\/join|\/o\/|report-view|\/design|\/reset-password|\/set-password|\/membership-invite|\/forgot-password|^\/live|\/live$|\/player/;
const BAD_TEXT = /\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]|\{\{|\}\}|Invalid Date/;
// 알려진 무해 콘솔 오류(필요 시 추가)
const NOISE = /favicon|ResizeObserver|Download the React DevTools|websocket|WebSocket|socket\.io|net::ERR_ABORTED|Failed to load resource.*(sw\.js|manifest)/i;

if (!PW) { console.error('E2E_PASSWORD 필요'); process.exit(2); }
const norm = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n').split('?')[0];

const browser = await chromium.launch({ headless: true });
const findings = [];
const visitedAll = {};
const add = (role, path, check, detail) => findings.push({ role, path: norm(path), check, detail: String(detail).slice(0, 200) });

for (const R of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let cur = '/';
  page.on('pageerror', (e) => add(R.role, cur, 'js_error', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) add(R.role, cur, 'console_error', m.text()); });
  page.on('response', (r) => {
    const u = r.url();
    if (!u.includes('/api/') || r.request().method() !== 'GET') return;
    const s = r.status();
    if (s >= 500) add(R.role, cur, 'api_5xx', `${s} ${new URL(u).pathname}`);
    else if (s >= 400 && s !== 401) add(R.role, cur, 'api_4xx', `${s} ${new URL(u).pathname}`);
  });
  await page.goto(`${BASE}/login?role=${R.role}`, { waitUntil: 'domcontentloaded' });
  await page.click(`#login-tab-${R.role}`);
  await page.fill('#login-email', R.email);
  await page.fill('#login-password', PW);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((u) => u.pathname.startsWith(R.home), { timeout: 20000 }).catch(() => add(R.role, '/login', 'login_failed', R.email));

  const queue = [R.home], seen = new Set(), visited = [];
  while (queue.length && visited.length < MAX_PAGES) {
    const path = queue.shift();
    const key = norm(path);
    if (seen.has(key) || SKIP.test(path)) continue;
    seen.add(key);
    cur = path;
    try { await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) { add(R.role, path, 'load_timeout', e.message.split('\n')[0]); continue; }
    await page.waitForTimeout(600);
    visited.push(key);
    const info = await page.evaluate(() => ({
      text: document.body.innerText.slice(0, 20000),
      heads: [...document.querySelectorAll('h2,h3')].map((e) => e.innerText.trim()).filter(Boolean),
      brokenImgs: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).map((i) => i.src.slice(-60)),
      links: [...new Set([...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')))],
    }));
    if (info.text.trim().length < 20) add(R.role, path, 'empty_page', '본문 거의 없음');
    const m = info.text.match(BAD_TEXT); if (m) add(R.role, path, 'bad_text', m[0]);
    const dup = info.heads.filter((h, i, a) => a.indexOf(h) !== i); if (dup.length) add(R.role, path, 'dup_heading', dup[0]);
    if (info.brokenImgs.length) add(R.role, path, 'broken_image', info.brokenImgs[0]);
    for (const l of info.links) if (!seen.has(norm(l)) && !SKIP.test(l)) queue.push(l);
  }
  // 모바일 가로 넘침: 방문한 화면 재방문
  const mctx = await browser.newContext({ viewport: { width: Number(process.env.MOBILE_W || 390), height: 844 } });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/login?role=${R.role}`, { waitUntil: 'domcontentloaded' });
  await mp.click(`#login-tab-${R.role}`); await mp.fill('#login-email', R.email); await mp.fill('#login-password', PW);
  await mp.locator('form button[type=submit]').click();
  await mp.waitForURL((u) => u.pathname.startsWith(R.home), { timeout: 20000 }).catch(() => {});
  for (const v of visited.filter((x) => !x.includes(':'))) {
    try {
      await mp.goto(`${BASE}${v}`, { waitUntil: 'networkidle', timeout: 30000 });
      // 문서 전체 넘침 + (body 가 잘라내더라도) 스크롤 컨테이너 밖에서 화면 폭을 넘는 요소
      const o = await mp.evaluate(() => {
        const iw = innerWidth;
        const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const clipped = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const ox = getComputedStyle(n).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true; } return false; };
        const bad = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > iw + 2 && getComputedStyle(e).position !== 'fixed' && !clipped(e); });
        return { doc, n: bad.length, sample: bad[0] ? `${bad[0].tagName.toLowerCase()}.${String(bad[0].className).slice(0, 40)}` : '' };
      });
      if (o.doc > 2 || o.n > 0) add(R.role, v, 'mobile_overflow', `넘침 ${o.doc}px, 요소 ${o.n}개 (${o.sample})`);
    } catch { /* 무시 */ }
  }
  visitedAll[R.role] = visited;
  await mctx.close(); await ctx.close();
}
await browser.close();

// 중복 제거(역할 무관 동일 경로·점검·내용은 1건)
const uniq = new Map();
for (const f of findings) { const k = `${f.path}|${f.check}|${f.detail.slice(0, 80)}`; if (!uniq.has(k)) uniq.set(k, { ...f, roles: [f.role] }); else if (!uniq.get(k).roles.includes(f.role)) uniq.get(k).roles.push(f.role); }
const out = { base: BASE, at: new Date().toISOString(), pages: visitedAll, findings: [...uniq.values()] };
writeFileSync(new URL('./explore-result.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`탐색 완료: ${Object.entries(visitedAll).map(([r, v]) => `${r} ${v.length}화면`).join(', ')} / 문제 ${out.findings.length}건`);
for (const f of out.findings) console.log(` - [${f.roles.join(',')}] ${f.path} ${f.check}: ${f.detail}`);
