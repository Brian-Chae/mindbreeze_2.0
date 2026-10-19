// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { HostClassDetailPage } from '../src/pages/classes/host-class-detail-page';
const mocks=vi.hoisted(()=>({detail:vi.fn(),get:vi.fn().mockResolvedValue({members:[],invitations:[],instructors:[]}),post:vi.fn().mockResolvedValue({}),patch:vi.fn().mockResolvedValue({})}));
vi.mock('../src/hooks/use-class-structure',()=>({useClassDetail:mocks.detail}));
vi.mock('../src/lib/api/client',()=>({apiClient:{get:mocks.get,post:mocks.post,patch:mocks.patch},ApiError:class extends Error{}}));
vi.mock('../src/stores/authStore',()=>({useAuthStore:(selector:(state:unknown)=>unknown)=>selector({user:{id:'h',role:'counselor'}})}));
vi.mock('../src/components/class/structure/structure-shell',()=>({StructureShell:({children}: {children:ReactNode})=><main>{children}</main>}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root;let box:HTMLDivElement;
const detail={id:'c',title:'마음 명상',status:'active',schedule_mode:'fixed',area:'meditation',progress:{completed:0,total:8},session_count:8,next_session:null,has_open_session:false,location_type:'online',location_address:null,capacity:10,participant_mode:'group',default_duration_min:60,linkband_mode:'optional',record_audio:true,record_video:false,chat_enabled:false,reminder_offsets:[1440],revision:3,host_view:{access_code:'1234',instructors:[]},capabilities:{manage:true,invite:true,schedule:true}};
async function render(path:string,schedule=true){mocks.detail.mockReturnValue({state:{status:'success',data:{detail:{...detail,capabilities:{manage:schedule,invite:schedule,schedule}},sessions:{sessions:[],total:0}}},retry:vi.fn()});box=document.createElement('div');document.body.append(box);root=createRoot(box);await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/classes/:classId/*" element={<HostClassDetailPage/>}/></Routes></MemoryRouter>));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());box?.remove();vi.clearAllMocks();});
it('권한이 있으면 멤버·설정 탭과 실제 운영 화면을 연다',async()=>{await render('/classes/c?tab=members');expect(box.querySelector('a[href="/classes/c?tab=members"]')).toBeTruthy();expect(box.textContent).toContain('이메일 초대');expect(mocks.get).toHaveBeenCalledWith('/classes/c/members');});
it('관리 권한이 없으면 설정 쓰기와 멤버 초대가 없다',async()=>{await render('/classes/c?tab=settings',false);expect(box.querySelector('a[href="/classes/c?tab=settings"]')).toBeNull();expect(box.textContent).not.toContain('설정 저장');});
it('이메일 실패만 재시도하고 발송을 수신완료로 표시하지 않는다',async()=>{mocks.get.mockImplementation((path:string)=>Promise.resolve(path.endsWith('email-invites')?{invitations:[{id:'i1',email:'a@example.com',status:'failed'},{id:'i2',email:'b@example.com',status:'sent'}]}:{members:[],instructors:[]}));await render('/classes/c?tab=members');expect([...box.querySelectorAll('button')].filter(b=>b.textContent==='다시 보내기')).toHaveLength(1);expect(box.textContent).not.toContain('수신 완료');});
it('설정 저장은 현재 영상·채팅·알림을 보존하고 revision을 전송한다',async()=>{
 Object.assign(detail,{record_video:true,chat_enabled:true,reminder_offsets:[60],planned_session_count:8,recurrence_rule:{version:1,start_date:'2026-11-01',weekdays:[1],time:'19:00',interval_weeks:1,skip_dates:[]},assignment_rule:{version:1,mode:'all_one',host_ids:['h'],weekday_hosts:{}},host_view:{access_code:'1234',instructors:[{user_id:'h',name:'지도사',role:'lead',status:'active'}]}});
 await render('/classes/c?tab=settings');const form=box.querySelector('form')!;await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(mocks.patch).toHaveBeenCalledWith('/classes/c',expect.objectContaining({expected_revision:3,operation_key:expect.any(String),schedule:expect.objectContaining({record_video:true,chat_enabled:true,reminder_offsets:[60],rows:[]})}));
});
it('취소는 확인 전 요청하지 않고 확인 이후 한 번만 전송한다',async()=>{await render('/classes/c?tab=settings');const button=(label:string)=>[...box.querySelectorAll('button')].find(b=>b.textContent===label)!;await act(async()=>button('클래스 취소').click());expect(mocks.post).not.toHaveBeenCalled();await act(async()=>{button('확인하고 적용').click();button('확인하고 적용').click();});expect(mocks.post).toHaveBeenCalledTimes(1);expect(mocks.post).toHaveBeenCalledWith('/classes/c/transition',expect.objectContaining({action:'cancel',expected_revision:3}));});
it('보조강사를 주강사로 지정할 때 명시 확인과 버전을 전송한다',async()=>{
 mocks.get.mockImplementation((path:string)=>Promise.resolve(path.endsWith('/instructors')?{instructors:[{user_id:'a',role:'assistant',status:'active',scope_session_id:null}]}:{instructors:[{id:'a',name:'다른 지도사'}],members:[],invitations:[]}));
 await render('/classes/c?tab=settings');const button=(label:string)=>[...box.querySelectorAll('button')].find(b=>b.textContent===label)!;await act(async()=>button('주강사 지정').click());expect(mocks.patch).not.toHaveBeenCalled();await act(async()=>button('변경 확인').click());expect(mocks.patch).toHaveBeenCalledWith('/classes/c/instructors/a',expect.objectContaining({role:'lead',expected_revision:3}));
});
