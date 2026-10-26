// @vitest-environment node
// Chrome에서 수집한 실제 화면의 계산값을 비교한다(클래스 문자열 추가만 제외).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

interface ElementMetric { class: string; [key: string]: unknown }
interface Measurement {
  name: string; width: number; scrollWidth: number;
  failure: string | null; errors: string[]; unknown: string[];
  texts: ElementMetric[]; touches: ElementMetric[]; spacing: ElementMetric[];
  summary: { smallTextCount: number; smallTouchCount: number; narrowTouchCount: number };
}
const root = resolve(process.cwd(), '../specs/sdd-234-mobile-type-polish/screens');
const read = (phase: string, file: string): Measurement => JSON.parse(readFileSync(resolve(root, phase, file), 'utf8'));
const files = readdirSync(resolve(root, 'after-b')).filter(file => /^B-.+-\d+\.json$/.test(file));
const computed = (rows: ElementMetric[]) => rows.map(({ class: className, ...rest }) => { void className; return rest; });

it('기본 30화면을 빠짐없이 측정했다', () => { expect(files).toHaveLength(30); });
it.each(files)('%s의 모바일 하한 또는 데스크톱 계산값을 검증한다', file => {
  const after = read('after-b', file);
  const before = read('before-b', file);
  expect(after.failure).toBeNull();
  expect(after.errors).toEqual([]);
  expect(after.unknown).toEqual([]);
  if (after.width === 390) {
    expect(after.summary.smallTextCount).toBe(0);
    expect(after.summary.smallTouchCount).toBe(0);
    expect(after.summary.narrowTouchCount).toBe(0);
    expect(after.scrollWidth).toBeLessThanOrEqual(390);
    if (after.name === 'member-classes') {
      expect(after.touches.find(row => row.text === '클래스 신청하기')?.height).toBeGreaterThanOrEqual(48);
    }
  }
  if (after.width >= 768 || after.name === 'host-player') {
    for (const key of ['texts', 'touches', 'spacing'] as const) {
      expect(computed(after[key]), key).toEqual(computed(before[key]));
    }
    expect(after.scrollWidth).toBe(before.scrollWidth);
  }
});
