// @vitest-environment jsdom
// 웹 리포트 v11 통일 — member_report 가 있으면 UiV2ReportBody 도 회원 리포트(화면 C1)를 렌더한다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiV2ReportBody } from '../src/components/ui-v2/ui-v2-report-body';
import type { ReportDto } from '../src/lib/api/reports';
import sample from '../src/lib/member-report/__fixtures__/member-report-sample.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/components/reports/MemberReportBookView', () => ({
  default: ({ reportId }: { reportId: string | null }) => <div data-testid="member-report-book-view" data-report-id={reportId ?? ''} />,
}));

const base = (content: Record<string, unknown>): ReportDto => ({
  id: 'r1', session_id: 's1', user_id: 'u1', type: 'client', content, pdf_url: null, sent_at: null,
  is_read: false, created_at: '2026-11-17T00:00:00Z', session_title: '명상', session_type: null, scheduled_at: null,
} as ReportDto);

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(ui: React.ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => { root!.render(<MemoryRouter>{ui}</MemoryRouter>); });
  return host;
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

describe('UiV2ReportBody member_report 분기', () => {
  it('member_report 있으면 v11 책 화면, 구 본문 미렌더(회원 ownerActions → reportId 전달)', () => {
    const el = mount(<UiV2ReportBody report={base({ member_report: sample })} ownerActions />);
    expect(el.querySelector('[data-testid="member-report-book-view"]')?.getAttribute('data-report-id')).toBe('r1');
    expect(el.querySelector('[data-testid="ui-v2-report-body"]')).toBeNull();
  });
  it('코치(ownerActions 없음)는 reportId null 로 보내기·PDF 숨김', () => {
    const el = mount(<UiV2ReportBody report={base({ member_report: sample })} />);
    expect(el.querySelector('[data-testid="member-report-book-view"]')?.getAttribute('data-report-id')).toBe('');
  });
  it('member_report 없으면 기존 화면', () => {
    const el = mount(<UiV2ReportBody report={base({})} />);
    expect(el.querySelector('[data-testid="ui-v2-report-body"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="member-report-book-view"]')).toBeNull();
  });
});
