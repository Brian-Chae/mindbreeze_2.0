// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounselingDetailDto, CounselingSummaryDto } from '../src/lib/api/class-structure';
import type { ReadState } from '../src/lib/class-structure/read-model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hooks = vi.hoisted(() => ({
  list: { state: { status: 'loading' } as unknown, retry: vi.fn() },
  detail: { state: { status: 'loading' } as unknown, retry: vi.fn() },
  detailArg: vi.fn(),
}));
vi.mock('../src/hooks/use-class-structure', () => ({
  useCounseling: () => hooks.list,
  useCounselingDetail: (id: string) => { hooks.detailArg(id); return hooks.detail; },
}));
vi.mock('../src/components/class/structure/structure-shell', () => ({
  StructureShell: (p: { role: string; title: string; area?: string; children?: ReactNode }) =>
    createElement('div', { 'data-shell': p.role, 'data-area': p.area, 'data-title': p.title }, p.children),
}));

import { CounselingListPage } from '../src/pages/counseling/counseling-list-page';
import { CounselingDetailPage } from '../src/pages/counseling/counseling-detail-page';

const summary = (over: Partial<CounselingSummaryDto> = {}): CounselingSummaryDto => ({
  id: 'r1', status: 'active', area: 'counseling', counselor: { id: 'u1', name: '김상담' },
  client_display: null, modality_default: null, session_count: 0, next_session: null, latest_session: null, ...over,
});
const detail = (over: Partial<CounselingDetailDto> = {}): CounselingDetailDto => ({ ...summary(), sessions: [], ...over });
const ok = <T,>(data: T): ReadState<T> => ({ status: 'success', data });

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function mount(node: ReactNode, path: string) {
  act(() => { root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)); });
}
const text = () => container.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  hooks.detailArg.mockClear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('상담 목록 (CN01·CN07)', () => {
  it('빈 목록이면 호스트 상담 영역 셸과 빈 안내를 보여준다', () => {
    hooks.list.state = ok({ relationships: [], total: 0 });
    mount(createElement(CounselingListPage, { role: 'host' }), '/counseling');
    const shell = container.querySelector('[data-shell]');
    expect(shell?.getAttribute('data-shell')).toBe('host');
    expect(shell?.getAttribute('data-area')).toBe('counseling');
    expect(text()).toContain('아직 상담이 없어요');
  });

  it('일정 중심으로 표시하고 가짜 내담자명·개인 누적 횟수를 만들지 않는다', () => {
    hooks.list.state = ok({ relationships: [summary({ session_count: 5, next_session: { id: 's9', seq: 5, scheduled_at: '2030-01-02T01:00:00Z', status: 'scheduled' } })], total: 1 });
    mount(createElement(CounselingListPage, { role: 'host' }), '/counseling');
    expect(text()).toContain('상담 일정');
    expect(text()).not.toMatch(/번째 상담/);
    expect(text()).not.toContain('내담자 미지정');
    expect(container.querySelector('a[href="/counseling/r1"]')).not.toBeNull();
  });

  it('서버가 준 client_display만 내담자명으로 보여준다', () => {
    hooks.list.state = ok({ relationships: [summary({ client_display: '박내담' })], total: 1 });
    mount(createElement(CounselingListPage, { role: 'host' }), '/counseling');
    expect(text()).toContain('박내담');
  });

  it('호스트 화면은 기존 내담자 페이지 링크를 갖고 회원 화면은 없다', () => {
    hooks.list.state = ok({ relationships: [summary()], total: 1 });
    mount(createElement(CounselingListPage, { role: 'host' }), '/counseling');
    expect(container.querySelector('a[href="/clients"]')?.textContent).toContain('내담자');
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(CounselingListPage, { role: 'member' }), '/app/counseling');
    expect(container.querySelector('a[href="/clients"]')).toBeNull();
    expect(container.querySelector('a[href="/app/counseling/r1"]')).not.toBeNull();
    expect(container.querySelector('[data-shell]')?.getAttribute('data-shell')).toBe('member');
  });

  it('오류면 서버 원문 없이 안내하고 다시 시도가 호출된다', () => {
    hooks.list.state = { status: 'error', message: '목록을 불러오지 못했어요' };
    hooks.list.retry.mockClear();
    mount(createElement(CounselingListPage, { role: 'host' }), '/counseling');
    expect(text()).toContain('목록을 불러오지 못했어요');
    act(() => { (container.querySelector('button') as HTMLButtonElement).click(); });
    expect(hooks.list.retry).toHaveBeenCalledTimes(1);
  });

  it('금지어(클래스·수업·오픈)와 단독 세션이 없다', () => {
    hooks.list.state = ok({ relationships: [summary({ next_session: { id: 's', seq: 1, scheduled_at: '2030-01-02T01:00:00Z', status: 'scheduled' } })], total: 1 });
    mount(createElement(CounselingListPage, { role: 'host' }), '/counseling');
    expect(text()).not.toMatch(/클래스|수업|오픈/);
    expect(text().replace(/상담 세션/g, '')).not.toContain('세션');
  });
});

const detailPage = (role: 'host' | 'member', base: string) => createElement(Routes, null,
  createElement(Route, { path: `${base}/:relationshipId`, element: createElement(CounselingDetailPage, { role }) }));

describe('상담 상세 (CN02·CN08)', () => {
  const sessions = [
    { id: 's3', seq: 3, scheduled_at: '2030-01-03T01:00:00Z', status: 'completed', type: 'counseling', record_status: 'completed', report_status: 'completed' },
    { id: 's7', seq: 7, scheduled_at: null, status: 'scheduled', type: 'counseling', record_status: null, report_status: null },
  ];

  it('가시 회차의 원본 번호를 유지하고 빈 번호를 만들지 않는다', () => {
    hooks.detail.state = ok(detail({ session_count: 2, sessions }));
    mount(detailPage('host', '/counseling'), '/counseling/r1');
    expect(hooks.detailArg).toHaveBeenCalledWith('r1');
    expect(text()).toContain('3회차');
    expect(text()).toContain('7회차');
    expect(text()).not.toMatch(/[1245689]회차/);
    expect(container.querySelector('a[href="/counseling/r1/sessions/s3"]')).not.toBeNull();
    expect(container.querySelector('a[href="/counseling/r1/sessions/s7"]')).not.toBeNull();
  });

  it('번호가 없는 회차는 번호를 지어내지 않고 데이터 없음으로 표시한다', () => {
    hooks.detail.state = ok(detail({ sessions: [{ ...sessions[1], seq: null }] }));
    mount(detailPage('host', '/counseling'), '/counseling/r1');
    expect(text()).toContain('데이터 없음');
    expect(text()).not.toMatch(/\d회차/);
  });

  it('기록·리포트는 상태만 보이고 본문 필드는 노출하지 않는다', () => {
    hooks.detail.state = ok(detail({ sessions: [{ ...sessions[0], transcript: '비밀 전사 내용', summary: '비밀 요약' } as never] }));
    mount(detailPage('host', '/counseling'), '/counseling/r1');
    expect(text()).toContain('기록');
    expect(text()).toContain('리포트');
    expect(text()).not.toContain('비밀');
  });

  it('회원 상세는 회원 경로를 쓰고 누적 횟수·종결 사유를 보이지 않는다', () => {
    hooks.detail.state = ok(detail({ status: 'closed', session_count: 12, sessions: [sessions[0]] }));
    mount(detailPage('member', '/app/counseling'), '/app/counseling/r1');
    expect(container.querySelector('a[href="/app/counseling/r1?sessionId=s3"]')).not.toBeNull();
    expect(text()).not.toContain('12');
    expect(text()).not.toContain('종결 사유');
    expect(container.querySelector('a[href="/clients"]')).toBeNull();
  });

  it('찾을 수 없으면 회원은 회원 목록으로 돌아가는 링크를 갖는다', () => {
    hooks.detail.state = { status: 'not_found', message: '내용을 찾을 수 없어요' };
    mount(detailPage('member', '/app/counseling'), '/app/counseling/r1');
    expect(text()).toContain('내용을 찾을 수 없어요');
    expect(container.querySelector('a[href="/app/counseling"]')).not.toBeNull();
  });

  it('회차가 0건이면 빈 안내를 보여준다', () => {
    hooks.detail.state = ok(detail({ sessions: [] }));
    mount(detailPage('host', '/counseling'), '/counseling/r1');
    expect(text()).toContain('아직 상담 세션이 없어요');
  });
});
