// @vitest-environment jsdom
// SDD-318 — 리포트 목록 D안: 기능 보존(검색·정렬·그룹·전체 읽음·검토 중 비노출·딥링크 시트) + 장식 아크 접근성.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiV2ReportsPage } from '../src/pages/client/ui-v2/ui-v2-reports-page';
import { UiV2ArcRing } from '../src/components/ui-v2/ui-v2-arc-ring';
import { listReports, markAllReportsRead, getReport, type ReportDto } from '../src/lib/api/reports';

vi.mock('../src/lib/api/reports', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/reports')>()), listReports: vi.fn(), markAllReportsRead: vi.fn(), getReport: vi.fn() }));
vi.mock('../src/components/ui-v2/ui-v2-client-shell', () => ({
  UiV2ClientShell: ({ title, children }: { title: string; children: React.ReactNode }) => <div className="ui-v2"><h1>{title}</h1>{children}</div>,
}));
vi.mock('../src/components/reports/ClientReportViewer', () => ({ default: () => <div>본문</div> }));
vi.mock('../src/components/reports/PastReportsCompare', () => ({ default: () => null }));

const base: ReportDto = {
  id: 'a', session_id: 'sa', user_id: 'c', type: 'client', content: { headline: '호흡에 머문 시간', summary: '호흡으로 돌아오는 연습을 했어요' },
  pdf_url: null, sent_at: '2026-10-01', is_read: false, created_at: '2026-10-01', session_title: '저녁의 호흡',
  session_type: 'meditation', scheduled_at: '2026-10-03T14:05:00', counselor_name: '김코치',
};
const review: ReportDto = { ...base, id: 'b', session_id: 'sb', session_title: '검토 중 리포트', counselor_name: '이코치', sent_at: null, in_review: true, content: { summary: '노출되면 안 되는 내용' } } as ReportDto;
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(listReports).mockReset().mockResolvedValue({ reports: [base, review], total: 2 });
  vi.mocked(markAllReportsRead).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getReport).mockReset().mockResolvedValue(base);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (url = '/app/reports') => act(async () => root.render(<MemoryRouter initialEntries={[url]}><UiV2ReportsPage /></MemoryRouter>));
const btn = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label));

it('코치별 그룹 카드와 전체 읽음·검색·정렬 도구를 보여 주고 검토 중 내용은 숨긴다', async () => {
  await render();
  expect(listReports).toHaveBeenCalledWith({ page: 1, limit: 20 });
  expect(container.textContent).toContain('김코치');
  expect(container.textContent).toContain('이코치');
  expect(container.textContent).toContain('호흡으로 돌아오는 연습을 했어요');
  expect(container.textContent).not.toContain('노출되면 안 되는 내용');
  expect(container.querySelector('input[type="search"]')).not.toBeNull();
  expect(btn('최신순')).toBeTruthy();
  expect(btn('코치별 묶기')?.getAttribute('aria-checked')).toBe('true');
});
it('전체 읽음이 서버 호출 후 버튼을 숨긴다', async () => {
  await render();
  await act(async () => { btn('전체 읽음')!.click(); });
  expect(markAllReportsRead).toHaveBeenCalledTimes(1);
  expect(btn('전체 읽음')).toBeUndefined();
});
it('카드를 누르면 dialog 시트가 열리고 닫기 버튼으로 닫힌다', async () => {
  await render();
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click(); });
  const dialog = document.querySelector('dialog.u2-sheet-dialog');
  expect(dialog).not.toBeNull();
  expect(getReport).toHaveBeenCalledWith('a');
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="리포트 닫기"]')!.click(); });
  expect(document.querySelector('dialog.u2-sheet-dialog')).toBeNull();
});
it('딥링크 ?report=ID 로 시트가 바로 열린다', async () => {
  await render('/app/reports?report=a');
  expect(document.querySelector('dialog.u2-sheet-dialog')).not.toBeNull();
});
it('오류 시 다시 시도, 빈 목록 시 안내를 보여 준다', async () => {
  vi.mocked(listReports).mockRejectedValueOnce(new Error('실패'));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('실패');
  vi.mocked(listReports).mockResolvedValue({ reports: [], total: 0 });
  await act(async () => { btn('다시 시도')!.click(); });
  expect(container.textContent).toContain('아직 리포트가 없어요');
});
it('아크 링은 장식이라 스크린리더에서 숨겨진다', async () => {
  await act(async () => root.render(<UiV2ArcRing variant="hero" />));
  const svg = container.querySelector('svg')!;
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.querySelectorAll('path')).toHaveLength(3);
});
