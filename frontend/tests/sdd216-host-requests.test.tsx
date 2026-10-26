// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ClassHostRequests } from '../src/components/class/structure/class-host-requests';
const api=vi.hoisted(()=>({hostRequests:vi.fn(),candidates:vi.fn().mockResolvedValue({instructors:[]}),resolveHost:vi.fn().mockResolvedValue({}),requestHost:vi.fn()}));
vi.mock('../src/lib/api/class-scheduling',()=>({schedulingApi:api}));
const current=vi.hoisted(()=>({user:{id:'candidate',role:'counselor'}}));
vi.mock('../src/stores/authStore',()=>({useAuthStore:(selector:(s:typeof current)=>unknown)=>selector(current)}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let root:Root;let box:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());box?.remove();vi.clearAllMocks();});
async function render(manager=false){api.hostRequests.mockResolvedValue({requests:[{id:'r',candidate_host_id:'candidate',requested_by:'host',status:'pending_ack'}]});box=document.createElement('div');root=createRoot(box);await act(async()=>root.render(<ClassHostRequests classId="c" sessionId="s" revision={2} stateVersion={3} status="scheduled" hostId="host" manager={manager} onSaved={()=>undefined}/>));}
it('수락 후보에게만 수락·거절을 표시하고 request id로 처리한다',async()=>{current.user.id='candidate';await render();const button=[...box.querySelectorAll('button')].find(b=>b.textContent==='수락')!;expect(button).toBeTruthy();await act(async()=>button.click());expect(api.resolveHost).toHaveBeenCalledWith('c','s','r',expect.objectContaining({action:'accept',expected_revision:2}));});
it('다른 강사에게 후보 수락 CTA를 표시하지 않는다',async()=>{current.user.id='other';await render();expect(box.textContent).not.toContain('수락하기');expect([...box.querySelectorAll('button')].some(b=>b.textContent==='수락')).toBe(false);});
it('비관리자 요청 조회는 관리 전용 후보 API를 호출하지 않는다',async()=>{current.user.id='candidate';await render();expect(api.candidates).not.toHaveBeenCalled();expect([...box.querySelectorAll('button')].some(b=>b.textContent==='수락')).toBe(true);});
