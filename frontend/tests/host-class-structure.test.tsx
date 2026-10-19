// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { HostClassesPage } from '../src/pages/classes/host-classes-page';
import { HostClassDetailPage } from '../src/pages/classes/host-class-detail-page';
vi.mock('../src/components/class/structure/class-create-action', () => ({ ClassCreateAction: () => <a href="/classes/new">새 클래스 만들기</a> }));
const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), retry: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', () => ({ useClasses: mocks.list, useClassDetail: mocks.detail }));
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ children, rightSlot, title }: {
        children: ReactNode;
        rightSlot: ReactNode;
        title: string;
    }) => <main><h1>{title}</h1>{rightSlot}{children}</main> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
function setup(missing = false) { mocks.detail.mockReturnValue({ state: { status: 'success', data: { detail: { ...row, progress: missing ? null : { completed: 3, total: 3 }, capacity: 0, record_audio: false, location_type: 'online', linkband_mode: 'optional' }, sessions: { total: 3, sessions: [1, 3, 7].map(seq => ({ id: `s${seq}`, seq, status: seq === 3 ? 'cancelled' : 'completed', scheduled_at: null, host: { id: 'h', name: null } })) } } }, retry: mocks.retry }); }
it('상태 불일치·0·false·누락 보존, 개요·회차만 제공', async () => {
    setup();
    await render('/classes/c1', <HostClassDetailPage />);
    expect(box.textContent).toContain('클래스 상태진행 중');
    expect(box.textContent).toContain('음성 녹음아니요');
    expect(box.textContent).toContain('정원0');
    expect([...box.querySelectorAll('nav[aria-label="클래스 메뉴"] a')].map(a => a.textContent)).toEqual(['개요', '회차']);
    expect(box.textContent).not.toMatch(/수료|강사 변경|보강 추가|출석|설정/);
});
it('회차 직접 경로·표↔타임라인·원본 번호·취소·새 경로', async () => {
    setup();
    await render('/classes/c1/sessions', <HostClassDetailPage />);
    for (const seq of [1, 3, 7])
        expect(box.querySelector(`a[href="/classes/c1/sessions/s${seq}"]`)?.textContent).toContain(`${seq}회차`);
    expect(box.textContent).toContain('취소');
    expect(box.textContent).not.toContain('2회차');
    await click('타임라인');
    expect(box.querySelector('ol')).toBeTruthy();
    for (const seq of [1, 3, 7])
        expect(box.querySelector(`a[href="/classes/c1/sessions/s${seq}"]`)).toBeTruthy();
});
it('누락 진행률을 계산하지 않는다', async () => { setup(true); await render('/classes/c1', <HostClassDetailPage />); expect(box.querySelector('[aria-label="클래스 진행"]')?.textContent).toContain('데이터 없음'); });
it.each(['loading', 'error', 'not_found'] as const)('상세 %s 안내·재시도·복귀', async status => {
 mocks.detail.mockReturnValue({ state: { status }, retry: mocks.retry });
 await render('/classes/c1', <HostClassDetailPage/>);
 expect(box.textContent).toContain({ loading: '불러오는 중이에요', error: '목록을 불러오지 못했어요', not_found: '내용을 찾을 수 없어요' }[status]);
 if (status === 'error') { await click('다시 시도'); expect(mocks.retry).toHaveBeenCalledTimes(1); }
 if (status === 'not_found') expect(box.querySelector('a[href="/classes"]')).toBeTruthy();
});
it('회차 0·누락 번호·0 분모·정상 빈 목록을 보존한다', async () => {
 setup(); const result = mocks.detail(); result.state.data.detail.progress = { completed: 0, total: 0 };
 result.state.data.sessions.sessions = [{ id: 'zero', seq: 0, status: 'scheduled', host: { name: null } }, { id: 'missing', seq: null, status: 'cancelled', host: { name: null } }];
 await render('/classes/c1/sessions', <HostClassDetailPage/>);
 expect(box.querySelector('a[href="/classes/c1/sessions/zero"]')?.textContent).toContain('0회차');
 expect(box.querySelector('a[href="/classes/c1/sessions/missing"]')?.textContent).toContain('데이터 없음');
});
it('입장 준비 상태를 누락으로 바꾸지 않는다', async () => {
 setup(); const result = mocks.detail(); result.state.data.sessions.sessions[0].status = 'ready';
 await render('/classes/c1/sessions', <HostClassDetailPage/>);
 expect(box.querySelector('a[href="/classes/c1/sessions/s1"]')?.closest('[role="row"]')?.textContent).toContain('준비');
 await click('타임라인');
 expect(box.querySelector('a[href="/classes/c1/sessions/s1"]')?.textContent).toContain('준비');
});
it('현재 탭을 시각적으로 구분하고 회차 표의 네 열 의미를 제공한다', async () => {
 setup(); await render('/classes/c1/sessions', <HostClassDetailPage/>);
 const current = box.querySelector('nav[aria-label="클래스 메뉴"] a[aria-current="page"]');
 expect(current?.className).toContain('border-purple-800');
 expect([...box.querySelectorAll('[role="columnheader"]')].map(cell => cell.textContent)).toEqual(['회차', '일시', '진행 지도사', '상태']);
 expect(box.querySelectorAll('[role="cell"]')).toHaveLength(12);
});
it('시안 목록 5열·아이콘·정기형 다음 N회차째를 표시한다', async () => {
    mocks.list.mockReturnValue({ state: { status: 'success', data: { classes: [{ ...row, schedule_mode: 'rolling', has_open_session: false, next_session: { id: 's12', seq: 12, status: 'scheduled', scheduled_at: '2099-12-21T10:00:00Z', host: { id: 'h1', name: '김지도사' } } }], total: 1 } }, retry: mocks.retry });
    await render();
    expect([...box.querySelectorAll('[data-class-column]')].map(element => element.textContent)).toEqual(['클래스', '다음 회차', '진행', '진행 지도사', '상태']);
    expect(box.querySelector('[data-class-card] svg')).toBeTruthy();
    expect(box.querySelector('[data-class-card]')?.textContent).toContain('12회차째');
    expect(box.querySelector('[data-class-card]')?.textContent).not.toContain('0/3');
    expect(box.querySelector('[aria-label="다음 회차"] a')?.getAttribute('href')).toBe('/classes/c1/sessions/s12');
});
it('상세 다음 회차를 시안 이미지와 진행자·상태·행동 영역으로 표시한다', async () => {
    mocks.detail.mockReturnValue({ state: { status: 'success', data: { detail: { ...row, location_type: 'online', default_duration_min: 60, linkband_mode: 'optional', next_session: { id: 's4', seq: 4, scheduled_at: '2099-12-21T10:00:00Z', status: 'scheduled', host: { id: 'h1', name: '김지도사' } } }, sessions: { sessions: [], total: 0 } } }, retry: mocks.retry });
    await render('/classes/c1', <HostClassDetailPage />);
    const hero = box.querySelector<HTMLElement>('[aria-label="다음 회차"]');
    expect(hero?.style.backgroundImage).toContain('/images/background8.webp');
    expect(hero?.textContent).toContain('김지도사');
    expect(hero?.textContent).toContain('4회차');
    expect(hero?.querySelector('[data-hero-actions] a')?.getAttribute('href')).toBe('/classes/c1/sessions/s4');
});
