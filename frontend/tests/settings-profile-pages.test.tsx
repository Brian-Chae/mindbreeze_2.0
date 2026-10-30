// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useAuthStore } from '../src/stores/authStore';
import * as counselorApi from '../src/lib/api/counselor';
import * as clientApi from '../src/lib/api/client-profile';
import ProfessionalProfilePage from '../src/pages/settings/professional-profile-page';
import ParticipationProfilePage from '../src/pages/settings/participation-profile-page';
vi.mock('../src/components/layout/AppShell', () => ({ default: ({children}: {children: ReactNode}) => <main>{children}</main> }));
const profile = { id: 'p', email: 'sample@example.test', name: '샘플', role: 'counselor', specialties: ['명상'], qualifications: [], careers: [], version: 7, counselor_code: 'SAMPLE' } satisfies counselorApi.CounselorProfile;
beforeEach(() => vi.restoreAllMocks());
it('전문 편집은 기존 개인5·전문5를 보여주고 기본정보 편집은 분리한다', async () => {
  useAuthStore.setState({user: {id:'u', role:'counselor'} as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>});
  vi.spyOn(counselorApi, 'getCounselorProfile').mockResolvedValue(profile);
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ProfessionalProfilePage /></MemoryRouter>));
  expect(host.textContent).toContain('전문분야');
  expect(host.textContent).toContain('생년월일');
  expect(host.textContent).not.toContain('기본 정보');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/settings');
  await act(async () => root.unmount());
});
it('순수기관은 전문 프로필 폼을 제공하지 않는다', async () => {
  useAuthStore.setState({user: {id:'u', role:'org_admin'} as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>});
  vi.spyOn(counselorApi, 'getCounselorProfile').mockResolvedValue({...profile, counselor_code:null});
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ProfessionalProfilePage /></MemoryRouter>));
  expect(host.textContent).toContain('코치 프로필이 있는 계정만');
  expect(host.querySelector('button')).toBeNull();
  await act(async () => root.unmount());
});
it('회원 참여 편집은 기존4항목만 보여주며 계정기본정보를 중복하지 않는다', async () => {
  vi.spyOn(clientApi, 'getClientProfile').mockResolvedValue({id:'p',email:'sample@example.test',name:'샘플',gender:null,birth_date:null,concerns:['휴식'],interests:['명상']} as clientApi.ClientProfile);
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ParticipationProfilePage /></MemoryRouter>));
  for (const label of ['성별','생년월일','고민','관심']) expect(host.textContent).toContain(label);
  expect(host.textContent).not.toContain('기본 정보');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/app/profile');
  await act(async () => root.unmount());
});
