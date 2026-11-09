// SDD-320 K — 중간 폭(768~1023) 정합 / 회원 설정 셸 / 채팅 폭 / 코치 설정 회원형 (소스 대조)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
describe('SDD-320 K', () => {
  const mid = read('src/styles/ui-v2-mid.css');
  it('768~1023 에서 레거시 aside 숨김 + 하단 메뉴 노출', () => {
    expect(mid).toContain('@media (min-width: 768px) and (max-width: 1023px)');
    expect(mid).toContain('aside.md\\:flex { display: none !important; }');
    expect(mid).toContain('floating-bottom-nav.md\\:hidden');
  });
  it('중간 폭 CSS 는 회원 쉘·코치 스코프에서만 불러온다', () => {
    expect(read('src/components/ui-v2/ui-v2-client-shell.tsx')).toContain('ui-v2-mid.css');
    expect(read('src/components/ui-v2/ui-v2-coach-scope.ts')).toContain('ui-v2-mid.css');
  });
  it('ui-v2 에서 /app/settings 도 D안 설정으로', () => expect(read('src/pages/client/ClientAppPage.tsx')).toContain("pathname === '/app/settings'"));
  it('채팅 좌우 패딩 0(본문 48px 와 이중 적용 방지)', () => expect(read('src/styles/ui-v2-pc.css')).toContain('.u2-chat { padding: 0 0 32px; max-width: none; }'));
  it('코치 설정은 회원 설정과 같은 2열 구조', () => {
    expect(read('src/pages/coach/ui-v2/ui-v2-coach-settings-page.tsx')).toContain('u2-pc-cols u2-pc-cols--settings');
    expect(read('src/styles/ui-v2-coach-pc.css')).toContain('minmax(0, 1fr) minmax(0, 1.2fr)');
  });
  it('회원 메뉴: 설정 아래 플레이그라운드 → 알림, 가로선은 ::before', () => {
    expect(read('src/styles/ui-v2-pc.css')).toContain('.u2-side-item[href="/playground"]::before');
  });
});
