// @vitest-environment jsdom
// SDD-309: 코치 미연결 회원 화면 — 클래스 화면 틀(MemberFlowFrame), 뒤로 가기 + 다른 계정으로 로그인, 기존 연결 동작 유지.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), logout: vi.fn() }));

vi.mock('../src/lib/api/client', async (orig) => ({
  ...(await orig<object>()),
  apiClient: { post: h.post, get: h.get },
}));

import { useAuthStore } from '../src/stores/authStore';
import { CounselorCodeScreen, CounselorLinkErrorScreen } from '../src/pages/client/counselor-code-screen';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  if (!window.matchMedia) window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as unknown as typeof window.matchMedia;
  h.post.mockReset(); h.get.mockReset(); h.logout.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({ logout: h.logout } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function mount(ui: React.ReactElement, entries: string[] = ['/app/reports']) {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: entries }, createElement(Routes, null,
      createElement(Route, { path: '/app/reports', element: ui }),
      createElement(Route, { path: '/app', element: createElement('p', null, '회원 홈') }),
      createElement(Route, { path: '/join', element: createElement('p', null, '클래스 코드 입장') }),
      createElement(Route, { path: '/login', element: createElement('p', null, '로그인 화면') }))));
  });
}
const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const byText = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
}
async function setInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}

test('V15 클래스 화면 틀 안에서 뒤로 가기와 다른 계정으로 로그인이 보인다', async () => {
  await mount(createElement(CounselorCodeScreen, { onConnected: vi.fn() }));
  expect(container.querySelector('.fl-root')).not.toBeNull();
  expect(byLabel('이전')).not.toBeNull();
  expect(byText('다른 계정으로 로그인')).toBeDefined();
  expect(container.textContent).toContain('코치와 연결하기');
});

test('V15 이전 화면이 있으면 뒤로 가기는 직전 화면으로 간다', async () => {
  await mount(createElement(CounselorCodeScreen, { onConnected: vi.fn() }), ['/app', '/app/reports']);
  await click(byLabel('이전')!);
  expect(container.textContent).toContain('회원 홈');
});

test('V15 이전 화면이 없으면 뒤로 가기는 클래스 코드 입장으로 간다', async () => {
  await mount(createElement(CounselorCodeScreen, { onConnected: vi.fn() }));
  await click(byLabel('이전')!);
  expect(container.textContent).toContain('클래스 코드 입장');
});

test('V15 다른 계정으로 로그인은 로그아웃 후 로그인 화면으로 보낸다', async () => {
  await mount(createElement(CounselorCodeScreen, { onConnected: vi.fn() }));
  await click(byText('다른 계정으로 로그인')!);
  expect(h.logout).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('로그인 화면');
});

test('V15 6자리를 채우면 기존처럼 한 번 연결을 요청하고 목록을 돌려준다', async () => {
  const onConnected = vi.fn();
  h.post.mockResolvedValue({ id: 'c1', name: '김코치', profile_image: null });
  h.get.mockResolvedValue([{ id: 'c1', name: '김코치', profile_image: null }]);
  await mount(createElement(CounselorCodeScreen, { onConnected }));
  await setInput(container.querySelector('input') as HTMLInputElement, '12a3456');
  await act(async () => { await Promise.resolve(); });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0]).toEqual(['/client/counselors', { code: '123456' }]);
  expect(onConnected).toHaveBeenCalledWith([{ id: 'c1', name: '김코치', profile_image: null }]);
});

test('V15 연결 실패 문구를 보이고 입력을 비운다', async () => {
  h.post.mockRejectedValue(new Error('코치 코드를 찾을 수 없습니다'));
  await mount(createElement(CounselorCodeScreen, { onConnected: vi.fn() }));
  const input = container.querySelector('input') as HTMLInputElement;
  await setInput(input, '999999');
  await act(async () => { await Promise.resolve(); });
  expect(container.textContent).toContain('코치 코드를 찾을 수 없습니다');
  expect(input.value).toBe('');
});

test('V15 연결 정보 조회 실패 화면에도 재시도·뒤로·로그인 전환이 있다', async () => {
  const retry = vi.fn();
  await mount(createElement(CounselorLinkErrorScreen, { message: '네트워크 오류', onRetry: retry }));
  expect(container.textContent).toContain('연결 정보를 불러오지 못했습니다');
  await click(byText('다시 시도')!);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(byLabel('이전')).not.toBeNull();
  expect(byText('다른 계정으로 로그인')).toBeDefined();
});

test('V17 금지 문구가 없다', async () => {
  await mount(createElement(CounselorCodeScreen, { onConnected: vi.fn() }));
  for (const word of ['점수', '종합점수', '좋음', '나쁨', '보증', '100%']) expect(container.textContent).not.toContain(word);
});
