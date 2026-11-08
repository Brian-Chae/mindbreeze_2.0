// SDD-320 F-2 — 코치 리포트 상세 2열: 승인·코멘트 핸들러가 기존 ReportDetailView 와 같은 함수를 호출하는지(소스 대조) + 승인 노출 판정 단위
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canShowApprove } from '../src/pages/coach/ui-v2/ui-v2-coach-report-detail-page';
import type { ReportDto } from '../src/lib/api/reports';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const base = { id: 'r', status: 'pending_review', sent_at: null } as unknown as ReportDto;

describe('승인 노출 판정(ReportDetailView 와 같은 규칙)', () => {
  it('서버 capability 가 있으면 그 값이 우선', () => {
    expect(canShowApprove({ ...base, capabilities: { can_view: true, can_approve: true, can_edit_comment: true, can_retry_delivery: false } }, false, true, false)).toBe(true);
    expect(canShowApprove({ ...base, capabilities: { can_view: true, can_approve: false, can_edit_comment: true, can_retry_delivery: false } }, true, true, false)).toBe(false);
  });
  it('구 응답은 코치 + 검토중일 때만', () => {
    expect(canShowApprove(base, true, true, false)).toBe(true);
    expect(canShowApprove({ ...base, status: 'completed' } as ReportDto, true, true, false)).toBe(false);
    expect(canShowApprove(base, false, true, false)).toBe(false);
  });
  it('이미 승인했거나 직원이 아니면 숨김', () => {
    expect(canShowApprove(base, true, true, true)).toBe(false);
    expect(canShowApprove(base, true, false, false)).toBe(false);
  });
});

describe('핸들러 보존(기존 상세와 동일 API 호출)', () => {
  const v2 = read('src/pages/coach/ui-v2/ui-v2-coach-report-detail-page.tsx');
  const legacy = read('src/components/reports/ReportDetailView.tsx');
  it('승인: approveAndSendReport 후 getReport 로 갱신', () => {
    expect(legacy).toMatch(/await approveAndSendReport\(report\.id!\);[\s\S]*await getReport\(report\.id!\)/);
    expect(v2).toMatch(/await approveAndSendReport\(current\.id!\);[\s\S]*getReport\(current\.id!\)/);
  });
  it('미저장 코멘트·전달 내용 없음 확인창 문구가 같다', () => {
    for (const msg of ['저장하지 않은 코멘트가 있습니다. 저장하지 않고 승인할까요?', '이 리포트에는 전달할 내용이 없습니다. 코멘트 없이 승인하시겠습니까?']) {
      expect(legacy).toContain(msg); expect(v2).toContain(msg);
    }
  });
  it('코멘트 저장·AI 초안·다시 발송은 기존 컴포넌트를 그대로 렌더', () => {
    for (const c of ['CounselorCommentCard', 'ReportApprovalStatus', 'DataExportButton', 'UploadParticipantNotice']) expect(v2).toContain(`<${c}`);
    expect(v2).toContain('resendReportEmail'); expect(v2).toContain('downloadReportPdf');
  });
  it('코치용 회차 공통 문서는 기존 ReportDetailView 로 위임', () => expect(v2).toMatch(/report\.type !== 'client'[\s\S]*<ReportDetailView/));
  it('코멘트 편집 중에는 읽기 영역에서 같은 코멘트를 숨긴다', () => expect(v2).toContain('hideCounselorComment={showCommentEditor}'));
  it('금지 표현·레거시 수정 없음', () => {
    expect(v2).not.toMatch(/점수|종합점수|좋음|나쁨|보증|100%/);
    expect(legacy).not.toMatch(/u2f|ui-v2/);
    expect(read('src/pages/reports/ReportDetailPage.tsx')).not.toMatch(/u2f|ui-v2/);
  });
  it('App 분기: 플래그 ∧ counselor, 청크는 플래그 삼항 안', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/VITE_UI_V2 === 'true'\s*\n?\s*\? import\('\.\/pages\/coach\/ui-v2\/ui-v2-coach-report-detail-page'\)/);
    expect(app).toContain('V2={CoachUiV2ReportDetailPage} Legacy={ReportDetailPage}');
  });
  it('회원 리포트 본문 재사용은 닫기 버튼만 선택으로 바뀌었다', () => {
    const body = read('src/components/ui-v2/ui-v2-report-body.tsx');
    expect(body).toContain('onClose?: () => void');
    expect(body).toContain('hideCounselorComment');
  });
});
