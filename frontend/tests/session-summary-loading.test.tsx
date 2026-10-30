// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter, RouterProvider} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import SessionSummaryPage from '../src/pages/sessions/session-summary-page';
import {getMockSummary} from '../src/lib/class-report/mocks';
const summary=vi.hoisted(()=>vi.fn());
vi.mock('../src/lib/api/class-summary',()=>({classSummaryApi:{summary,claimNotePrompt:vi.fn().mockResolvedValue({show:false})}}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
it('다른 회차로 이동하면 이전 요청의 늦은 응답이 현재 회차를 덮어쓰지 않는다',async()=>{
 let resolveFirst: (value:ReturnType<typeof getMockSummary>)=>void=()=>{};
 summary.mockImplementation((id:string)=>id==='first'?new Promise(resolve=>{resolveFirst=resolve;}):Promise.resolve({...getMockSummary(),session:{...getMockSummary().session,id:'second',class_name:'두 번째 수업'}}));
 const router=createMemoryRouter([{path:'/sessions/:id/summary',element:<SessionSummaryPage/>}],{initialEntries:['/sessions/first/summary']});
 const box=document.createElement('div'),root=createRoot(box);
 await act(async()=>root.render(<RouterProvider router={router}/>));
 expect(box.textContent).toContain('코치에게만');expect(box.textContent).toContain('의료기기가 아니며');
 await act(async()=>router.navigate('/sessions/second/summary'));
 expect(box.textContent).toContain('두 번째 수업');
 await act(async()=>resolveFirst(getMockSummary()));
 expect(box.textContent).toContain('두 번째 수업');
 expect(box.textContent).not.toContain('아침 호흡 명상');
 await act(async()=>root.unmount());
});
