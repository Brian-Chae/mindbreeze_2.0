// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import ClientReportViewer from '../src/components/reports/ClientReportViewer';
import { type ReportDto } from '../src/lib/api/reports';

const require = createRequire(import.meta.url);
const report: ReportDto = {
  id: 'sample', session_id: 'sample', user_id: 'sample', type: 'client',
  content: { headline: '명상 기록', counselor_comment: '긴 한글 서사와 https://example.test/' + '가나다'.repeat(100),
    narrative: { journey: '호흡을 따라 돌아봅니다. '.repeat(60), body: '몸', mind: '마음', closing: '마무리' }, eeg: { status: 'not_measured' } },
  pdf_url: '/sample.pdf', sent_at: null, is_read: true, created_at: null,
};
let browser: Browser;
let css: string;
beforeAll(async () => {
  const config = require('../tailwind.config.cjs');
  const generated = await postcss([tailwindcss({ ...config, content: ['./src/components/reports/*.tsx', './src/components/legal/wellness-notice.tsx'] })])
    .process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
  css = readFileSync(resolve('../design-system/build/outputs/css/tokens.base.css'), 'utf8') + generated.css
    + readFileSync(resolve('src/components/reports/narrative-sections.css'), 'utf8');
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
it.each([390, 767])('%ipx 긴 서사·미측정 리포트는 글자와 터치 하한 및 가로 폭을 지킨다', async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.setContent(`<style>${css}</style>${renderToStaticMarkup(<ClientReportViewer report={report} onClose={() => {}} />)}`);
  const result = await page.evaluate(() => {
    const visible = [...document.querySelectorAll<HTMLElement>('body *')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height && !el.closest('[aria-hidden="true"]'));
    return {
      small: visible.filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent?.trim()) && parseFloat(getComputedStyle(el).fontSize) < 13).map(el => el.textContent),
      touch: visible.filter(el => el.matches('a,button,summary') && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).map(el => el.textContent),
      overflow: document.documentElement.scrollWidth > innerWidth,
      narrative: getComputedStyle(document.querySelector('.journey-quote')!).fontSize,
      lineHeight: getComputedStyle(document.querySelector('.journey-quote')!).lineHeight,
      eeg: !!document.querySelector('[data-testid="eeg-section"]'),
    };
  });
  expect(result).toEqual({ small: [], touch: [], overflow: false, narrative: '16px', lineHeight: '26px', eeg: false });
  expect(await page.locator('body').textContent()).toContain(report.content!.counselor_comment);
  await page.close();
});

it('390px에서 글자 200% 확대 후에도 긴 서사와 마지막 동작에 접근한다', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<style>${css}</style>${renderToStaticMarkup(<ClientReportViewer report={report} onClose={() => {}} />)}`);
  await page.evaluate(() => {
    // 부모·자식이 중복 확대되지 않도록 원래 계산값을 먼저 수집한다.
    const sizes = [...document.querySelectorAll<HTMLElement>('body *')].map(el => ({ el, size: parseFloat(getComputedStyle(el).fontSize), leading: parseFloat(getComputedStyle(el).lineHeight) }));
    for (const { el, size, leading } of sizes) {
      el.style.fontSize = `${size * 2}px`;
      if (Number.isFinite(leading)) el.style.lineHeight = `${leading * 2}px`;
    }
  });
  await page.getByRole('link', { name: 'PDF 다운로드' }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await page.getByRole('link', { name: 'PDF 다운로드' }).boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y < 844).toBe(true);
  await page.close();
});
