// @vitest-environment jsdom
// SDD-253: 상태 라벨·계층 행·승인 상태 컴포넌트 단위 검증
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { approverLabel, ageLabel, genderLabel, rowState, DELIVERY_LABELS } from '../src/lib/report-ops-labels';
import { buildHierarchyQuery, type HierarchyDoc } from '../src/lib/api/report-hierarchy';
import ReportApprovalStatus from '../src/components/reports/ReportApprovalStatus';
import type { ReportDto } from '../src/lib/api/reports';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc = (over: Partial<HierarchyDoc> = {}): HierarchyDoc => ({
  report_id: 'r1', type: 'client', status: 'pending_review', generation_status: 'ready',
  approval_required: true, is_read: false, ...over,
});

describe('rowState (A안: 상태 하나 + 단일 주 버튼)', () => {
  it('검토 필요 → 검토 시작', () => {
    const s = rowState(doc());
    expect(s.label).toBe('검토 필요');
    expect(s.action).toBe('검토 시작');
    expect(s.rank).toBe(1);
  });
  it('승인 완료 + 발송 실패 → 발송 실패 / 다시 발송 / 최우선 정렬', () => {
    const s = rowState(doc({ status: 'completed', delivery_status: 'failed' }));
    expect(s.label).toBe('발송 실패');
    expect(s.action).toBe('다시 발송');
    expect(s.rank).toBe(0);
    expect(s.hint).toContain('승인은 완료');
  });
  it('생성 중 → 진행 보기, 승인 완료는 승인 시각·발송 상태를 한 줄로', () => {
    expect(rowState(doc({ status: 'pending_analysis', generation_status: 'processing' })).action).toBe('진행 보기');
    const done = rowState(doc({ status: 'completed', delivery_status: 'sent', approved_at: '2026-10-28T10:00:00Z' }));
    expect(done.label).toBe('승인 완료');
    expect(done.hint).toContain('발송 성공');
    expect(done.action).toBe('열기');
  });
  it('문서 없음은 버튼이 없다', () => {
    expect(rowState(null).action).toBeNull();
  });
  it('점수·순위·좋음/나쁨 표현을 만들지 않는다', () => {
    const all = [rowState(doc()), rowState(null), rowState(doc({ status: 'completed' }))].map((s) => `${s.label}${s.hint}`).join('');
    expect(all).not.toMatch(/점수|순위|등급|좋음|나쁨|종합/);
  });
});

describe('라벨', () => {
  it('성별·만 나이 미확인 처리, 생년월일은 다루지 않는다', () => {
    expect(genderLabel('female')).toBe('여');
    expect(genderLabel(null)).toBe('성별 미확인');
    expect(ageLabel(35)).toBe('만 35세');
    expect(ageLabel(null)).toBe('나이 미확인');
  });
  it('승인자 표기: 자동 승인 / 기존 기록 / 이름·역할', () => {
    expect(approverLabel({ approval_source: 'auto' })).toBe('자동 승인');
    expect(approverLabel({})).toBe('기존 기록 · 승인자 미확인');
    expect(approverLabel({ approved_by_name: '박지현', approved_by_role: 'org_admin' })).toBe('박지현 · 기관관리자');
  });
  it('발송 상태 라벨에 수신함 도착 표현이 없다', () => {
    expect(Object.values(DELIVERY_LABELS).join('')).not.toMatch(/도착|열람/);
  });
});

describe('buildHierarchyQuery', () => {
  it('기본값과 필터를 쿼리로 만든다', () => {
    expect(buildHierarchyQuery({})).toBe('?page=1&limit=10');
    const q = buildHierarchyQuery({ q: ' 김 ', tab: 'failed', counselorId: 'c1', activity: 'meditation', page: 2 });
    expect(q).toContain('q=%EA%B9%80');
    expect(q).toContain('tab=failed');
    expect(q).toContain('counselor_id=c1');
    expect(q).toContain('page=2');
  });
});

describe('ReportApprovalStatus', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  const base = {
    id: 'r1', session_id: 's1', user_id: null, type: 'client', content: {}, pdf_url: null, sent_at: null,
    is_read: false, created_at: null, session_title: null, session_type: null, scheduled_at: null,
    status: 'completed', approved_by_name: '채 상담사', approved_by_role: 'counselor', approved_at: '2026-10-28T10:00:00Z',
  } as ReportDto;

  it('승인자·시각·발송 실패와 다시 발송 버튼을 보여준다(capability 있을 때만)', async () => {
    await act(async () => root.render(
      <ReportApprovalStatus report={{ ...base, delivery_status: 'failed', delivery_failure_code: 'send_failed', capabilities: { can_view: true, can_approve: false, can_edit_comment: false, can_retry_delivery: true } }} onChange={() => {}} />,
    ));
    expect(container.textContent).toContain('승인 완료 · 채 상담사 · 상담사');
    expect(container.textContent).toContain('발송 실패');
    expect(container.textContent).toContain('메일 서비스가 발송을 받지 않았습니다');
    expect(container.textContent).toContain('다시 발송');
  });
  it('capability 가 없으면 다시 발송 버튼이 없다', async () => {
    await act(async () => root.render(<ReportApprovalStatus report={{ ...base, delivery_status: 'failed' }} onChange={() => {}} />));
    expect(container.textContent).not.toContain('다시 발송');
  });
  it('발송 성공은 수신함 도착이 아니라는 안내를 붙인다', async () => {
    await act(async () => root.render(<ReportApprovalStatus report={{ ...base, delivery_status: 'sent' }} onChange={() => {}} />));
    expect(container.textContent).toContain('발송 성공');
    expect(container.textContent).toContain('수신함 도착이나 열람을 뜻하지 않습니다');
  });
  it('승인 전 리포트에는 렌더하지 않는다', async () => {
    await act(async () => root.render(<ReportApprovalStatus report={{ ...base, status: 'pending_review' }} onChange={() => {}} />));
    expect(container.textContent).toBe('');
  });
});
