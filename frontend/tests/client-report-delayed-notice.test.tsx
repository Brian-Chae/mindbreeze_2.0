// @vitest-environment jsdom
// SDD-212 T8 (U-06·U-07) — 리포트 생성 지연 시 `리뷰 중` 보조 문구. 서버 가산 필드 in_review_delayed 로만 판정한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientReportListPage from '../src/pages/client/ClientReportListPage';
import { ClientReportDetailModal } from '../src/pages/client/ClientReportDetailModal';
import {
  isReportDelayed,
  REPORT_IN_REVIEW_BADGE,
  REPORT_IN_REVIEW_DELAYED_NOTICE,
  REPORT_IN_REVIEW_NOTICE,
} from '../src/lib/report-review-copy';
import { composeBanned } from '../e2e/class-flow/lib.mjs';
import { getReport, listReports, type ReportDto } from '../src/lib/api/reports';
import { useReportStore } from '../src/stores/reportStore';

vi.mock('../src/lib/api/reports', async (original) => ({
  ...await original<typeof import('../src/lib/api/reports')>(),
  getReport: vi.fn(), listReports: vi.fn(), markAllReportsRead: vi.fn(),
}));
vi.mock('../src/components/reports/ClientReportViewer', () => ({
  default: () => <div data-testid="viewer">VIEWER-BODY</div>,
}));

const base: ReportDto = {
  id: 'ok', session_id: 's-ok', user_id: 'c', type: 'client', content: { headline: '승인된 기록', summary: '호흡으로 긴장을 풀었어요' },
  pdf_url: '/ok.pdf', sent_at: '2026-10-02', is_read: false, created_at: '2026-10-02', session_title: '승인 클래스',
  session_type: 'meditation', scheduled_at: '2026-10-02T10:00:00', counselor_name: '김상담', status: 'completed',
};
const delayed: ReportDto = {
  ...base, id: 'dl', session_id: 's-dl', sent_at: null, content: {}, pdf_url: null, session_title: '지연 클래스',
  status: 'pending_analysis', generation_status: 'processing', in_review: true, in_review_delayed: true,
};
const waitingReview: ReportDto = {
  ...delayed, id: 'wr', session_id: 's-wr', session_title: '확인 대기 클래스', status: 'pending_review',
  generation_status: 'ready', in_review_delayed: false,
};
const legacyInReview: ReportDto = { ...waitingReview, id: 'lg', session_title: '구응답 클래스', in_review_delayed: undefined };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(listReports).mockResolvedValue({ reports: [base, delayed, waitingReview, legacyInReview], total: 4 });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.clearAllMocks();
  useReportStore.getState().reset();
});

function rowOf(title: string): HTMLTableRowElement {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((tr) => tr.textContent?.includes(title))!;
}
function cardOf(title: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.block.md\\:hidden button')).find((b) => b.textContent?.includes(title))!;
}
function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('U-07 목록', () => {
  it('in_review_delayed 행에만 보조 문구 1줄, 배지는 그대로 `리뷰 중`', async () => {
    await act(async () => root.render(<MemoryRouter><ClientReportListPage /></MemoryRouter>));
    const row = rowOf('지연 클래스');
    expect(row.textContent).toContain(REPORT_IN_REVIEW_BADGE);
    expect(count(row.textContent ?? '', REPORT_IN_REVIEW_DELAYED_NOTICE)).toBe(1);
    for (const title of ['승인 클래스', '확인 대기 클래스', '구응답 클래스']) {
      expect(rowOf(title).textContent, title).not.toContain(REPORT_IN_REVIEW_DELAYED_NOTICE);
    }
    expect(rowOf('확인 대기 클래스').textContent).toContain(REPORT_IN_REVIEW_BADGE);
  });
  it('모바일 카드에도 같은 규칙이 적용된다', async () => {
    await act(async () => root.render(<MemoryRouter><ClientReportListPage /></MemoryRouter>));
    expect(count(cardOf('지연 클래스').textContent ?? '', REPORT_IN_REVIEW_DELAYED_NOTICE)).toBe(1);
    expect(cardOf('확인 대기 클래스').textContent).not.toContain(REPORT_IN_REVIEW_DELAYED_NOTICE);
    expect(cardOf('승인 클래스').textContent).not.toContain(REPORT_IN_REVIEW_DELAYED_NOTICE);
  });
});

describe('U-07 모달', () => {
  async function openDetail(report: ReportDto) {
    vi.mocked(getReport).mockResolvedValue(report);
    await act(async () => root.render(<ClientReportDetailModal reportId={report.id} onClose={() => undefined} />));
  }
  it('지연 중이면 기본 안내 아래에 보조 문구가 1줄 더 나온다', async () => {
    await openDetail(delayed);
    const text = document.querySelector('dialog')!.textContent ?? '';
    expect(text).toContain(REPORT_IN_REVIEW_NOTICE);
    expect(count(text, REPORT_IN_REVIEW_DELAYED_NOTICE)).toBe(1);
  });
  it('상담사 확인 대기 / 구 응답에는 보조 문구가 없다', async () => {
    for (const report of [waitingReview, legacyInReview]) {
      await openDetail(report);
      const text = document.querySelector('dialog')!.textContent ?? '';
      expect(text).toContain(REPORT_IN_REVIEW_NOTICE);
      expect(text).not.toContain(REPORT_IN_REVIEW_DELAYED_NOTICE);
    }
  });
  it('승인된 리포트에는 보조 문구가 없다', async () => {
    await openDetail({ ...base, in_review_delayed: true });
    expect(document.querySelector('dialog')!.textContent).not.toContain(REPORT_IN_REVIEW_DELAYED_NOTICE);
    expect(document.querySelector('[data-testid="viewer"]')).not.toBeNull();
  });
});

describe('isReportDelayed', () => {
  it('in_review 이면서 in_review_delayed 가 true 일 때만 참', () => {
    expect(isReportDelayed(delayed)).toBe(true);
    expect(isReportDelayed(waitingReview)).toBe(false);
    expect(isReportDelayed(legacyInReview)).toBe(false);
    expect(isReportDelayed({ in_review: false, in_review_delayed: true })).toBe(false);
    expect(isReportDelayed({})).toBe(false);
  });
});

describe('U-06 문구 가드', () => {
  it('보조 문구가 정확히 일치한다', () => {
    expect(REPORT_IN_REVIEW_DELAYED_NOTICE).toBe('평소보다 조금 늦어지고 있어요.');
    expect(REPORT_IN_REVIEW_BADGE).toBe('리뷰 중');
    expect(REPORT_IN_REVIEW_NOTICE).toBe('리뷰 중이에요. 확인이 끝나면 알려드릴게요.');
  });
  it('내부 용어(큐·워커·적체·서버 등)와 용어 금지어, 영문 대문자·그림문자가 없고 해요체다', () => {
    const banned = new RegExp(composeBanned('meditation'));
    const internal = /큐|워커|적체|서버|대기열|장애|오류|STT|AI|Celery|Redis/;
    expect(banned.test(REPORT_IN_REVIEW_DELAYED_NOTICE)).toBe(false);
    expect(internal.test(REPORT_IN_REVIEW_DELAYED_NOTICE)).toBe(false);
    expect(/[A-Z]{2,}/.test(REPORT_IN_REVIEW_DELAYED_NOTICE)).toBe(false);
    expect(/\p{Extended_Pictographic}/u.test(REPORT_IN_REVIEW_DELAYED_NOTICE)).toBe(false);
    expect(REPORT_IN_REVIEW_DELAYED_NOTICE).toMatch(/요\.$/);
  });
  it('수정한 파일도 기존 `세션` 가드(주석 제외 리터럴)를 통과한다', () => {
    const files = ['pages/client/ClientReportListPage.tsx', 'pages/client/ClientReportDetailModal.tsx', 'lib/report-review-copy.ts'];
    for (const file of files) {
      const text = readFileSync(resolve(__dirname, '../src', file), 'utf8');
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const hits = [...stripped.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1|>([^<>{}\n]+)</g)].map((m) => m[2] ?? m[3] ?? '').filter((t) => t.includes('세션'));
      expect(hits, file).toEqual([]);
    }
  });
});
