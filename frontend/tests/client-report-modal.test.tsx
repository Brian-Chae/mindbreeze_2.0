// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ClientSessionDetailPage from '../src/pages/client/ClientSessionDetailPage';
import ClientReportDetailPage from '../src/pages/client/ClientReportDetailPage';
import { ClientReportDetailModal } from '../src/pages/client/ClientReportDetailModal';
import { getSession, type SessionDto } from '../src/lib/api/session';
import ClientReportListPage from '../src/pages/client/ClientReportListPage';
import { getReport, listReports, type ReportDto } from '../src/lib/api/reports';

vi.mock('../src/lib/api/reports', async (original) => ({
  ...await original<typeof import('../src/lib/api/reports')>(),
  getReport: vi.fn(), listReports: vi.fn(),
}));
vi.mock('../src/lib/api/session', () => ({ getSession: vi.fn() }));
vi.mock('../src/hooks/useSessionLiveSocket', () => ({ useSessionLiveSocket: () => ({ isReady: true }) }));
// 셸의 알림/채팅 소켓은 리포트 진입 검증 범위 밖이다.
vi.mock('../src/components/client/ClientShell', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const report: ReportDto = {
  id: 'report-1', session_id: 'session-1', user_id: 'client-1', type: 'client',
  content: { headline: '오늘의 기록', counselor_comment: '편안한 하루 보내세요', eeg: { status: 'not_measured' } },
  pdf_url: '/report.pdf', sent_at: null, is_read: false, created_at: null,
  session_title: '명상 수업', session_type: 'meditation', scheduled_at: null,
  subjective_state: { scope: 'participant', before: null, after: { arousal: 3, valence: 4, emotion: 5, note: '마음이 편안해요', recorded_at: null } },
};
let root: Root;
let container: HTMLDivElement;
function Location() { return <output>{useLocation().pathname}</output>; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom에 없는 브라우저 dialog API만 보완한다.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector<HTMLButtonElement>('button')?.focus();
  };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(listReports).mockResolvedValue({ reports: [report], total: 1 });
  vi.mocked(getReport).mockResolvedValue(report);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  document.body.style.overflow = 'auto';
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.clearAllMocks();
  document.body.style.overflow = '';
});
async function openReport() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/app/reports']}><ClientReportListPage /><Location /></MemoryRouter>));
  const trigger = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('명상 수업'));
  expect(trigger, '리포트 카드는 페이지 이동 링크 대신 모달 버튼이어야 한다').toBeDefined();
  trigger!.focus();
  await act(async () => trigger!.click());
  return trigger!;
}
it.each(['button', 'cancel', 'overlay'])('%s로 닫으면 배경과 포커스를 복원한다', async (method) => {
  const trigger = await openReport();
  const dialog = document.querySelector('dialog')!;
  expect(dialog?.open).toBe(true);
  expect(container.querySelector('output')?.textContent).toBe('/app/reports');
  expect(document.body.style.overflow).toBe('hidden');
  expect(dialog.textContent).toContain('편안한 하루 보내세요');
  expect(dialog.textContent).toContain('마음이 편안해요');
  expect(dialog.querySelector('[data-testid="eeg-section"]')).toBeNull();
  expect(dialog.querySelector('a')?.getAttribute('href')).toBe('/report.pdf');
  await act(async () => dialog.querySelector('h1')?.click());
  expect(document.querySelector('dialog')).toBe(dialog);
  await act(async () => {
    if (method === 'cancel') dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    else if (method === 'overlay') dialog.click();
    else dialog.querySelector<HTMLButtonElement>('[aria-label="리포트 닫기"]')!.click();
  });
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).toBe('auto');
});
it('조회 중 상태와 실패 메시지를 표시한다', async () => {
  let rejectRequest!: (reason: Error) => void;
  vi.mocked(getReport).mockReturnValue(new Promise((_resolve, reject) => { rejectRequest = reject; }));
  await openReport();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('불러오는 중');
  await act(async () => rejectRequest(new Error('리포트 조회 실패')));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('리포트 조회 실패');
  expect(document.querySelector('dialog button')).not.toBeNull();
});

it('완료 세션에서 실제 리포트 ID로 모달을 열고 세션 화면을 유지한다', async () => {
  const session: SessionDto = {
    id: 'session-1', type: 'meditation', custom_type_name: null, status: 'completed',
    host_id: 'host-1', scheduled_at: null, access_code: null, started_at: null, ended_at: null,
    duration_min: 30, title: '명상 수업', notes: null, max_participants: 1,
    location_type: 'online', participant_mode: 'one_on_one', linkband_mode: 'none',
    webrtc_room_id: null, sfu_enabled: false, record_audio: false, record_video: false,
    created_at: '2026-10-04', participants: [], waitlist_count: 0,
  };
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(getReport).mockImplementation(async (id) => {
    if (id !== 'report-1') throw new Error('잘못된 리포트 ID');
    return report;
  });
  await act(async () => root.render(<MemoryRouter initialEntries={['/app/sessions/session-1']}><ClientSessionDetailPage /><Location /></MemoryRouter>));
  const trigger = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '리포트 보기')!;
  trigger.focus();
  await act(async () => trigger.click());
  expect(document.querySelector('dialog')?.textContent).toContain('편안한 하루 보내세요');
  expect(container.querySelector('output')?.textContent).toBe('/app/sessions/session-1');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="리포트 닫기"]')!.click());
  expect(document.activeElement).toBe(trigger);
});
it('세션에 리포트가 없으면 닫을 수 있는 오류 상태를 표시한다', async () => {
  vi.mocked(listReports).mockResolvedValue({ reports: [], total: 0 });
  await act(async () => root.render(<ClientReportDetailModal sessionId="missing" onClose={() => root.render(null)} />));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('리포트를 찾을 수 없습니다');
});
it('직접 URL 진입은 공용 본문과 목록 이동을 유지한다', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/app/reports/report-1']}><ClientReportDetailPage /><Location /></MemoryRouter>));
  expect(container.textContent).toContain('편안한 하루 보내세요');
  expect(document.querySelector('dialog')).toBeNull();
  const back = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '목록으로')!;
  await act(async () => back.click());
  expect(container.querySelector('output')?.textContent).toBe('/app/reports');
});
it('닫힌 모달의 늦은 응답은 다시 열린 리포트를 덮어쓰지 않는다', async () => {
  let resolveOld!: (value: ReportDto) => void;
  vi.mocked(getReport).mockImplementation((id) => id === 'old'
    ? new Promise((resolve) => { resolveOld = resolve; })
    : Promise.resolve(report));
  await act(async () => root.render(<ClientReportDetailModal reportId="old" onClose={() => {}} />));
  await act(async () => root.render(<ClientReportDetailModal reportId="report-1" onClose={() => {}} />));
  await act(async () => resolveOld({ ...report, session_title: '이전 리포트' }));
  expect(document.querySelector('dialog')?.textContent).toContain('명상 수업');
  expect(document.querySelector('dialog')?.textContent).not.toContain('이전 리포트');
});
