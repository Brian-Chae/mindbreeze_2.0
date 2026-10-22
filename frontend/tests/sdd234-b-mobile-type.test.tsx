// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';

let browser: Browser;
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const files = [
  '../design-system/build/outputs/css/tokens.base.css',
  'src/components/class/player/shared/player-tokens.css',
  'src/components/class/player/shared/player-shared.css',
  'src/components/class/player/member/member-player.css',
  'src/components/class/flow/shared/flow-shared.css',
  'src/components/class/flow/member/member-flow.css',
  'src/components/class/structure/structure-shell.css',
];
const css = () => files.map(read).join('\n').replace(/@import[^;]+;/g, '') +
  read('src/components/class/structure/member-class-views.tsx').split('return <style>{`')[1].split('`}</style>')[0];
beforeAll(async () => { browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true }); });
afterAll(async () => { await browser?.close(); });

it.each([390, 767])('%ipx에서 보조 13·본문 15/16·라벨 14 하한을 적용한다', async width => {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  try {
    await page.setContent(`<style>${css()}</style><main class="cs-structure"><div class="mc-stack"><div class="mc-grid"><article class="mc-card"><span class="mc-chip">진행 중</span><p class="mc-muted">다음 회차 안내</p></article></div><span class="cs-state-chip">예정</span></div></main><main class="pz-root"><span class="mav-tag">필수</span><p class="fl-sub">입장 전 안내</p><label class="fl-label">이름</label><p class="fm-ft">설문 도움말</p><span class="mp-pip__chip">상담사</span><span class="pz-dk"><span class="pz-dk__label">조용한 신호</span></span></main>`);
    for (const [selector, minimum] of [['.mc-chip', 13], ['.mc-muted', 15], ['.cs-state-chip', 13], ['.mav-tag', 13], ['.fl-sub', 16], ['.fl-label', 14], ['.fm-ft', 13], ['.mp-pip__chip', 13], ['.pz-dk__label', 13]] as const) {
      expect(await page.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize)), selector).toBeGreaterThanOrEqual(minimum);
    }
  } finally { await page.close(); }
});

it.each([768, 1440])('%ipx에서는 기존 글자 크기를 보존한다', async width => {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  try {
    await page.setContent(`<style>${css()}</style><main class="cs-structure"><div class="mc-stack"><span class="mc-chip">진행 중</span><p class="mc-muted">안내</p></div></main><main class="pz-root"><span class="mav-tag">필수</span><span class="mp-pip__chip">상담사</span><span class="pz-dk"><span class="pz-dk__label">채팅</span></span></main>`);
    for (const [selector, size] of [['.mc-chip', 12], ['.mc-muted', 14], ['.mav-tag', 12], ['.mp-pip__chip', 12], ['.pz-dk__label', 12]] as const) {
      expect(await page.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize)), selector).toBe(size);
    }
  } finally { await page.close(); }
});
