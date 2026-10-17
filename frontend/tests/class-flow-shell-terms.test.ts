// SDD-209 SH7 — 용어 치환 스윕(세션→클래스) 가드 + 배지 키 상수화
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLASS_CHIP_KEYS, CLASS_CHIP_LABELS } from '../src/lib/class/class-labels';

const SRC = resolve(__dirname, '..', 'src');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
/** 화면에 보이는 문구에서 `세션` 을 쓰지 않는 셸형 영역(주석은 제외) */
const SWEPT = [
  'components/class/flow/shell',
  'components/client',
  'pages/client/ClientHomePage.tsx',
  'pages/client/ClientSessionListPage.tsx',
  'pages/client/ClientSessionDetailPage.tsx',
  'pages/client/ClientAppPage.tsx',
  'pages/sessions/SessionListPage.tsx',
  'pages/sessions/SessionDetailPage.tsx',
  'components/layout/SidebarNav.tsx',
  'components/layout/BottomTabBar.tsx',
];

function visibleLiterals(text: string): string[] {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [...noComments.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1|>([^<>{}\n]+)</g)].map((m) => m[2] ?? m[3] ?? '').filter((t) => t.includes('세션'));
}

describe('SH7 용어 치환', () => {
  const files = SWEPT.flatMap((p) => {
    const full = join(SRC, p);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  it('셸형 화면의 사용자 문구에 `세션` 이 없다', () => {
    const hits = files.flatMap((f) => visibleLiterals(readFileSync(f, 'utf8')).map((t) => `${f.replace(SRC, '')}: ${t}`));
    expect(hits).toEqual([]);
  });
});

describe('배지 키 상수', () => {
  it('8개 키가 모두 라벨을 가진다', () => {
    expect([...CLASS_CHIP_KEYS]).toEqual(['ready', 'scheduled', 'soon', 'open', 'live', 'done', 'cancelled', 'invited']);
    for (const key of CLASS_CHIP_KEYS) expect(CLASS_CHIP_LABELS[key]).toBeTruthy();
  });
});
