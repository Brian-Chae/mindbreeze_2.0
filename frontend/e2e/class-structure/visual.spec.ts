import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { caseManifest, viewports } from './cases';
import { expect, installApiFixtures, prepareRole, test } from './fixtures';
import type { Page } from 'playwright/test';

const comparable = caseManifest.filter((entry) => entry.classification !== 'X' && entry.viewport);
const outputRoot = resolve(process.cwd(), 'e2e/class-structure/out');

async function measurePage(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const targetSelector = 'a,button,input,select,textarea,[role="button"],[role="tab"]';
    const originalScroll = { x: window.scrollX, y: window.scrollY };
    const targets = [...document.querySelectorAll<HTMLElement>(targetSelector)].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    const targetSizes = targets.map((element) => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.innerText.trim().slice(0, 40) || element.tagName.toLowerCase(), width: rect.width, height: rect.height, effectiveWidth: rect.width, effectiveHeight: rect.height };
    });
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    const fontSizes = textNodes.flatMap((node) => {
      const value = node.textContent?.trim() ?? '';
      const parent = node.parentElement;
      if (!value || !parent || parent.getClientRects().length === 0) return [];
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
      return [{ text: value.slice(0, 60), fontSize: Number.parseFloat(style.fontSize) }];
    });
    const clippedTexts = [...document.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
      const hasDirectText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
      if (!hasDirectText || element.getClientRects().length === 0) return [];
      const style = getComputedStyle(element);
      const clipped = (style.overflowX === 'hidden' || style.overflowX === 'clip') && element.scrollWidth > element.clientWidth + 1
        || (style.overflowY === 'hidden' || style.overflowY === 'clip') && element.scrollHeight > element.clientHeight + 1;
      return clipped ? [{ text: element.innerText.trim().slice(0, 60), overflowX: element.scrollWidth - element.clientWidth, overflowY: element.scrollHeight - element.clientHeight }] : [];
    });
    window.scrollTo(originalScroll.x, originalScroll.y);
    return {
      viewport: { width, height, dpr: window.devicePixelRatio },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - width), verticalOverflow: Math.max(0, document.documentElement.scrollHeight - height) },
      controls: { count: targetSizes.length, under44: targetSizes.filter((item) => item.effectiveWidth < 44 || item.effectiveHeight < 44), minimumEffectiveWidth: targetSizes.length ? Math.min(...targetSizes.map((item) => item.effectiveWidth)) : null, minimumEffectiveHeight: targetSizes.length ? Math.min(...targetSizes.map((item) => item.effectiveHeight)) : null },
      text: { count: fontSizes.length, under12: fontSizes.filter((item) => item.fontSize < 12), minimumFontSize: fontSizes.length ? Math.min(...fontSizes.map((item) => item.fontSize)) : null },
      clippedTexts,
    };
  });
}

async function exactPixelDiff(page: Page, reference: Buffer, actual: Buffer) {
  return page.evaluate(async ({ referenceData, actualData }) => {
    const decode = (source: string) => new Promise<HTMLImageElement>((resolveImage, rejectImage) => {
      const image = new Image();
      image.onload = () => resolveImage(image);
      image.onerror = () => rejectImage(new Error('캡처 이미지를 읽지 못했습니다.'));
      image.src = source;
    });
    const [referenceImage, actualImage] = await Promise.all([decode(referenceData), decode(actualData)]);
    const width = Math.max(referenceImage.width, actualImage.width);
    const height = Math.max(referenceImage.height, actualImage.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('픽셀 비교용 캔버스를 만들 수 없습니다.');
    context.clearRect(0, 0, width, height);
    context.drawImage(referenceImage, 0, 0);
    const referencePixels = context.getImageData(0, 0, width, height).data;
    context.clearRect(0, 0, width, height);
    context.drawImage(actualImage, 0, 0);
    const actualPixels = context.getImageData(0, 0, width, height).data;
    let changedPixels = 0;
    for (let index = 0; index < referencePixels.length; index += 4) {
      if (referencePixels[index] !== actualPixels[index] || referencePixels[index + 1] !== actualPixels[index + 1] || referencePixels[index + 2] !== actualPixels[index + 2] || referencePixels[index + 3] !== actualPixels[index + 3]) changedPixels += 1;
    }
    return { width, height, totalPixels: width * height, changedPixels, ratio: changedPixels / (width * height) };
  }, {
    referenceData: `data:image/png;base64,${reference.toString('base64')}`,
    actualData: `data:image/png;base64,${actual.toString('base64')}`,
  });
}

for (const viewport of viewports) {
  test.describe(`${viewport.name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const entry of comparable.filter((item) => item.viewport?.name === viewport.name)) {
      test(`${entry.screen_id}/${entry.case_id} 캡처·레이아웃 측정`, async ({ page }) => {
        await installApiFixtures(page, entry.role);
        await prepareRole(page, entry.role);
        await mkdir(outputRoot, { recursive: true });
        const outputName = `${entry.screen_id}-${entry.case_id}-${viewport.name}`;
        const referencePath = resolve(outputRoot, `${outputName}-reference.png`);
        const actualPath = resolve(outputRoot, `${outputName}-actual.png`);
        const metricsPath = resolve(outputRoot, `${outputName}-metrics.json`);

        await page.goto(entry.prototype_url);
        await expect(page.locator('body')).toBeVisible();
        const referenceMetrics = await measurePage(page);
        const referenceScreenshot = await page.screenshot({ path: referencePath, fullPage: true });

        await page.goto(entry.app_url);
        await expect(page).toHaveURL(new RegExp(`${new URL(entry.app_url).pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[?#])`));
        const area = entry.screen_id.startsWith('CN') ? 'counseling' : 'meditation';
        await expect(page.locator(`[data-area="${area}"]`).first(), '로그인·리다이렉트 화면을 구조 화면 통과로 세지 않습니다.').toBeVisible();
        const appMetrics = await measurePage(page);
        const actualScreenshot = await page.screenshot({ path: actualPath, fullPage: true });
        const pixelDiff = await exactPixelDiff(page, referenceScreenshot, actualScreenshot);
        const result = {
          screen_id: entry.screen_id,
          case_id: entry.case_id,
          classification: entry.classification,
          viewport,
          fixture_id: entry.fixture_id,
          prototype_url: entry.prototype_url,
          app_url: entry.app_url,
          referencePath,
          actualPath,
          referenceMetrics,
          appMetrics,
          pixelDiff,
          obviousLayoutBreak: appMetrics.document.horizontalOverflow > 0 || appMetrics.clippedTexts.length > 0,
        };
        await writeFile(metricsPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        expect(appMetrics.viewport.dpr).toBe(1);
        test.info().annotations.push({ type: 'visual-metrics', description: `${metricsPath}; exact pixel diff ratio ${pixelDiff.ratio}` });
      });
    }
  });
}
