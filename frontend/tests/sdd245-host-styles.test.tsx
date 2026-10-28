// SDD-245 Task C: 상담사·공통 업무 화면의 공용 UI 이관 지점을 소스 기준으로 고정한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(__dirname, '../src', path), 'utf8');

describe('SDD-245 호스트 화면 스타일', () => {
  it('호스트 클래스 목록·상세·회차 목록 래퍼가 1200 폭 토큰을 쓴다', () => {
    for (const file of ['pages/classes/host-classes-page.tsx', 'pages/classes/host-class-detail-page.tsx', 'pages/sessions/SessionListPage.tsx']) {
      const src = read(file);
      expect(src, file).not.toContain('max-w-6xl');
      expect(src, file).toContain('max-w-mb-content');
    }
  });

  it('회차 상세의 읽기 폭 960은 유지한다', () => {
    expect(read('components/class/structure/class-operations.css')).toContain('max-width:960px');
  });

  it('회원 초대(/clients/invite)가 공용 버튼·카드·입력과 셸 gutter를 쓴다', () => {
    const src = read('pages/clients/ClientInvitePage.tsx');
    expect(src).toContain("from '../../components/ui'");
    expect(src).toContain('buttonClass(');
    expect(src).toContain('cardClass(');
    expect(src).toContain('fieldClass(');
    expect(src).toContain('text-[22px] font-bold');
    expect(src).not.toContain('text-2xl font-semibold');
    expect(src).not.toContain('rounded-md');
    // 이중 inset 제거: p-6 한 번 더 주지 않고 셸 기본 16/32/40 gutter
    expect(src).not.toMatch(/min-h-screen bg-surface-canvas p-6/);
    expect(src).toContain('px-4 py-4 md:px-8 md:py-6 lg:px-10');
    expect(src).toContain('max-w-xl');
  });

  it('자격 증명 화면이 22/700 제목과 공용 카드·버튼·입력을 쓴다', () => {
    const src = read('pages/credentials/CredentialDashboardPage.tsx');
    expect(src).not.toContain('text-2xl font-light');
    expect(src).toContain('text-[22px] font-bold');
    expect(src).toContain('cardClass(');
    expect(src).toContain('buttonClass(');
    expect(src).toContain("fieldClass('select')");
    expect(src).not.toContain('p-4 sm:p-8');
  });

  it('회원 목록 필터 입력이 공용 fieldClass를 쓴다', () => {
    const src = read('pages/clients/ClientListPage.tsx');
    expect(src).toContain('uiFieldClass');
    expect(src).not.toContain('rounded-[10px] border border-[#DDDEE7]');
  });

  it('주 CTA가 buttonClass pill 규격으로 이관됐다', () => {
    for (const file of [
      'components/clients/InviteModal.tsx',
      'components/chat/CreateRoomModal.tsx',
      'components/settings/ConfirmDialog.tsx',
      'pages/onboarding/ClientEssentialsPage.tsx',
      'pages/account-deletion-page.tsx',
    ]) {
      const src = read(file);
      expect(src, file).toContain("buttonClass({ variant: 'primary'");
      expect(src, file).not.toMatch(/className="[^"]*bg-\[#5F0080\][^"]*text-white[^"]*rounded-(xl|lg|md)/);
    }
  });

  it('상담사 홈(DashboardPage)은 이번 이관에서 건드리지 않는다', () => {
    expect(read('pages/DashboardPage.tsx')).not.toContain("from '../components/ui'");
  });

  it('요약·클래스 리포트 문서 레이아웃의 모바일 좌우 여백이 16이다', () => {
    expect(read('components/session-summary/session-summary.css')).toContain('.ss-layout{display:block;padding:16px 16px 32px}');
    expect(read('components/class-report/class-report.css')).toContain('.cr-report .cr-layout{display:block;padding:16px 16px 32px}');
  });
});
