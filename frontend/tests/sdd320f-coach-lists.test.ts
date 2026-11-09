// SDD-320 F-1 — 코치 목록 3종(ui-v2): 탭 매핑·필터·그룹·분기·격리(소스 대조)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HierarchyGroup } from '../src/lib/api/report-hierarchy';
import { filterClassRows, filterReportRows, flattenReportRows, groupClassRows, groupRowsByTitle, isDeliveryFailed, reportTabCounts, serverTabFor, type ClassRowV2 } from '../src/lib/coach-lists-v2';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FORBIDDEN = /점수|종합점수|좋음|나쁨|보증|100%/;
const doc = (over: Record<string, unknown>) => ({ report_id: 'r', type: 'client', status: 'pending_review', generation_status: 'ready', approval_required: true, is_read: false, ...over });
const groups = [{
  key: 'g', kind: 'class', class_id: 'c', title: '마음숲', needs_review: 1, session_total: 1,
  sessions: [{ session_id: 's1', title: '3회차', type: 'meditation', scheduled_at: null, counselor_id: 'x', counselor_name: '하늘', participant_count: 3, matched_count: 3, needs_review: 1, delivery_failed: 1,
    common_report: doc({ report_id: 'common', status: 'completed', approval_required: false }),
    members: [
      { participant_id: 'a', name: '다온', gender: null, age: null, is_guest: false, client_report: doc({ report_id: 'ra' }) },
      { participant_id: 'b', name: '이든', gender: null, age: null, is_guest: false, client_report: doc({ report_id: 'rb', status: 'completed', delivery_status: 'failed' }) },
      { participant_id: 'c', name: '하람', gender: null, age: null, is_guest: false, client_report: doc({ report_id: 'rc', status: 'completed', delivery_status: 'sent' }) },
      { participant_id: 'd', name: '서우', gender: null, age: null, is_guest: false, client_report: null },
    ] }],
}] as unknown as HierarchyGroup[];

describe('리포트 탭 매핑(시안 검토 대기/승인 ↔ 실제 상태)', () => {
  const rows = flattenReportRows(groups);
  it('리포트 없는 회원은 제외, 회차 공통 문서는 별도 행', () => {
    expect(rows.map((r) => r.who)).toEqual(['코치용 · 회차 공통', '다온', '이든', '하람']);
  });
  it('검토 필요 → 검토 대기 탭, 승인 완료·발송 실패 → 승인 탭', () => {
    expect(rows.find((r) => r.who === '다온')?.tab).toBe('review');
    expect(rows.find((r) => r.who === '이든')?.tab).toBe('approved');
    expect(rows.find((r) => r.who === '하람')?.tab).toBe('approved');
  });
  it('발송 실패는 사라지지 않고 승인 탭 필터·배지로 유지', () => {
    expect(rows.find((r) => r.who === '이든')?.deliveryFailed).toBe(true);
    expect(filterReportRows(rows, 'approved', 'failed').map((r) => r.who)).toEqual(['이든']);
    expect(filterReportRows(rows, 'approved', 'all').length).toBe(3);
    expect(reportTabCounts(rows).deliveryFailed).toBe(1);
    expect(isDeliveryFailed(null)).toBe(false);
  });
  it('서버 계층 탭 매핑', () => {
    expect(serverTabFor('review', 'all')).toBe('needs_review');
    expect(serverTabFor('approved', 'all')).toBe('all');
    expect(serverTabFor('approved', 'failed')).toBe('failed');
  });
  it('그룹핑은 클래스·회차·코치 제목 기준', () => expect(groupRowsByTitle(rows)).toHaveLength(1));
});

describe('클래스 목록 필터·그룹', () => {
  const base = { instant: false, progress: '', nextAt: null, nextSeq: null, host: '', hasOpen: false, openSessionId: null, canEnter: false, statusLabel: '' };
  const rows: ClassRowV2[] = [
    { ...base, id: '1', title: '마음숲', status: 'active' }, { ...base, id: '2', title: '저녁 쉼', status: 'completed' }, { ...base, id: '3', title: '즉석 명상', status: 'active', instant: true },
  ];
  it('검색·상태·즉석 필터', () => {
    expect(filterClassRows(rows, 'all', '쉼').map((r) => r.id)).toEqual(['2']);
    expect(filterClassRows(rows, 'instant', '').map((r) => r.id)).toEqual(['3']);
    expect(filterClassRows(rows, 'active', '').map((r) => r.id)).toEqual(['1', '3']);
  });
  it('상태별 그룹은 비어 있는 그룹을 만들지 않는다', () => {
    expect(groupClassRows(rows, 'status').map((g) => g.title)).toEqual(['진행 중', '완료']);
    expect(groupClassRows(rows, 'none')).toHaveLength(1);
  });
});

describe('분기·격리', () => {
  const app = read('src/App.tsx');
  it('3개 목록은 플래그 ∧ counselor 에서만 ui-v2, 청크는 플래그 삼항 안', () => {
    expect(app).toMatch(/const useV2 = import\.meta\.env\.VITE_UI_V2 === 'true' && \(role === 'counselor' \|\| \(role === 'org_admin' && !orgLegacy\)\);\n  return useV2 \? <Suspense fallback=\{null\}><V2 \/>/);
    // 11/9 대표 지시: 리포트 목록은 운영 웹 레이아웃(레거시 ReportListPage)을 그대로 쓴다
    expect(app).toContain('<CoachAwareList V2={LegacyReportsPage} Legacy={LegacyReportsPage} />');
    for (const n of ['classes', 'clients']) expect(app).toMatch(new RegExp(`VITE_UI_V2 === 'true'\\s*\\n?\\s*\\? import\\('\\./pages/coach/ui-v2/ui-v2-coach-${n}-page'\\)`));
  });
  it('기존 3개 레거시 목록 파일은 수정하지 않았다', () => {
    for (const f of ['src/pages/classes/host-classes-page.tsx', 'src/pages/clients/ClientListPage.tsx', 'src/pages/reports/ReportListPage.tsx']) expect(read(f)).not.toMatch(/u2f|ui-v2/);
  });
  it('기존 기능 진입점 유지: 새 클래스·즉석 시작·회원 초대·일괄 승인·자동 승인·샘플', () => {
    expect(read('src/pages/coach/ui-v2/ui-v2-coach-classes-page.tsx')).toContain('ClassCreateAction');
    const clients = read('src/pages/coach/ui-v2/ui-v2-coach-clients-page.tsx');
    expect(clients).toContain('InviteModal'); expect(clients).toContain('listClients');
    const reports = read('src/pages/coach/ui-v2/ui-v2-coach-reports-page.tsx');
    for (const k of ['approveAllReports', 'setAutoApprove', 'ReportSampleModal', 'BulkApproveModal']) expect(reports).toContain(k);
  });
  it('금지 표현 없음', () => {
    for (const f of ['src/lib/coach-lists-v2.ts', 'src/pages/coach/ui-v2/ui-v2-coach-classes-page.tsx', 'src/pages/coach/ui-v2/ui-v2-coach-clients-page.tsx', 'src/pages/coach/ui-v2/ui-v2-coach-reports-page.tsx']) expect(read(f)).not.toMatch(FORBIDDEN);
  });
});
