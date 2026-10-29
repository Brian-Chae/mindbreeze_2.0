// @vitest-environment jsdom
// SDD-211 X3 (RX-17~RX-21) — 승인 전 리포트의 회원 화면 `리뷰 중` 표시. 서버 없이 목 응답(in_review 가산 필드)으로 검증한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientHomePage from '../src/pages/client/ClientHomePage';
import ClientReportListPage from '../src/pages/client/ClientReportListPage';
import { ClientReportDetailModal } from '../src/pages/client/ClientReportDetailModal';
import { REPORT_IN_REVIEW_BADGE, REPORT_IN_REVIEW_NOTICE } from '../src/lib/report-review-copy';
import { composeBanned } from '../e2e/class-flow/lib.mjs';
import { getReport, getReportBadgeCounts, listReports, type ReportDto } from '../src/lib/api/reports';
import { listSessions } from '../src/lib/api/session';
import { listNotifications } from '../src/lib/api/notifications';
import { listChatRooms } from '../src/lib/api/chat';
import { useReportStore } from '../src/stores/reportStore';

vi.mock('../src/lib/api/reports', async (original) => ({
  ...await original<typeof import('../src/lib/api/reports')>(),
  getReport: vi.fn(), getReportBadgeCounts: vi.fn(), listReports: vi.fn(), markAllReportsRead: vi.fn(),
}));
vi.mock('../src/lib/api/session', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api/session')>()), listSessions: vi.fn() }));
vi.mock('../src/lib/api/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/notifications')>()), listNotifications: vi.fn(), markRead: vi.fn(),
}));
vi.mock('../src/lib/api/chat', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api/chat')>()), listChatRooms: vi.fn() }));
vi.mock('../src/components/reports/ClientReportViewer', () => ({
  default: () => <div data-testid="viewer">VIEWER-BODY 공유 PDF 다운로드</div>,
}));

const SECRET = 'SECRET-본문-요약';
const approved: ReportDto = {
  id: 'ok', session_id: 's-ok', user_id: 'c', type: 'client', content: { headline: '승인된 기록', summary: '호흡으로 긴장을 풀었어요' },
  pdf_url: '/ok.pdf', sent_at: '2026-10-02', is_read: false, created_at: '2026-10-02', session_title: '승인 클래스',
  session_type: 'meditation', scheduled_at: '2026-10-02T10:00:00', counselor_name: '김상담', status: 'completed',
};
const inReview: ReportDto = {
  ...approved, id: 'rv', session_id: 's-rv', sent_at: null, content: { summary: SECRET }, pdf_url: null, session_title: '리뷰 대상 클래스',
  scheduled_at: '2026-10-03T10:00:00', created_at: '2026-10-03', status: 'pending_review', in_review: true,
};
const readOnlyInReview: ReportDto = { ...inReview, id: 'rv2', session_id: 's-rv2', session_title: '읽은 리뷰 클래스', is_read: true };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(listReports).mockResolvedValue({ reports: [approved, inReview], total: 2 });
  vi.mocked(getReport).mockResolvedValue(inReview);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.clearAllMocks();
  useReportStore.getState().reset();
});
function Where() { return <output data-testid="where">{useLocation().pathname}{useLocation().search}</output>; }
async function renderList() {
  await act(async () => root.render(<MemoryRouter><ClientReportListPage /></MemoryRouter>));
}
function rowOf(title: string): HTMLTableRowElement {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((tr) => tr.textContent?.includes(title))!;
}
function cardOf(title: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.block.md\\:hidden button')).find((b) => b.textContent?.includes(title))!;
}

describe('RX-17 목록', () => {
  it('in_review 행: 배지 `리뷰 중`, 요약·NEW 없음 / 승인 행은 현행 표시 그대로', async () => {
    await renderList();
    const row = rowOf('리뷰 대상 클래스');
    expect(row.textContent).toContain(REPORT_IN_REVIEW_BADGE);
    expect(row.textContent).not.toContain('대기');
    expect(row.textContent).not.toContain('확인 가능');
    expect(row.textContent).not.toContain('NEW');
    expect(row.textContent).not.toContain('아직 읽지 않음');
    expect(row.textContent).not.toContain(SECRET);
    const ok = rowOf('승인 클래스');
    expect(ok.textContent).toContain('확인 가능');
    expect(ok.textContent).toContain('아직 읽지 않음'); // SDD-253: 데스크톱 표는 NEW 대신 의미가 드러나는 표기
    expect(ok.textContent).toContain('호흡으로 긴장을 풀었어요');
    expect(ok.textContent).not.toContain(REPORT_IN_REVIEW_BADGE);
  });
  it('모바일 카드에도 같은 규칙이 적용된다', async () => {
    await renderList();
    const card = cardOf('리뷰 대상 클래스');
    expect(card.textContent).toContain(REPORT_IN_REVIEW_BADGE);
    expect(card.textContent).not.toContain('NEW');
    expect(card.textContent).not.toContain(SECRET);
  });
  it('행 클릭은 기존대로 모달을 연다', async () => {
    await renderList();
    await act(async () => rowOf('리뷰 대상 클래스').click());
    expect(getReport).toHaveBeenCalledWith('rv');
    expect(document.querySelector('dialog')?.textContent).toContain(REPORT_IN_REVIEW_NOTICE);
  });
  it('in_review 가 아닌 행은 그대로(in_review=false 포함)', async () => {
    vi.mocked(listReports).mockResolvedValue({ reports: [{ ...approved, in_review: false }, { ...approved, id: 'w', session_title: '대기 클래스', sent_at: null }], total: 2 });
    await renderList();
    expect(rowOf('대기 클래스').textContent).toContain('대기');
    expect(container.textContent).not.toContain(REPORT_IN_REVIEW_BADGE);
  });
  it('안 읽은 행이 리뷰 중뿐이면 `전체 읽음` 버튼이 없다', async () => {
    vi.mocked(listReports).mockResolvedValue({ reports: [inReview], total: 1 });
    await renderList();
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('전체 읽음'))).toBe(false);
  });
  it('모달이 리뷰 중 리포트를 열어도 목록의 읽음 표시를 바꾸지 않는다', async () => {
    vi.mocked(listReports).mockResolvedValue({ reports: [inReview, readOnlyInReview], total: 2 });
    await renderList();
    await act(async () => rowOf('리뷰 대상 클래스').click());
    expect(rowOf('리뷰 대상 클래스').textContent).not.toContain('NEW');
    expect(useReportStore.getState().unread).toBe(0);
  });
});

describe('RX-18 모달', () => {
  it('in_review 응답은 소프트 페이지: 세션 제목 + 안내 문구, 뷰어·PDF·공유 UI 없음', async () => {
    await act(async () => root.render(<ClientReportDetailModal reportId="rv" onClose={() => undefined} />));
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain('리뷰 대상 클래스');
    expect(dialog.textContent).toContain(REPORT_IN_REVIEW_NOTICE);
    expect(dialog.querySelector('[data-testid="viewer"]')).toBeNull();
    expect(dialog.textContent).not.toMatch(/PDF|공유|다운로드/);
    expect(dialog.textContent).not.toContain(SECRET);
  });
  it('승인된 리포트는 뷰어 그대로', async () => {
    vi.mocked(getReport).mockResolvedValue(approved);
    await act(async () => root.render(<ClientReportDetailModal reportId="ok" onClose={() => undefined} />));
    expect(document.querySelector('[data-testid="viewer"]')).not.toBeNull();
    expect(document.querySelector('dialog')?.textContent).not.toContain(REPORT_IN_REVIEW_NOTICE);
  });
  it('리포트 행이 없으면 기존 오류 문구를 유지한다', async () => {
    vi.mocked(listReports).mockResolvedValue({ reports: [], total: 0 });
    await act(async () => root.render(<ClientReportDetailModal sessionId="missing" onClose={() => undefined} />));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('리포트를 찾을 수 없습니다');
  });
});

describe('RX-19 홈 카드', () => {
  async function renderHome(reports: ReportDto[]) {
    vi.mocked(listSessions).mockResolvedValue({ sessions: [], total: 0 });
    vi.mocked(listReports).mockResolvedValue({ reports, total: reports.length });
    vi.mocked(listNotifications).mockResolvedValue({ notifications: [], total: 0, unread: 0 });
    vi.mocked(listChatRooms).mockResolvedValue({ rooms: [] });
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes><Route path="/app" element={<ClientHomePage />} /><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>,
    ));
    await act(async () => { await Promise.resolve(); });
  }
  function reportCard(title: string): HTMLButtonElement {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('section button')).find((b) => b.textContent?.includes(title))!;
  }
  it('in_review 행에 `리뷰 중` 칩, NEW 없음 / 승인 행은 NEW 유지', async () => {
    await renderHome([approved, inReview]);
    expect(reportCard('리뷰 대상 클래스').textContent).toContain(REPORT_IN_REVIEW_BADGE);
    expect(reportCard('리뷰 대상 클래스').textContent).not.toContain('NEW');
    expect(reportCard('승인 클래스').textContent).toContain('NEW');
    expect(reportCard('승인 클래스').textContent).not.toContain(REPORT_IN_REVIEW_BADGE);
  });
  it('`생성 중` 칩은 generation_status=processing 일 때만, 기존 로직 불변', async () => {
    await renderHome([{ ...inReview, generation_status: 'processing' }, { ...approved, generation_status: 'ready' }]);
    expect(reportCard('리뷰 대상 클래스').textContent).toContain('생성 중');
    expect(reportCard('리뷰 대상 클래스').textContent).toContain(REPORT_IN_REVIEW_BADGE);
    expect(reportCard('승인 클래스').textContent).not.toContain('생성 중');
  });
  it('클릭 이동 경로는 /app/reports?report={id} 로 불변', async () => {
    await renderHome([inReview]);
    await act(async () => reportCard('리뷰 대상 클래스').click());
    expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/app/reports?report=rv');
  });
  it('새 리포트 타일 수에 리뷰 중 행을 세지 않는다', async () => {
    await renderHome([approved, inReview]);
    const tile = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('새 리포트'))!;
    expect(tile.textContent).toContain('1');
  });
});

describe('RX-20 reportStore.refresh', () => {
  it('unread 는 is_read=false 이면서 in_review 가 아닌 행만 센다, pendingReview 집계는 불변', async () => {
    // 집계는 서버(GET /reports/counts)가 목록과 같은 규칙으로 계산한다 — 동치는 backend/tests/test_list_latency_batching.py 가 검증.
    vi.mocked(getReportBadgeCounts).mockResolvedValue({ unread: 2, pending_review: 3 });
    await useReportStore.getState().refresh();
    expect(useReportStore.getState().unread).toBe(2);
    expect(useReportStore.getState().pendingReview).toBe(3);
  });
});

describe('RX-21 문구 가드', () => {
  it('두 문자열이 정확히 일치한다', () => {
    expect(REPORT_IN_REVIEW_BADGE).toBe('리뷰 중');
    expect(REPORT_IN_REVIEW_NOTICE).toBe('리뷰 중이에요. 확인이 끝나면 알려드릴게요.');
  });
  it('용어 금지어(세션|수업|오픈 및 공통 19개) 0건, 해요체, 영문 대문자·그림문자 없음', () => {
    const banned = new RegExp(composeBanned('meditation'));
    for (const text of [REPORT_IN_REVIEW_BADGE, REPORT_IN_REVIEW_NOTICE]) {
      expect(banned.test(text), text).toBe(false);
      expect(/[A-Z]{2,}/.test(text), text).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(text), text).toBe(false);
    }
    expect(REPORT_IN_REVIEW_NOTICE).toMatch(/요\.$/);
  });
  it('새 문구가 들어간 파일은 기존 `세션` 가드(주석 제외 리터럴)도 통과한다', () => {
    const files = ['pages/client/ClientReportListPage.tsx', 'pages/client/ClientHomePage.tsx', 'pages/client/ClientReportDetailModal.tsx', 'lib/report-review-copy.ts'];
    for (const file of files) {
      const text = readFileSync(resolve(__dirname, '../src', file), 'utf8');
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const hits = [...stripped.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1|>([^<>{}\n]+)</g)].map((m) => m[2] ?? m[3] ?? '').filter((t) => t.includes('세션'));
      expect(hits, file).toEqual([]);
    }
  });
});
