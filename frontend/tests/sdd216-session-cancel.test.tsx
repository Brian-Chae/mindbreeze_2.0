// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ClassSessionDetail } from '../src/components/class/structure/class-session-detail';
const model=vi.hoisted(()=>({user:{id:'lead',role:'counselor'},retry:vi.fn(),bulk:vi.fn().mockResolvedValue({revision:5}),detail:{id:'c',title:'마음 명상',status:'active',revision:4,capabilities:{schedule:true},host_view:{access_code:'1234',instructors:[]}},sessions:[{id:'s1',seq:1,status:'scheduled',host:{id:'other',name:'다른 지도사'},host_state:'assigned',state_version:6,scheduled_at:'2026-11-01T10:00:00Z',duration_min:60,location_type:'online'},{id:'s2',seq:2,status:'scheduled',host:{id:'other',name:'다른 지도사'},host_state:'assigned',state_version:7,scheduled_at:'2026-11-08T10:00:00Z',duration_min:60,location_type:'online'}]}));
vi.mock('../src/hooks/use-class-structure',()=>({useClassDetail:()=>({state:{status:'success',data:{detail:model.detail,sessions:{sessions:model.sessions}}},retry:model.retry})}));
vi.mock('../src/stores/authStore',()=>({useAuthStore:(select:(s:typeof model)=>unknown)=>select(model)}));
vi.mock('../src/lib/api/class-scheduling',()=>({schedulingApi:{bulk:model.bulk}}));
vi.mock('../src/components/class/structure/structure-shell',()=>({StructureShell:({children}:{children:ReactNode})=><main>{children}</main>}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let box:HTMLDivElement;let root:Root;
async function render(id='s1'){if(!box){box=document.createElement('div');document.body.append(box);root=createRoot(box);}await act(async()=>root.render(<MemoryRouter><ClassSessionDetail classId="c" sessionId={id}/></MemoryRouter>));}
async function press(text:string){const button=[...document.querySelectorAll('button')].find(b=>b.textContent===text);expect(button).toBeTruthy();await act(async()=>button!.click());}
afterEach(async()=>{if(root)await act(async()=>root.unmount());box?.remove();box=undefined as unknown as HTMLDivElement;model.user={id:'lead',role:'counselor'};vi.clearAllMocks();});
it('취소 시트에서 대상과 일시를 읽고 확인 후 단일 회차와 버전만 전송한다',async()=>{
 await render();await press('이 회차 취소');const dialog=document.querySelector('[role="dialog"]');expect(dialog?.textContent).toContain('1회차');expect(dialog?.textContent).toContain('2026');expect(model.bulk).not.toHaveBeenCalled();
 await press('돌아가기');expect(model.bulk).not.toHaveBeenCalled();await press('이 회차 취소');await act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='회차 취소 확인')!;button.click();button.click();});
 expect(model.bulk).toHaveBeenCalledTimes(1);expect(model.bulk).toHaveBeenCalledWith('c',expect.objectContaining({action:'cancel',expected_revision:4,session_ids:['s1'],expected_state_versions:{s1:6},rows:[],operation_key:expect.any(String)}));expect(model.retry).toHaveBeenCalledTimes(1);
});
it('관리자 사유가 없으면 차단하고 입력한 사유를 취소 요청에 전송한다',async()=>{
 model.user={id:'admin',role:'org_admin'};await render();await press('이 회차 취소');await press('회차 취소 확인');expect(model.bulk).not.toHaveBeenCalled();expect(document.body.textContent).toContain('사유를 입력');
 const input=document.querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'센터 휴무');input.dispatchEvent(new Event('input',{bubbles:true}));});await press('회차 취소 확인');expect(model.bulk.mock.calls[0][1].reason).toBe('센터 휴무');
});
it('상세 회차를 이동하면 이전 회차 취소 시트가 닫히고 신규 대상 버전을 사용한다',async()=>{
 await render();await press('이 회차 취소');await render('s2');expect(document.querySelector('[role="dialog"]')).toBeNull();await press('이 회차 취소');await press('회차 취소 확인');expect(model.bulk.mock.calls[0][1]).toMatchObject({session_ids:['s2'],expected_state_versions:{s2:7}});
});

it('취소 시트는 스크롤·컨테이너 배치 밖에 표시한다',async()=>{await render();await press('이 회차 취소');expect(document.querySelector('[role="dialog"]')?.parentElement?.parentElement).toBe(document.body);});
