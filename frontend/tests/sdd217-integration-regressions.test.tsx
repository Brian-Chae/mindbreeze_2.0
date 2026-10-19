// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberOperations } from '../src/components/class/structure/member-operations';
import { useAuthStore } from '../src/stores/authStore';
import { tokenStorage } from '../src/lib/api/client';
let root: Root | undefined;
let view: HTMLDivElement | undefined;
afterEach(async () => { if(root) await act(async()=>root!.unmount()); view?.remove();vi.unstubAllGlobals(); });
it('T11 동일 동의값 재조회가 미저장 선택을 지우지 않고 바뀌지 않은 필드만 서버값을 따른다',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 useAuthStore.setState({isAuthenticated:true,user:{id:'t11-member',email:'synthetic@example.test',name:'합성',role:'client',verified_tier:null,onboarding_completed:true,auth_provider:'email',counselors:[]}});
 tokenStorage.set('synthetic-token');
 let reminder=false;
 const writes: Record<string, unknown>[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  const data=url.endsWith('/me/membership')?{class_id:'class',revision:3,member:{id:'member',status:'active'},attendance_summary:{attended:0,absent:0,excused:0,makeup_reserved:0,makeup_completed:0},capabilities:{edit_consents:true},consents:{report_included_default:false,research_consented:false,reminder_opt_in:reminder,notice_version:null,research_notice_version:null}}
   :url.endsWith('/me/attendance')?{sessions:[],total:0}:{class_id:'class',revision:4};
  if(init?.method==='PUT')writes.push(JSON.parse(String(init.body)));
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 }));
 view=document.createElement('div');document.body.append(view);root=createRoot(view);
 await act(async()=>root!.render(<MemoryRouter><MemberOperations classId="class"/></MemoryRouter>));
 const check=()=>view!.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
 await act(async()=>check()[0].click());expect(check()[0].checked).toBe(true);
 await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(check()[0].checked).toBe(true);
 reminder=true;
 await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(check()[0].checked).toBe(true);expect(check()[2].checked).toBe(true);
 const save=Array.from(view.querySelectorAll('button')).find(b=>b.textContent==='동의 설정 저장')!;
 await act(async()=>save.click());
 expect(writes).toHaveLength(1);expect(writes[0].report_included_default).toBe(true);
 expect(writes[0]).not.toHaveProperty('research_consented');expect(writes[0]).not.toHaveProperty('reminder_opt_in');
});
