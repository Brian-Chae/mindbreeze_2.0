// @vitest-environment jsdom
// SDD-327 T8+T16 — member_report 있으면 새 책 화면, 없으면 기존 화면 / 책 PDF·공유 연결 (API mock)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fixture from '../src/lib/member-report/__fixtures__/member-report-sample.json';
import type { ReportDto } from '../src/lib/api/reports';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getBlob = vi.fn();
vi.mock('../src/lib/api/client', async (orig) => {
  const mod = await orig<typeof import('../src/lib/api/client')>();
  return { ...mod, apiClient: { ...mod.apiClient, getBlob: (...a: unknown[]) => getBlob(...a), get: vi.fn().mockResolvedValue({ items: [] }) } };
});
const native = vi.hoisted(() => ({ value: false }));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => native.value, getPlatform: () => 'web' }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));

import MemberReportViewer from '../src/components/reports/MemberReportViewer';
import { extractMemberReport } from '../src/lib/api/member-report';
import { buildNativeShareHandler, shareBookPdf } from '../src/lib/native/share-report';

const mk = (content: Record<string, unknown>): ReportDto =>
  ({ id: 'r1', session_id: 's1', user_id: 'u', type: 'client', status: 'sent', pdf_url: null, sent_at: null, is_read: false,
    created_at: '2026-11-01T05:10:00Z', scheduled_at: null, session_title: '명상', session_type: 'meditation', content }) as ReportDto;

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  native.value = false; getBlob.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('extractMemberReport', () => {
  it('버전이 맞으면 반환, 없거나 다르면 null', () => {
    expect(extractMemberReport({ member_report: fixture })).not.toBeNull();
    expect(extractMemberReport({ headline: 'x' })).toBeNull();
    expect(extractMemberReport({ member_report: { schema_version: 'old' } })).toBeNull();
  });
});

describe('MemberReportViewer 통합', () => {
  it('member_report 없으면 기존 화면 그대로', async () => {
    await act(async () => root.render(<MemberReportViewer report={mk({ headline: '편안했던 20분' })} ownerActions />));
    expect(container.querySelector('[data-testid="member-report-book-view"]')).toBeNull();
    expect(container.querySelector('[data-testid="member-report-frame"]')).not.toBeNull();
  });

  it('본인 화면: 책 PDF 버튼 + 보내기 진입점', async () => {
    await act(async () => root.render(<MemberReportViewer report={mk({ member_report: fixture })} ownerActions />));
    expect(container.querySelector('[data-testid="member-report-book-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="book-pdf-button"]')).not.toBeNull();
    expect(container.textContent).toContain('리포트 보내기');
  });

  it('토큰·검토 화면(ownerActions 없음): 화면은 새 것, 버튼은 숨김', async () => {
    await act(async () => root.render(<MemberReportViewer report={mk({ member_report: fixture })} />));
    expect(container.querySelector('[data-testid="member-report-book-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="book-pdf-button"]')).toBeNull();
    expect(container.textContent).not.toContain('리포트 보내기');
  });

  it('책 PDF 버튼 → /me/reports/r1/book.pdf 요청, 실패 시 안내', async () => {
    getBlob.mockRejectedValueOnce(new Error('x'));
    await act(async () => root.render(<MemberReportViewer report={mk({ member_report: fixture })} ownerActions />));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="book-pdf-button"]')!.click());
    expect(getBlob).toHaveBeenCalledWith('/me/reports/r1/book.pdf');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('받지 못했습니다');
  });
});

describe('앱 공유(T16)', () => {
  it('웹이면 핸들러 없음, 앱이면 있음', () => {
    expect(buildNativeShareHandler('r1')).toBeUndefined();
    native.value = true;
    expect(buildNativeShareHandler('r1')).toBeTypeOf('function');
    expect(buildNativeShareHandler(null)).toBeUndefined();
  });

  it('Share API 가능하면 파일 공유, 취소는 cancelled', async () => {
    getBlob.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share, canShare: () => true });
    expect(await shareBookPdf('r1')).toBe('shared');
    expect(share.mock.calls[0][0].files[0].type).toBe('application/pdf');
    share.mockRejectedValueOnce(new DOMException('c', 'AbortError'));
    expect(await shareBookPdf('r1')).toBe('cancelled');
  });
});
