// SDD-222 V32 — 네이티브 전용 플러그인이 웹 실행 경로에 정적 import 로 들어가지 않는다
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('V32 네이티브 플러그인 정적 import 금지', () => {
  const sources = walk(join(__dirname, '..', 'src'));
  const STATIC_IMPORT = /^\s*import\s+(?!type\b)[^;]*from\s+['"](@capawesome-team\/capacitor-android-foreground-service|@capacitor-community\/keep-awake)['"]/m;

  it('foreground-service·keep-awake 는 동적 import 로만 로드한다', () => {
    const offenders = sources.filter((file) => STATIC_IMPORT.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('두 플러그인이 실제로 동적 import 로 사용되고 있다(가드가 공회전하지 않음)', () => {
    const all = sources.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(all).toMatch(/import\(['"]@capawesome-team\/capacitor-android-foreground-service['"]\)/);
    expect(all).toMatch(/import\(['"]@capacitor-community\/keep-awake['"]\)/);
  });
});
