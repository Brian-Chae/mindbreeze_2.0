// @vitest-environment jsdom
// SDD-324 — 요약 카드: 렌더·필드 없음 처리·클릭 필터. 점수·종합 표현 없음.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiV2SummaryCards } from '../src/components/ui-v2/ui-v2-summary-cards';
import ReportSummaryStrip from '../src/components/reports/report-summary-strip';
import { buildReportSummaryCards } from '../src/lib/report-summary-cards';
import { buildClientSummaryCards } from '../src/lib/client-summary-cards';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const base = { needs_review: 3, failed_delivery: 0, generation_failed: 1, total_sessions: 5 };

describe('리포트 요약 카드', () => {
  it('기존 응답: 회원별 항목·검토 대기·발송 실패만, 신규 카드는 숨김', () => {
    const keys = buildReportSummaryCards({ ...base, total_members: 12 }).map((c) => c.key);
    expect(keys).toEqual(['all', 'needs_review', 'failed']);
  });
  it('total_members 없으면 회원별 항목 카드 숨김, 0 건은 0 으로 표시', () => {
    const cards = buildReportSummaryCards(base);
    expect(cards.map((c) => c.key)).toEqual(['needs_review', 'failed']);
    expect(cards.find((c) => c.key === 'failed')?.value).toBe(0);
  });
  it('신규 집계는 값이 있을 때만 카드가 생기고, 표본 0 이면 평균 검토 숨김', () => {
    const keys = buildReportSummaryCards({ ...base, total_members: 2, created_today: 4, member_unread: 2, avg_review_hours: 3.14, review_sample: 0 }).map((c) => c.key);
    expect(keys).toContain('created_today'); expect(keys).toContain('member_unread'); expect(keys).not.toContain('avg_review_hours');
    const avg = buildReportSummaryCards({ ...base, created_today: 0, avg_review_hours: 3.14, review_sample: 8 }).find((c) => c.key === 'avg_review_hours');
    expect(avg?.value).toBe(3.1); expect(avg?.basis).toContain('8건');
  });
  it('카드 클릭이 탭을 바꾸고, 조회 실패는 0 이 아니라 집계 준비 중', () => {
    const onSelect = vi.fn();
    act(() => root.render(createElement(ReportSummaryStrip, { summary: { ...base, total_members: 9 }, activeTab: 'all', onSelectTab: onSelect })));
    act(() => { (host.querySelector('[data-card="needs_review"]') as HTMLButtonElement).click(); });
    expect(onSelect).toHaveBeenCalledWith('needs_review');
    expect(host.querySelector('[data-card="all"]')?.getAttribute('aria-pressed')).toBe('true');
    act(() => root.render(createElement(ReportSummaryStrip, { summary: null, unavailable: true, activeTab: 'all', onSelectTab: onSelect })));
    expect(host.textContent).toContain('집계 준비 중'); expect(host.querySelector('[data-card]')).toBeNull();
  });
});

describe('회원 요약 카드', () => {
  const sum = { connected: 20, d7: 6, d30: 14, extra: null };
  it('기존 API 3개 카드, 클릭 시 기간 필터 콜백', () => {
    const setDays = vi.fn();
    const items = buildClientSummaryCards(sum, 7, setDays);
    expect(items.map((i) => i.key)).toEqual(['connected', 'd7', 'd30']);
    act(() => root.render(createElement(UiV2SummaryCards, { items, label: '회원 요약' })));
    act(() => { (host.querySelector('[data-card="d30"]') as HTMLButtonElement).click(); });
    expect(setDays).toHaveBeenCalledWith(30);
    act(() => { (host.querySelector('[data-card="connected"]') as HTMLButtonElement).click(); });
    expect(setDays).toHaveBeenCalledWith(null);
    expect(host.querySelector('[data-card="d7"]')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('신규 집계 필드가 없으면 숨기고, 있으면 단위·기준과 함께 표시. 조회 실패(null)는 집계 준비 중', () => {
    expect(buildClientSummaryCards(sum, null, vi.fn())).toHaveLength(3);
    const full = buildClientSummaryCards({ ...sum, extra: { week_attended: 4, inactive_14d: 0, report_unread_members: 2, band_worn_members: 3, attended_members: 5 } }, null, vi.fn());
    expect(full.map((i) => i.key)).toEqual(['connected', 'd7', 'd30', 'week_attended', 'inactive_14d', 'report_unread', 'band']);
    expect(full.find((i) => i.key === 'inactive_14d')?.value).toBe(0);
    act(() => root.render(createElement(UiV2SummaryCards, { items: buildClientSummaryCards({ ...sum, d7: null }, null, vi.fn()), label: '회원 요약' })));
    expect(host.querySelector('[data-card="d7"]')?.textContent).toContain('집계 준비 중');
    expect(host.querySelector('[data-card="d7"]')?.tagName).toBe('DIV');
  });
  it('밴드 카드는 미착용을 문제로 표기하지 않는다', () => {
    const band = buildClientSummaryCards({ ...sum, extra: { band_worn_members: 3, attended_members: 5 } }, null, vi.fn()).find((i) => i.key === 'band');
    expect(band?.basis).not.toMatch(/미착용|문제|부족/);
  });
});

describe('격리·금지 표현', () => {
  it('운영 공용 목록은 플래그일 때만 새 요약을 쓴다', () => {
    const d = read('src/pages/reports/ReportsDesktopPage.tsx');
    expect(d).toContain('isUiV2Enabled()'); expect(d).toMatch(/renderSummary=\{v2 \?/); expect(d).toMatch(/onVisibleReports=\{v2 \?/);
    expect(read('src/pages/reports/ReportListPage.tsx')).not.toMatch(/u2f|ui-v2/);
  });
  it('금지 표현 없음', () => {
    for (const f of ['src/components/reports/report-summary-strip.tsx', 'src/lib/report-summary-cards.ts', 'src/lib/client-summary-cards.ts', 'src/components/ui-v2/ui-v2-summary-cards.tsx', 'src/pages/coach/ui-v2/ui-v2-coach-reports-entry.tsx', 'src/pages/coach/ui-v2/ui-v2-coach-home-page.tsx', 'src/pages/coach/ui-v2/ui-v2-coach-clients-page.tsx']) expect(read(f)).not.toMatch(/점수|종합점수|좋음|나쁨|보증|100%|완료/);
  });
});
