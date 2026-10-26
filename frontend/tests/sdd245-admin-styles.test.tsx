// SDD-245 Task D: 기관·플랫폼·데이터 센터 화면의 공용 UI 이관 지점을 소스 기준으로 고정한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(__dirname, '../src', path), 'utf8');

describe('SDD-245 기관·플랫폼 화면 스타일', () => {
  it('데이터 센터 본문은 안쪽 padding 으로 gutter 를 다시 주지 않는다(이중 inset 제거)', () => {
    const css = read('pages/data-center/data-center.css');
    const root = css.split('\n').find((line) => line.startsWith('.dc{')) ?? '';
    expect(root).toContain('padding:0');
    expect(root).not.toContain('padding:24px');
    expect(root).toContain('max-width:1200px');
    expect(css).not.toContain('.dc{padding:22px 14px}');
    expect(css).toMatch(/\.dc h1\{font-size:22px;font-weight:700/);
  });

  it('데이터 센터 주 CTA 는 pill + 모바일 48 / 데스크톱 44', () => {
    const css = read('components/data-center/controls.css');
    expect(css).toContain('border-radius: 9999px');
    expect(css).toMatch(/@media \(min-width: 768px\)[\s\S]*min-height: 44px/);
  });

  it('내 가입 신청(/org/requests)이 셸 제목 규격 22/700 과 공용 카드를 쓴다', () => {
    const src = read('pages/org/MyRequestsPage.tsx');
    expect(src).toContain('text-[22px] font-bold');
    expect(src).not.toContain('text-3xl font-light');
    expect(src).not.toContain('p-4 sm:p-8');
    expect(src).toContain('cardClass(');
  });

  it('상담센터 검색(/org/search)이 22/700 제목과 공용 버튼·입력을 쓴다', () => {
    const src = read('pages/org/OrgSearchPage.tsx');
    expect(src).toContain('text-[22px] font-bold');
    expect(src).toContain('<Button');
    expect(src).toContain('fieldClass(');
  });

  it('기관 홈 초대 발송 CTA 와 플랫폼 홈 등록 CTA 가 buttonClass 를 쓴다', () => {
    // 초대 폼은 공용 컴포넌트(counselor-invite-section)로 이동 — 대시보드·구성원 페이지 공용
    const org = read('components/org/counselor-invite-section.tsx');
    expect(org).toContain("buttonClass({ className: 'w-full md:w-auto' })");
    expect(org).not.toContain('h-[42px]');
    const platform = read('pages/admin/OrgManagementPage.tsx');
    expect(platform).toContain('buttonClass(');
    expect(platform).toContain("cardClass('default', 'mb-8')");
  });

  it('검토 상세(/admin/reviews/:type/:id)는 1024 중앙 정렬이 아니라 표준 프레임을 쓴다', () => {
    const src = read('pages/admin/AdminReviewDetailPage.tsx');
    expect(src).not.toContain('max-w-5xl');
    expect(src).toContain('<PageFrame>');
  });

  it('플랫폼 관리 화면의 옛 CTA 클래스(bg-[#5F0080] 직접 지정)가 남지 않는다', () => {
    for (const file of ['pages/admin/UserManagementPage.tsx', 'pages/admin/ClientManagementPage.tsx', 'pages/admin/SignupApplicationsPage.tsx', 'pages/admin/AdminReviewListPage.tsx']) {
      const src = read(file);
      expect(src, file).not.toMatch(/className="[^"]*bg-\[#5F0080\][^"]*text-white/);
    }
  });

  it('기관 모달 액션 컴포넌트가 공용 버튼·입력 클래스를 쓴다', () => {
    for (const file of ['components/admin/org-management-actions.tsx', 'components/admin/org-detail-modal.tsx', 'components/admin/primary-admin-edit.tsx']) {
      const src = read(file);
      expect(src, file).toContain("from '../ui'");
      expect(src, file).not.toContain("'rounded-lg border border-[#DDDEE7] bg-white px-3 py-2 text-sm");
    }
  });
});
