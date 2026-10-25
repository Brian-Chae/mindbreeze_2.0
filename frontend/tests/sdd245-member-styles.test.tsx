// SDD-245 Task B: 회원 화면 이중 gutter 제거와 공용 버튼 규격 이관을 소스 기준으로 고정한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(__dirname, '..', path), 'utf8');

describe('SDD-245 회원 스타일 통일', () => {
  it('리포트 목록은 셸 gutter 위에 px-4/md:px-8 을 다시 주지 않는다', () => {
    const src = read('src/pages/client/ClientReportListPage.tsx');
    expect(src).not.toContain('px-4 md:px-8 py-4 md:py-6');
    expect(src).toContain('fieldClass(');
  });

  it('세션 목록도 이중 gutter 가 없다', () => {
    expect(read('src/pages/client/ClientSessionListPage.tsx')).not.toContain('px-4 md:px-8');
  });

  it('참여 프로필은 읽기 폭(max-w-2xl)을 유지하되 안쪽 좌우 padding 을 주지 않는다', () => {
    const src = read('src/pages/settings/participation-profile-page.tsx');
    expect(src).toContain('max-w-2xl');
    expect(src).not.toMatch(/max-w-2xl[^"]*px-4/);
    expect(src).not.toContain('md:px-8');
  });

  it.each([
    'src/pages/client/ClientAppPage.tsx',
    'src/pages/client/ClientHomePage.tsx',
    'src/pages/client/member-classes-page.tsx',
    'src/components/reports/ReportDetailView.tsx',
    'src/components/reports/CounselorCommentCard.tsx',
  ])('%s 의 주 CTA 는 buttonClass 를 쓴다', (file) => {
    const src = read(file);
    expect(src).toContain('buttonClass(');
    expect(src).not.toMatch(/className="[^"]*bg-\[#5F0080\][^"]*text-white[^"]*rounded-xl/);
  });
});
