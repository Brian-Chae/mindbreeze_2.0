// @vitest-environment jsdom
// SDD-255 — 회원 리포트 모바일 뷰어: 프레임·데스크톱 보기 버튼·모달·상담사용 불변
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MemberReportViewer from '../src/components/reports/MemberReportViewer';
import ReportDetailView from '../src/components/reports/ReportDetailView';
import type { ReportDto } from '../src/lib/api/reports';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mk = (type: 'client' | 'counselor'): ReportDto =>
  ({
    id: 'r1', session_id: 's1', user_id: 'u', type, status: 'pending_review', pdf_url: null, sent_at: null, is_read: false,
    created_at: '2026-10-28T05:10:00Z', scheduled_at: '2026-10-28T05:00:00Z', session_title: '호흡 명상',
    session_type: 'meditation', participant_name: '지우', counselor_name: '서지연', in_review: false,
    capabilities: { can_view: true, can_approve: true, can_edit_comment: true, can_retry_delivery: false },
    content: { headline: '편안했던 20분', eeg: { status: 'not_measured' } },
  }) as ReportDto;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // jsdom 은 dialog.showModal 을 구현하지 않는다 → open 속성만 흉내
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const btn = () => container.querySelector<HTMLButtonElement>('[data-testid="member-report-desktop-button"]')!;
const dialog = () => document.querySelector<HTMLDialogElement>('[data-testid="member-report-desktop-dialog"]');

describe('MemberReportViewer', () => {
  it('본문을 .member-report-frame 안에 렌더한다', async () => {
    await act(async () => root.render(<MemberReportViewer report={mk('client')} />));
    expect(container.querySelector('.member-report-frame [data-testid="client-report-body"]')).not.toBeNull();
    expect(dialog()).toBeNull();
  });

  it('데스크톱 보기 버튼은 561px 이상에서만 보이도록 클래스가 지정된다', async () => {
    await act(async () => root.render(<MemberReportViewer report={mk('client')} />));
    const wrap = btn().parentElement!;
    expect(wrap.className).toBe('member-report-desktop-toggle');
    const css = readFileSync(resolve(__dirname, '../src/components/reports/member-report-frame.css'), 'utf8');
    expect(css).toMatch(/\.member-report-desktop-toggle\{display:none;/);
    expect(css).toMatch(/@media\(min-width:561px\)\{\.member-report-desktop-toggle\{display:flex\}\}/);
    expect(btn().className).toContain('min-h-11');
    expect(btn().textContent).toBe('데스크톱 보기');
  });

  it('버튼 클릭 → 모달 열림(넓은 본문), 모바일로 보기·닫기·ESC·바깥 클릭으로 닫히고 포커스가 돌아온다', async () => {
    await act(async () => root.render(<MemberReportViewer report={mk('client')} />));
    const open = async () => { await act(async () => btn().click()); };
    await open();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('[data-testid="client-report-body"]')).not.toBeNull();
    expect(dialog()!.querySelector('.member-report-frame')).toBeNull();

    await act(async () => Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === '모바일로 보기')!.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(btn());

    await open();
    await act(async () => dialog()!.querySelector<HTMLButtonElement>('[aria-label="데스크톱 보기 닫기"]')!.click());
    expect(dialog()).toBeNull();

    await open();
    await act(async () => { dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })); });
    expect(dialog()).toBeNull();

    await open();
    await act(async () => dialog()!.click());
    expect(dialog()).toBeNull();
  });

  it('중첩 dialog: 안쪽 cancel 이 바깥 dialog 로 전파되지 않는다', async () => {
    const outer = document.createElement('dialog');
    const onOuterCancel = vi.fn();
    outer.addEventListener('cancel', onOuterCancel);
    document.body.appendChild(outer);
    const inner = document.createElement('div');
    outer.appendChild(inner);
    const r = createRoot(inner);
    await act(async () => r.render(<MemberReportViewer report={mk('client')} />));
    await act(async () => inner.querySelector<HTMLButtonElement>('[data-testid="member-report-desktop-button"]')!.click());
    await act(async () => { dialog()!.dispatchEvent(new Event('cancel', { cancelable: true })); });
    expect(onOuterCancel).not.toHaveBeenCalled();
    act(() => r.unmount());
    outer.remove();
  });

  it('선택을 저장하지 않는다(localStorage/sessionStorage 쓰기 없음)', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    await act(async () => root.render(<MemberReportViewer report={mk('client')} />));
    await act(async () => btn().click());
    await act(async () => dialog()!.querySelector<HTMLButtonElement>('[aria-label="데스크톱 보기 닫기"]')!.click());
    expect(set).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<MemberReportViewer report={mk('client')} />));
    expect(dialog()).toBeNull();
  });
});

describe('적용 지점 / 불변', () => {
  it('ReportDetailView 회원용 → 뷰어 프레임, 상담사용 → 프레임·버튼 없음', async () => {
    const noop = () => {};
    await act(async () => root.render(<ReportDetailView report={mk('client')} onReportChange={noop} showListAction={false} />));
    expect(container.querySelector('[data-testid="member-report-frame"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<ReportDetailView report={mk('counselor')} onReportChange={noop} showListAction={false} />));
    expect(container.querySelector('[data-testid="member-report-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="member-report-desktop-button"]')).toBeNull();
  });

  it('member-report-frame.css 는 모든 규칙을 .member-report-frame 으로 한정한다', () => {
    const css = readFileSync(resolve(__dirname, '../src/components/reports/member-report-frame.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/(?:^|[}{])\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) {
      for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.member-report-(frame|desktop-toggle)/);
    }
    expect(css).toContain('container-type:inline-size');
    expect(css).not.toContain('.report-sample');
  });

  it('tailwind frame 변형이 컨테이너 쿼리로 정의된다', () => {
    const cfg = readFileSync(resolve(__dirname, '../tailwind.config.cjs'), 'utf8');
    expect(cfg).toContain("addVariant('frame', '@container member-report (max-width: 767px)')");
  });
});
