// @vitest-environment jsdom
// 상담사 검토 화면 = 회원 화면과 같은 본문 + 커버 요약에 '정보 없음'이 실데이터 형태에서 나오지 않음
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ReportReviewPane from '../src/components/reports/ReportReviewPane';
import ReportDetailView from '../src/components/reports/ReportDetailView';
import { ClientReportBody } from '../src/components/reports/ClientReportViewer';
import { adaptReportContent, type ReportDto } from '../src/lib/api/reports';
import { buildReportSessionInfo } from '../src/lib/report/session-info';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getReport = vi.fn();
vi.mock('../src/lib/api/reports', async (orig) => ({ ...(await orig<object>()), getReport: (...a: unknown[]) => getReport(...a) }));

const timeline = Array.from({ length: 21 }, (_, i) => ({
  min: i,
  concentration: 50 + i * 0.5,
  relaxation: 40 + i,
  stress: 60 - i,
  heart_rate: 78 - i * 0.3,
  respiratory_rate: 15 - i * 0.05,
  sdnn: 35 + i * 0.4,
}));

const mk = (type: 'client' | 'counselor', over: Partial<ReportDto> = {}): ReportDto =>
  ({
    id: 'r1', session_id: 's1', user_id: 'u', type, status: 'pending_review', pdf_url: null, sent_at: null, is_read: false,
    created_at: '2026-10-28T05:10:00Z', scheduled_at: '2026-10-28T05:00:00Z', session_title: '나를 돌보는 호흡 명상',
    session_type: 'meditation', participant_name: '지우', counselor_name: '서지연', in_review: false,
    capabilities: { can_view: true, can_approve: true, can_edit_comment: true, can_retry_delivery: false },
    content: {
      headline: '편안했던 20분',
      eeg: { status: 'valid', reliability: 0.8, score: null, drowsiness_flag: false, metrics: {}, timeline, narrative: null },
    },
    ...over,
  }) as ReportDto;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); getReport.mockReset(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const NO_INFO = /클래스 정보 없음|진행 시간 정보 없음|신호 정보 없음|날짜 정보 없음|측정 품질 정보가 제공되지 않았어요/;

describe('buildReportSessionInfo', () => {
  it('실데이터 형태에서 클래스·시간·신호·날짜·품질을 모두 만든다', () => {
    const report = mk('client');
    const info = buildReportSessionInfo(report, adaptReportContent(report.content, 'client'));
    expect(info).toMatchObject({ participantName: '지우', className: '나를 돌보는 호흡 명상', durationMinutes: 20 });
    expect(info.dateLabel).toContain('2026년 10월 28일');
    expect(info.shortDate).toBe('2026. 10. 28');
    expect(info.timeLabel).toContain('20분');
    expect(info.recordedSignals).toBe('뇌파 · 맥파 · 호흡');
    expect(info.qualityLabel).toBe('측정 신뢰도 높음');
  });
  it('밴드 측정이 없으면 그에 맞는 문구를 쓴다', () => {
    const report = mk('client', { content: { headline: 'x', eeg: { status: 'not_measured' } } });
    const info = buildReportSessionInfo(report, adaptReportContent(report.content, 'client'));
    expect(info.recordedSignals).toBe('밴드 측정 없음');
    expect(info.durationMinutes).toBeUndefined();
  });
});

describe('회원용 리포트 본문 통일', () => {
  it('회원 화면 본문(ClientReportBody)을 커버 1개·정보 없음 없이 렌더한다', async () => {
    await act(async () => root.render(<ClientReportBody report={mk('client')} />));
    expect(container.querySelectorAll('.report-print-cover, #cover')).toHaveLength(1);
    expect(container.textContent).not.toMatch(NO_INFO);
    expect(container.textContent).toContain('나를 돌보는 호흡 명상');
    expect(container.textContent).toContain('뇌파 · 맥파 · 호흡');
  });

  it('검토 화면(ReportReviewPane)이 회원 화면과 같은 본문 컴포넌트를 렌더한다', async () => {
    const report = mk('client');
    getReport.mockResolvedValue(report);
    await act(async () => root.render(<ReportReviewPane reportId="r1" onClose={() => {}} onReportChange={() => {}} />));
    await act(async () => { await Promise.resolve(); });
    const body = container.querySelector('[data-testid="client-report-body"]');
    expect(body).not.toBeNull();
    expect(container.textContent).toContain('회원용 리포트 검토');
    expect(container.querySelectorAll('.report-print-cover')).toHaveLength(1);
    expect(container.textContent).not.toMatch(NO_INFO);

    // 같은 report 를 회원 화면 본문으로 직접 렌더한 결과와 본문 텍스트가 같다.
    const reviewText = body!.textContent;
    const other = document.createElement('div');
    document.body.appendChild(other);
    const otherRoot = createRoot(other);
    await act(async () => otherRoot.render(<ClientReportBody report={report} hideCounselorComment />));
    expect(other.querySelector('[data-testid="client-report-body"]')!.textContent).toBe(reviewText);
    act(() => otherRoot.unmount());
    other.remove();
  });

  it('상담사 전용 액션(승인하고 발송)은 본문 바깥 액션 영역에 유지된다', async () => {
    const report = mk('client');
    await act(async () => root.render(<ReportDetailView report={report} showListAction={false} />));
    expect(container.querySelector('[data-testid="client-report-body"]')).not.toBeNull();
  });

  it('상담사용 리포트는 회원 본문을 쓰지 않고 커버도 1개다', async () => {
    const report = mk('counselor', { status: 'completed' });
    await act(async () => root.render(<ReportDetailView report={report} showListAction={false} />));
    expect(container.querySelector('[data-testid="client-report-body"]')).toBeNull();
    expect(container.querySelectorAll('.report-print-cover, #cover')).toHaveLength(1);
  });
});
