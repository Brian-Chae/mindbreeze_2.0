// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ update: vi.fn(), complete: vi.fn(), dismiss: vi.fn() }));
vi.mock('../src/lib/api/auth', async (original) => ({ ...(await original<object>()), updateUserMe: mocks.update, dismissClientProfile: mocks.dismiss }));
vi.mock('../src/lib/api/onboarding', () => ({ completeClientOnboarding: mocks.complete }));
import { useAuthStore } from '../src/stores/authStore';
import type { User } from '../src/lib/api/auth';
import Essentials from '../src/pages/onboarding/ClientEssentialsPage';
import Optional from '../src/pages/settings/optional-profile-page';
let container: HTMLDivElement; let root: Root;
const user = { id: 'fixture', role: 'client', name: '기존 회원', birth_date: '2020-01-01', gender: null, client_required_fields: ['gender'] } as User;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); useAuthStore.setState({ user, isAuthenticated: true, isInitialized: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function mount(page: typeof Essentials) { await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/form'] }, createElement(Routes, null, createElement(Route, { path: '/form', element: createElement(page) }), createElement(Route, { path: '/app', element: createElement('p', null, '회원 홈') }))))); }
async function click(text: string) { const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text)!; await act(async () => button.click()); }
test('누락 성별만 표시하고 기존 생일을 재판정·재전송하지 않는다', async () => {
  mocks.update.mockResolvedValue({ ...user, gender: 'female', client_required_fields: [] }); mocks.complete.mockResolvedValue({});
  await mount(Essentials);
  expect(container.querySelector('[aria-label="이름"]')).toBeNull(); expect(container.querySelector('[id*=birth]')).toBeNull();
  const select = container.querySelector('select')!;
  await act(async () => { select.value = 'female'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const submit = container.querySelector('button')!; expect(submit.disabled).toBe(false);
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.update).toHaveBeenCalledWith({ gender: 'female' }); expect(mocks.complete).toHaveBeenCalledOnce(); expect(container.textContent).toContain('회원 홈');
});
test('선택 보류는 서버 저장 성공 뒤 홈, 실패는 재시도와 이번만 홈 제공', async () => {
  mocks.dismiss.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...user, client_required_fields: [], profile_prompt_dismissed: true });
  await mount(Optional); await click('나중에 하기');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('저장하지 못했어요');
  expect(container.textContent).toContain('이번에는 홈으로');
  expect(useAuthStore.getState().user?.profile_prompt_dismissed).not.toBe(true);
  await click('다시 시도하기'); expect(useAuthStore.getState().user?.profile_prompt_dismissed).toBe(true); expect(container.textContent).toContain('회원 홈');
});
test('선택 전화 기존 값을 비우면 빈값 삭제 요청 후 홈으로 이동한다', async () => {
  useAuthStore.setState({ user: { ...user, phone: '010-1234-5678', client_required_fields: [] } });
  mocks.update.mockResolvedValue({ ...user, phone: null, client_required_fields: [] });
  await mount(Optional);
  const phone = container.querySelector('input')!; expect(phone.value).toBe('010-1234-5678');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(phone, ''); phone.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.update).toHaveBeenCalledWith({ phone: '' }); expect(useAuthStore.getState().user?.phone).toBeNull(); expect(container.textContent).toContain('회원 홈');
});
test('전화 저장 실패의 재시도는 같은 PATCH를 반복하며 보류 요청을 보내지 않는다', async () => {
  useAuthStore.setState({ user: { ...user, phone: '010-1234-5678', client_required_fields: [] } });
  mocks.update.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...user, phone: '010-1234-5678', client_required_fields: [] });
  await mount(Optional);
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await click('다시 시도하기');
  expect(mocks.update).toHaveBeenCalledTimes(2); expect(mocks.update).toHaveBeenNthCalledWith(2, { phone: '010-1234-5678' }); expect(mocks.dismiss).not.toHaveBeenCalled(); expect(container.textContent).toContain('회원 홈');
});
