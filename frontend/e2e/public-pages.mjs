// 공개 페이지 실제 렌더 검증: 로그인하지 않은 브라우저로 /account-deletion·/support 를 열어
// 제목·핵심 안내 문구가 보이고 NotFound·로그인 화면이 아님을 확인한다(SPA라 HTTP 200만으로는 판정하지 않는다).
// 실행: npm run build && npx vite preview --port 4173 &  →  node e2e/public-pages.mjs
//   BASE_URL(기본 http://127.0.0.1:4173), EVIDENCE_DIR(스크린샷 저장 경로, 비우면 저장 안 함),
//   PW_CHANNEL(예: chrome — Playwright 브라우저 대신 설치된 Chrome 사용)
// 종료코드: 0=전부 통과, 1=하나 이상 실패.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || '';
const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];
const PAGES = [
  {
    path: '/account-deletion',
    title: 'MIND BREEZE 계정 삭제 요청',
    texts: ['룩시드랩스', '앱에서 계정 삭제하기', '앱 밖에서 삭제 요청하기', '삭제·보관되는 데이터와 기간', '30일 후 영구 삭제', '90일', 'admin-mindbreeze@looxidlabs.com'],
    selectors: ['input[type="email"]', 'a[href^="mailto:admin-mindbreeze@looxidlabs.com"]'],
  },
  {
    path: '/support',
    title: 'MIND BREEZE 고객 지원',
    texts: ['뇌과학 기반 명상 클래스 서비스', '룩시드랩스', '자주 묻는 질문', 'admin-mindbreeze@looxidlabs.com'],
    selectors: ['a[href="/account-deletion"]', 'a[href^="mailto:admin-mindbreeze@looxidlabs.com"]'],
  },
];
const NOT_FOUND_TEXT = '페이지를 찾을 수 없습니다';

if (EVIDENCE_DIR) mkdirSync(EVIDENCE_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
const results = [];

for (const viewport of VIEWPORTS) {
  for (const target of PAGES) {
    // 새 컨텍스트 = 저장된 로그인 정보 없음
    const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    const name = `${viewport.name} ${target.path}`;
    try {
      await page.goto(`${BASE}${target.path}`, { waitUntil: 'networkidle' });
      await page.locator('h1').first().waitFor({ timeout: 15000 });
      const pathname = new URL(page.url()).pathname;
      if (pathname !== target.path) throw new Error(`경로가 바뀜: ${pathname}`);
      const h1 = (await page.locator('h1').first().textContent())?.trim();
      if (h1 !== target.title) throw new Error(`제목 불일치: ${h1}`);
      const body = await page.locator('body').innerText();
      if (body.includes(NOT_FOUND_TEXT)) throw new Error('NotFound 화면');
      if (await page.locator('#login-email').count()) throw new Error('로그인 화면');
      for (const text of target.texts) if (!body.includes(text)) throw new Error(`문구 없음: ${text}`);
      for (const selector of target.selectors) {
        if (!(await page.locator(selector).first().isVisible())) throw new Error(`요소 안 보임: ${selector}`);
      }
      if (problems.length) throw new Error(problems.slice(0, 2).join(' | '));
      if (EVIDENCE_DIR) {
        const file = `${target.path.slice(1)}-${viewport.name}.png`;
        await page.screenshot({ path: join(EVIDENCE_DIR, file), fullPage: true });
      }
      results.push({ name, ok: true });
      console.log(`PASS  ${name}`);
    } catch (e) {
      results.push({ name, ok: false, error: e.message.split('\n')[0] });
      console.log(`FAIL  ${name} — ${e.message.split('\n')[0]}`);
    }
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
