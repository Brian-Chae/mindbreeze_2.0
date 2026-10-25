// 데스크톱 넓은 화면 본문 폭 1200px 통일 계약. 알림·설정·프로필(672)은 유지한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(__dirname, '../src', p), 'utf8');

describe('넓은 화면 본문 폭 1200 계약', () => {
  it.each([
    'pages/clients/ClientListPage.tsx',
    'pages/clients/ClientProfilePage.tsx',
    'pages/playground/PlaygroundPage.tsx',
  ])('%s 는 독자 최대폭 없이 mb-content를 쓴다', (f) => {
    const s = src(f);
    expect(s).not.toMatch(/max-w-\[1[0-9]{3}px\]|max-w-6xl/);
    expect(s).toContain('max-w-mb-content');
  });

  it.each([
    'components/layout/AppShell.tsx',
    'components/client/ClientShell.tsx',
  ])('%s 는 wide 옵션으로 1200 가운데 프레임을 제공한다', (f) => {
    const s = src(f);
    expect(s).toMatch(/wide\?: boolean/);
    expect(s).toContain('mx-auto w-full max-w-mb-content');
  });

  it.each([
    'pages/reports/ReportListPage.tsx',
    'pages/clients/ClientListPage.tsx',
    'pages/OrgDashboardPage.tsx',
    'pages/admin/ClientManagementPage.tsx',
    'pages/client/ClientAppPage.tsx',
  ])('%s 는 wide 셸을 쓴다', (f) => {
    expect(src(f)).toMatch(/\bwide\b/);
  });

  it('알림·설정·프로필은 672px(max-w-2xl)를 유지한다', () => {
    expect(src('pages/notifications/NotificationCenterPage.tsx')).toContain('max-w-2xl');
    expect(src('components/settings/settings-content.tsx')).toContain('max-w-2xl');
    expect(src('pages/settings/professional-profile-page.tsx')).toContain('max-w-2xl');
  });

  it('홈 내 클래스 카드는 280px 고정이 아니라 컨테이너 4등분이다', () => {
    for (const f of ['components/dashboard/counselor-home.css', 'components/client/home/home-card-parity.css', 'components/client/home/member-home-layout.css']) {
      const s = src(f);
      expect(s).not.toMatch(/\.mc-card\{[^}]*flex:0 0 280px/);
      expect(s).toContain('calc((100% - 48px)/4)');
    }
  });

  it('스크롤 컨테이너는 scrollbar-gutter: stable 로 가운데 열 이동을 막는다', () => {
    expect(src('components/layout/mobile-menu-swipe.css')).toMatch(/\.mobile-menu-swipe-page\.overflow-auto\s*\{[^}]*scrollbar-gutter:\s*stable/);
    expect(src('components/class/structure/structure-shell.css')).toMatch(/\.cs-structure-scroll\s*\{[^}]*scrollbar-gutter:\s*stable/);
  });
});
