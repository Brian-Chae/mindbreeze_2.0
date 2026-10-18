// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassListResponse, CounselingListResponse } from '../src/lib/api/class-structure';
import type { ReadState } from '../src/lib/class-structure/read-model';
import { MemberStructureHomePage } from '../src/pages/client/member-structure-home-page';

const hooks = vi.hoisted(() => ({ home: vi.fn(), classes: vi.fn(), detail: vi.fn(), retry: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', () => ({ useMixedHome: hooks.home, useClasses: hooks.classes, useClassDetail: hooks.detail }));
// 알림·채팅의 외부 요청 없이 페이지 표시 계약만 검사한다.
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ title, children, role }: { title: string; children: ReactNode; role: string }) => <main data-role={role}><h1>{title}</h1>{children}</main> }));
const row = {
  id: 'class-1', title: '호흡 명상', status: 'active', schedule_mode: 'fixed', planned_session_count: 8,
  progress: { completed: 0, total: 8 }, session_count: 2, has_open_session: false,
  next_session: { id: 'next-3', seq: 3, scheduled_at: '2099-11-20T10:00:00+09:00', status: 'scheduled', host: { id: 'host', name: '김지도' } },
};
const counsel = {
  id: 'relation-1', status: 'active', counselor: { id: 'counselor', name: '이상담' }, session_count: 2,
  next_session: { id: 'c-next', seq: 7, scheduled_at: '2099-11-19T10:00:00+09:00', status: 'scheduled' }, latest_session: null,
};
let classes: ReadState<ClassListResponse>;
let counseling: ReadState<CounselingListResponse>;
let cleanup: (() => void) | undefined;
function render(node: ReactNode, path = '/app') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)));
  cleanup = () => { flushSync(() => root.unmount()); container.remove(); };
  return container;
}
beforeEach(() => {
  vi.clearAllMocks();
  classes = { status: 'success', data: { classes: [row], total: 1 } };
  counseling = { status: 'success', data: { relationships: [counsel], total: 1 } };
  hooks.home.mockImplementation(() => ({ classes, counseling, retry: hooks.retry }));
});
afterEach(() => cleanup?.());

describe('MC01 회원 홈', () => {
  it('두 영역 중 가장 이른 제공 일정을 표시하고 기존 입장 흐름으로 연결한다', () => {
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelector('[aria-label="다음 일정"]')?.textContent).toContain('상담 7회차');
    expect(view.querySelector('[aria-label="다음 일정"] a')?.getAttribute('href')).toBe('/class/c-next/enter');
    expect(view.textContent).toContain('이상담');
    expect(view.querySelector('a[href="/app/classes/class-1"]')).not.toBeNull();
    expect(view.querySelector('a[href="/app/counseling/relation-1"]')).not.toBeNull();
    expect(view.querySelector('main')?.dataset.role).toBe('member');
  });
  it.each(['classes', 'counseling'] as const)('%s 한쪽 실패만 오류로 표시하고 나머지는 유지한다', (failed) => {
    if (failed === 'classes') classes = { status: 'error', message: '목록을 불러오지 못했어요' };
    else counseling = { status: 'error', message: '목록을 불러오지 못했어요' };
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(view.textContent).toContain('확인된 다음 일정');
    expect(view.textContent).toContain(failed === 'classes' ? '이상담' : '호흡 명상 · 3회차');
    flushSync(() => view.querySelector('button')?.click());
    expect(hooks.retry).toHaveBeenCalledTimes(1);
  });
  it.each(['classes', 'counseling', 'both'] as const)('%s 빈 목록도 두 영역 링크를 유지한다', (empty) => {
    if (empty !== 'counseling') classes = { status: 'success', data: { classes: [], total: 0 } };
    if (empty !== 'classes') counseling = { status: 'success', data: { relationships: [], total: 0 } };
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelector('a[href="/app/classes"]')).not.toBeNull();
    expect(view.querySelector('a[href="/app/counseling"]')).not.toBeNull();
    if (empty === 'both') expect(view.textContent).toContain('예정된 일정이 없어요');
    expect(view.textContent).not.toContain('연결이 필요');
  });
  it('과거 일정과 취소 일정으로 다음 일정을 만들지 않는다', () => {
    classes = { status: 'success', data: { classes: [{ ...row, next_session: { ...row.next_session, scheduled_at: '2000-01-01T00:00:00Z' } }], total: 1 } };
    counseling = { status: 'success', data: { relationships: [{ ...counsel, next_session: { ...counsel.next_session, status: 'cancelled' } }], total: 1 } };
    const view = render(<MemberStructureHomePage />);
    expect(view.querySelector('[aria-label="다음 일정"]')?.textContent).toContain('예정된 일정이 없어요');
    expect(view.querySelector('[aria-label="다음 일정"] a')).toBeNull();
  });
  it('일부 목록만 받으면 전체 다음 일정으로 단정하지 않는다', () => {
    classes = { status: 'success', data: { classes: [row], total: 5 } };
    expect(render(<MemberStructureHomePage />).textContent).toContain('확인된 다음 일정');
  });
});
