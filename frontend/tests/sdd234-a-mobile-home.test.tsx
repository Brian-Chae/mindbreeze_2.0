// @vitest-environment node
// 실제 Chrome 라우트의 계산 스타일로 모바일 하한과 데스크톱 회귀를 검증한다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, expect, it } from 'vitest';

const spec = path.resolve(import.meta.dirname, '../../specs/sdd-234-mobile-type-polish');
interface ElementMetric { text: string; class: string; selector: string; fontSize: number; height: number; width: number }
interface Metrics {
  failure: string | null; errors: string[]; unknown: string[]; scrollWidth: number;
  texts: ElementMetric[]; touches: ElementMetric[]; spacing: ElementMetric[];
  violations: { smallText: ElementMetric[]; smallTouch: ElementMetric[]; narrowTouch: ElementMetric[] };
}
const read = (phase: string, role: string, width: number): Metrics => JSON.parse(readFileSync(path.join(spec, `screens/${phase}/A-${role}-home-${width}.json`), 'utf8'));
beforeAll(() => {
  execFileSync(process.execPath, [path.join(spec, 'measure.cjs'), '--area=A', '--phase=test-a', '--widths=390,768,1440', '--overwrite'], { timeout: 120000, stdio: 'pipe' });
}, 125000);
for (const role of ['member', 'host']) {
  it(`${role}: 모바일 본문·라벨 하한, 44px 터치, 가로 넘침 없음`, () => {
    const m = read('test-a', role, 390);
    expect([m.failure, ...m.errors, ...m.unknown]).toEqual([null]);
    expect(m.scrollWidth).toBeLessThanOrEqual(390);
    expect(m.violations.smallTouch).toEqual([]);
    expect(m.violations.narrowTouch).toEqual([]);
    const primary = m.touches.find(x => x.text === (role === 'member' ? '코드로 바로 입장' : '지금 바로 시작'));
    expect(primary?.height).toBeGreaterThanOrEqual(48);
    // PR #60 유지 대상: 기존 레일의 아바타 이니셜/읽지 않은 개수만 제외한다.
    const remaining = m.violations.smallText.filter(x => !(x.text === '1' && x.class.includes('rounded-full')) && !(x.text === '샘' && x.class.includes('h-10')));
    expect(remaining.map(x => [x.text, x.fontSize])).toEqual([]);
    expect(m.texts.filter(x => x.class === 'mc-chip').every(x => x.fontSize >= 13)).toBe(true);
    expect(m.texts.filter(x => x.class === 'mc-muted').every(x => x.fontSize >= 15)).toBe(true);
  });
  for (const width of [768, 1440]) it(`${role}: ${width}px 계산 글자·터치·간격 불변`, () => {
    const before = read('before-a', role, width), after = read('test-a', role, width);
    for (const key of ['texts', 'touches', 'spacing'] as const) {
      const styles = (items: ElementMetric[]) => items.map(({ class: _class, ...item }) => item);
      expect(styles(after[key])).toEqual(styles(before[key]));
    }
  });
}
