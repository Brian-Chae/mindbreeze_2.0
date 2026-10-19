// @vitest-environment jsdom
import { act,type ReactNode } from 'react';import {createRoot,type Root} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {afterEach,expect,it,vi} from 'vitest';
import {ClassSessionDetail} from '../src/components/class/structure/class-session-detail';
const state=vi.hoisted(()=>({user:{id:'admin',role:'org_admin'},detail:{id:'c',title:'명상',status:'active',revision:1,capabilities:{manage:true,schedule:true,invite:true},host_view:{access_code:'1234',instructors:[]}},sessions:[{id:'s',seq:1,status:'scheduled',host:{id:'host',name:'진행자'},host_state:'assigned',state_version:3,scheduled_at:'2026-11-01T10:00:00Z',duration_min:60,location_type:'online',location_address:null}]}));
vi.mock('../src/hooks/use-class-structure',()=>({useClassDetail:()=>({state:{status:'success',data:{detail:state.detail,sessions:{sessions:state.sessions,total:1}}},retry:vi.fn()})}));
vi.mock('../src/stores/authStore',()=>({useAuthStore:(s:(v:typeof state)=>unknown)=>s(state)}));
vi.mock('../src/components/class/structure/structure-shell',()=>({StructureShell:({children}:{children:ReactNode})=><main>{children}</main>}));
vi.mock('../src/components/class/structure/class-host-requests',()=>({ClassHostRequests:()=><div>진행자 요청 패널</div>}));
vi.mock('../src/components/class/structure/class-observer-view',()=>({ClassObserverView:()=>null}));
vi.mock('../src/lib/api/session',()=>({getSession:vi.fn().mockResolvedValue({participants:[]})}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let root:Root;let box:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());box?.remove();});
async function render(){box=document.createElement('div');root=createRoot(box);await act(async()=>root.render(<MemoryRouter><ClassSessionDetail classId="c" sessionId="s"/></MemoryRouter>));}
it('관리자는 편성으로 이동할 수 있지만 진행과 기록지 수정 CTA는 없다',async()=>{state.user={id:'admin',role:'org_admin'};await render();expect(box.querySelector('a[href="/classes/c/sessions"]')).toBeTruthy();expect(box.querySelector('a[href="/sessions/s/player"]')).toBeNull();expect(box.querySelector('a[href="/sessions/s/record"]')).toBeNull();});
it('확정 진행 지도사만 플레이어 진입을 표시한다',async()=>{state.user={id:'host',role:'counselor'};await render();expect(box.querySelector('a[href="/sessions/s/player"]')).toBeTruthy();});

it('대강은 host_view 없이도 host_request 권한으로 자기 요청 패널을 연다',async()=>{state.user={id:'guest',role:'counselor'};Object.assign(state.detail,{host_view:null,capabilities:{manage:false,invite:false,schedule:false,host_request:true}});await render();expect(box.textContent).toContain('진행자 요청 패널');expect(box.querySelector('a[href="/sessions/s/player"]')).toBeNull();});
