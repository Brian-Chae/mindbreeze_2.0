// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { HostClassesPage } from '../src/pages/classes/host-classes-page';
const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), retry: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', () => ({ useClasses: mocks.list, useClassDetail: mocks.detail }));
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ children, rightSlot, title }: {
        children: ReactNode;
        rightSlot: ReactNode;
        title: string;
    }) => <main><h1>{title}</h1>{rightSlot}{children}</main> }));
const row = { id: 'c1', title: '마음 명상', status: 'active', schedule_mode: 'fixed', progress: { completed: 0, total: 3 }, session_count: 3, next_session: null, has_open_session: true };
let root: Root;
let box: HTMLDivElement;
async function render(path = '/classes', page: ReactNode = <HostClassesPage />) {
    box = document.createElement('div');
    document.body.append(box);
    root = createRoot(box);
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/classes" element={page}/><Route path="/classes/:classId/*" element={page}/></Routes></MemoryRouter>));
}
async function click(text: string) { const b = [...box.querySelectorAll('button')].find(b => b.textContent === text); expect(b).toBeTruthy(); await act(async () => b!.click()); }
afterEach(async () => { if (root)
    await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); });
it('목록 검색·필터·열린 회차와 링크, N+1 없음', async () => {
    mocks.list.mockReturnValue({ state: { status: 'success', data: { classes: [row, { ...row, id: 'c2', title: '저녁 명상', status: 'completed', has_open_session: false }], total: 20 } }, retry: mocks.retry });
    await render();
    expect(box.querySelectorAll('[data-class-card]')).toHaveLength(2);
    expect(box.querySelector('a[href="/classes/new"]')).toBeTruthy();
    expect(box.querySelector('[aria-label="열려 있는 회차"] a')?.getAttribute('href')).toBe('/classes/c1');
    expect(box.textContent).toContain('0/3');
    await click('완료');
    expect(box.querySelectorAll('[data-class-card]')).toHaveLength(1);
    const input = box.querySelector('input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '마음'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(box.textContent).toContain('검색 결과가 없어요');
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(box.textContent).not.toContain('전체 20');
});
it.each(['loading', 'error', 'not_found', 'empty'] as const)('%s 상태·재시도', async (status) => {
    mocks.list.mockReturnValue({ state: status === 'empty' ? { status: 'success', data: { classes: [], total: 0 } } : { status }, retry: mocks.retry });
    await render();
    expect(box.textContent).toContain({ loading: '불러오는 중이에요', error: '목록을 불러오지 못했어요', not_found: '내용을 찾을 수 없어요', empty: '아직 클래스가 없어요' }[status]);
    if (status === 'error') {
        await click('다시 시도');
        expect(mocks.retry).toHaveBeenCalledTimes(1);
    }
});
