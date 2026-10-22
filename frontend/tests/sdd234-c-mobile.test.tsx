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
