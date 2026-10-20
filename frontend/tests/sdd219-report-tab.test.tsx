// @vitest-environment jsdom
/**
 * SDD-219 T9·T10 (verify B1·B3·B4): 리포트 탭 연결 검증.
 *
 * - 218 리포트 관리가 표시되는가 (B1)
 * - 일괄 작업에 pending 건이 남으면 수동 재시도 안내가 나오는가 (B3)
 * - 회차 조회 실패가 빈 목록으로 숨지 않는가 / 출석 0 하드코딩이 없는가 (carryover)
 * - 부모 재렌더에도 조회가 반복되지 않는가 / 20회차 호출 수 측정 (B4)
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportJob } from '../src/lib/api/class-reports';
import { classOperationsApi } from '../src/lib/api/class-operations';
import { ClassReportJobPanel } from '../src/components/class/structure/class-report-job';
import { ClassReportTab, type ReportTabSession } from '../src/components/class/structure/class-report-tab';

vi.mock('../src/lib/api/class-reports', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api/class-reports')>('../src/lib/api/class-reports');
  return { ...actual, classReportsApi: { createJob: vi.fn(), getJob: vi.fn(), retryJob: vi.fn(), memberTrend: vi.fn(), sessionSummary: vi.fn() } };
});
vi.mock('../src/lib/api/class-operations', () => ({ classOperationsApi: { reports: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};

const makeSessions = (count: number): ReportTabSession[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `s${i + 1}`, seq: i + 1, scheduled_at: '2026-03-04T10:00:00Z', status: 'completed', host: { name: '김지도' },
  }));
const reportsMock = vi.mocked(classOperationsApi.reports);

describe('리포트 탭 연결', () => {
  it('B1 218 리포트 관리를 보여주고 완료 회차만 조회한다', async () => {
    reportsMock.mockResolvedValue({ reports: [{ id: 'r1', type: 'client', status: 'pending_review' }] });
    const sessions = [...makeSessions(2), { id: 'x', seq: 3, scheduled_at: null, status: 'cancelled', host: null }];
    await render(<ClassReportTab classId="c1" sessions={sessions} />);
    expect(container.textContent).toContain('지금 확인할 일');
    expect(container.textContent).toContain('전체 2회차');
    expect(reportsMock).toHaveBeenCalledTimes(2);
  });

  it('출석 집계를 0 으로 꾸미지 않는다', async () => {
    reportsMock.mockResolvedValue({ reports: [] });
    await render(<ClassReportTab classId="c1" sessions={makeSessions(1)} />);
    expect(container.textContent).toContain('출석 집계 미확인');
    expect(container.textContent).not.toContain('출석 0');
  });

  it('회차 조회 실패를 빈 목록으로 삼키지 않고 안내한다', async () => {
    reportsMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ reports: [] });
    await render(<ClassReportTab classId="c1" sessions={makeSessions(2)} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('1개 회차의 리포트를 불러오지 못했어요');
  });

  it('부모가 같은 sessions 로 재렌더해도 조회를 반복하지 않는다', async () => {
    reportsMock.mockResolvedValue({ reports: [] });
    const sessions = makeSessions(3);
    await render(<ClassReportTab classId="c1" sessions={sessions} />);
    await render(<ClassReportTab classId="c1" sessions={sessions} />);
    expect(reportsMock).toHaveBeenCalledTimes(3);
  });

  it('B4 20회차 클래스는 진입 시 회차별 목록 조회 20건을 병렬로 낸다(측정)', async () => {
    reportsMock.mockResolvedValue({ reports: [] });
    await render(<ClassReportTab classId="c1" sessions={makeSessions(20)} />);
    expect(reportsMock).toHaveBeenCalledTimes(20);
  });
});

describe('일괄 작업 pending 안내', () => {
  const baseJob = (status: ReportJob['status'], state: 'pending' | 'succeeded'): ReportJob => ({
    job_id: 'job-12345678', class_id: 'c1', action: 'approve', status, on_behalf: false, accepted: 2, excluded: [],
    items: [
      { report_id: 'a', state: 'succeeded', reason_code: null, retriable: false, approved_by: null, processed_at: null, error_message: null },
      { report_id: 'b', state, reason_code: null, retriable: false, approved_by: null, processed_at: null, error_message: null },
    ],
  });

  it('B3 완료됐는데 pending 이 남으면 수동 재시도 안내를 보인다', async () => {
    await render(<ClassReportJobPanel classId="c1" job={baseJob('completed', 'pending')} />);
    expect(container.textContent).toContain('1건이 아직 처리되지 않았어요');
    expect(container.textContent).toContain('직접 다시 시도');
  });

  it('pending 이 없으면 안내를 보이지 않는다', async () => {
    await render(<ClassReportJobPanel classId="c1" job={baseJob('completed', 'succeeded')} />);
    expect(container.textContent).not.toContain('아직 처리되지 않았어요');
  });
});
