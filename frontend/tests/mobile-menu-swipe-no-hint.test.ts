import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 첫 로드 안내 팝업("본문을 좌우로 밀어…")은 제거됐다 — 다시 생기지 않도록 고정한다.
describe('모바일 메뉴 스와이프 안내 팝업 제거', () => {
  it.each(['src/components/layout/AppShell.tsx', 'src/components/client/ClientShell.tsx', 'src/hooks/use-mobile-menu-swipe.ts'])('%s 에 안내 팝업이 없다', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toContain('본문을 좌우로 밀어');
    expect(source).not.toContain('showHint');
  });
});
