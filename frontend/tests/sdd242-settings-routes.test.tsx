// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ClientAppPage from '../src/pages/client/ClientAppPage';
import { RoleGuard } from '../src/components/auth/RoleGuard';
import { useAuthStore } from '../src/stores/authStore';
import { apiClient } from '../src/lib/api/client';
vi.mock('../src/components/client/ClientShell', () => ({default: ({children}:{children:ReactNode}) => <main>{children}</main>}));
vi.mock('../src/pages/settings/ClientSettingsPage', () => ({default:()=> <p>회원 설정 내용</p>}));
vi.mock('../src/pages/settings/participation-profile-page', () => ({default:()=> <p>참여 프로필 편집</p>}));
vi.mock('../src/pages/client/ClientHomePage', () => ({default:()=>null}));
vi.mock('../src/pages/client/ClientChatPage', () => ({default:()=>null}));
vi.mock('../src/pages/client/ClientSessionListPage', () => ({default:()=>null}));
vi.mock('../src/pages/client/ClientSessionDetailPage', () => ({default:()=>null}));
vi.mock('../src/pages/client/ClientReportListPage', () => ({default:()=>null}));
vi.mock('../src/pages/client/ClientNotificationPage', () => ({default:()=>null}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([['/app/profile','회원 설정 내용'],['/app/participation-profile','참여 프로필 편집']])('상담사 미연결·조회 대기에도 %s 진입을 보장한다', async(path,text)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 useAuthStore.setState({user:{id:'fixture',name:'예시',email:'sample@example.test',role:'client',counselors:[]} as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>});
 vi.spyOn(apiClient,'get').mockReturnValue(new Promise(()=>undefined));
 const host=document.createElement('div');const root=createRoot(host);
 await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><ClientAppPage/></MemoryRouter>));
 expect(host.textContent).toContain(text);expect(host.textContent).not.toContain('상담사 코드');
 await act(async()=>root.unmount());
});
it.each(['client','platform_admin','counselor','org_admin'] as const)('%s의 전문 프로필 역할 가드를 적용한다',async(role)=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 useAuthStore.setState({isInitialized:true,isAuthenticated:true,user:{id:'fixture',role,name:'예시',email:'sample@example.test'} as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>});
 const host=document.createElement('div');const root=createRoot(host);
 await act(async()=>root.render(<MemoryRouter initialEntries={['/profile/professional']}><Routes><Route path="/profile/professional" element={<RoleGuard role={['counselor','org_admin']}><p>전문 프로필 편집</p></RoleGuard>}/><Route path="/" element={<p>접근 불가</p>}/></Routes></MemoryRouter>));
 expect(host.textContent).toContain(role==='counselor'||role==='org_admin'?'전문 프로필 편집':'접근 불가');
 await act(async()=>root.unmount());
});
