// SDD-245: 토큰 원본(JSON) ↔ 생성 CSS ↔ Tailwind preset이 같은 수치를 가리키는지 고정한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ds = resolve(__dirname, '../../design-system');
const read = (p: string) => readFileSync(resolve(ds, p), 'utf8');
const css = read('build/outputs/css/tokens.base.css');
const preset = read('build/outputs/tailwind/preset.cjs');
const radius = JSON.parse(read('tokens/system/radius.json')).radius;
const page = JSON.parse(read('tokens/ui/page.json')).page;

const cssVar = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1].trim();
const presetValue = (key: string) => new RegExp(`'${key}':\\s*'([^']+)'`).exec(preset)?.[1];

describe('SDD-245 토큰 계약', () => {
  it('radius-lg: 원본 JSON · 생성 CSS · Tailwind mb-lg가 모두 20px이다', () => {
    expect(radius.lg.$value).toBe('20px');
    expect(cssVar('radius-lg')).toBe('20px');
    expect(presetValue('mb-lg')).toBe('20px');
  });

  it('페이지 gutter/프레임/제목 토큰이 원본과 생성 CSS에서 일치한다', () => {
    expect(cssVar('page-gutter-mobile')).toBe(page.gutter.mobile.$value);
    expect(cssVar('page-gutter-tablet')).toBe(page.gutter.tablet.$value);
    expect(cssVar('page-gutter-desktop')).toBe(page.gutter.desktop.$value);
    expect(cssVar('page-frame-max')).toBe(page.frameMax.$value);
    expect(cssVar('page-content-max')).toBe(page.contentMax.$value);
    expect(cssVar('page-section-gap')).toBe(page.sectionGap.$value);
    expect(cssVar('page-title-size')).toBe(page.title.size.$value);
    expect(cssVar('page-title-weight')).toBe(page.title.weight.$value);
  });

  it('콘텐츠 최대폭 = 프레임 최대폭 − 데스크톱 gutter×2, Tailwind 별칭과 같다', () => {
    const px = (v: string) => parseInt(v, 10);
    expect(px(page.contentMax.$value)).toBe(px(page.frameMax.$value) - px(page.gutter.desktop.$value) * 2);
    expect(presetValue('mb-frame')).toBe(page.frameMax.$value);
    expect(presetValue('mb-content')).toBe(page.contentMax.$value);
  });
});
