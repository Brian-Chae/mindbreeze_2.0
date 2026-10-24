// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ClientInvitePage from '../src/pages/clients/ClientInvitePage';
import { useAuthStore } from '../src/stores/authStore';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('설정에서 옮긴 고정 상담사 코드를 표시·복사하고 초대 생성 동작은 별도로 유지한다',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const writeText=vi.fn().mockResolvedValue(undefined);
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 useAuthStore.setState({isInitialized:true,isAuthenticated:true,user:{id:'fixture',role:'counselor',name:'예시',email:'sample@example.test',counselor_code:'SAMPLE'} as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>});
 const host=document.createElement('div');const root=createRoot(host);
 await act(async()=>root.render(<MemoryRouter><ClientInvitePage/></MemoryRouter>));
 expect(host.textContent).toContain('SAMPLE');
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent==='초대 코드 복사')!.click());
 expect(writeText).toHaveBeenCalledExactlyOnceWith('SAMPLE');
 expect(host.querySelector('[role=status]')?.textContent).toContain('복사했어요');
 expect(host.querySelector('input[type=email]')).not.toBeNull();
 expect(host.querySelector('button[type=submit]')?.textContent).toContain('초대 링크 생성');
 await act(async()=>root.unmount());
});
