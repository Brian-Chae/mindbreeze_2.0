// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { HostClassesPage } from '../src/pages/classes/host-classes-page';
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', () => ({ useClasses: mocks.list }));
vi.mock('../src/components/class/structure/class-create-action', () => ({ ClassCreateAction: () => null }));
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ children }: {children: ReactNode}) => <main>{children}</main> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let box: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); });
it('즉석 안내와 필터, 완료된 즉석 클래스의 다시 열기 경로를 제공한다', async () => {
 const row = { id:'c1', title:'즉석 명상', is_instant:true, status:'completed', schedule_mode:'fixed', progress:{completed:1,total:1}, session_count:1, next_session:null, has_open_session:false };
 mocks.list.mockReturnValue({ state:{status:'success',data:{classes:[row,{...row,id:'c2',title:'일반 명상',is_instant:false}],total:2}}, retry:vi.fn() });
 box=document.createElement('div'); document.body.append(box); root=createRoot(box);
 await act(async () => root.render(<MemoryRouter><HostClassesPage/></MemoryRouter>));
 expect(box.querySelector('a[href="/classes/now"]')).toBeTruthy();
 expect(box.querySelector('a[href="/classes/now?from=c1"]')?.textContent).toContain('다시 열기');
 expect(box.querySelectorAll('a a')).toHaveLength(0);
 const filter=[...box.querySelectorAll('button')].find(button=>button.textContent==='즉석');
 expect(filter).toBeTruthy(); await act(async () => filter!.click());
 expect(box.querySelectorAll('[data-class-card]')).toHaveLength(1);
 expect(box.textContent).not.toContain('일반 명상');
});
