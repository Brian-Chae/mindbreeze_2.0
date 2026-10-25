// Android 하단 플로팅 메뉴 아래 여백을 기존(12px + safe-area)의 절반으로 줄인다.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('android 전용 하단 메뉴 여백 규칙이 기존 값의 절반이다', () => {
  const css = readFileSync('src/components/layout/floating-bottom-nav.css', 'utf8');
  expect(css).toContain('bottom:calc(12px + env(safe-area-inset-bottom,0px))');
  expect(css).toMatch(/html\[data-platform="android"\] \.floating-bottom-nav\{bottom:calc\(\(12px \+ env\(safe-area-inset-bottom,0px\)\) \/ 2\)\}/);
});

test('main.tsx 가 html 에 플랫폼을 표시한다', () => {
  expect(readFileSync('src/main.tsx', 'utf8')).toContain('document.documentElement.dataset.platform = getPlatform()');
});
