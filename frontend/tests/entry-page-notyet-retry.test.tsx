// @vitest-environment jsdom
// 열리기 전(409 session_not_open) 대기 화면에서 재시도해도 '입장 정보를 확인하고 있어요'로 깜빡이지 않는다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import { useAuthStore } from '../src/stores/authStore';

const api = vi.hoisted(() => ({ invited: vi.fn(), state: vi.fn() }));
vi.mock('../src/lib/api/class-flow', async (original) => ({
  ...(await original<typeof import('../src/lib/api/class-flow')>()),
  enterInvitedSession: api.invited, getEntryState: api.state,
}));
vi.mock('../src/hooks/useWaitingRoomPresence', () => ({ useWaitingRoomPresence: () => undefined }));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: () => undefined }));
import EntryPage from '../src/pages/class/EntryPage';

const sid = 'a1111111-1111-4111-8111-111111111111';
let root: Root;
let container: HTMLDivElement;
const text = () => container.textContent ?? '';

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) });
  sessionStorage.clear(); useAuthStore.setState({ isAuthenticated: true, user: null });
  api.invited.mockReset(); api.state.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAuthStore.setState({ isAuthenticated: false, user: null }); });

it('입장 대기하기 재시도 중에도 상태 카드를 유지한다(깜빡임 없음)', async () => {
  let release: (v: unknown) => void = () => undefined;
  api.invited.mockRejectedValueOnce(new ApiError(409, 'Conflict', { detail: { code: 'session_not_open' } }));
  await act(async () => root.render(<MemoryRouter initialEntries={[`/class/${sid}/enter`]}>
    <Routes><Route path="/class/:sessionId/enter" element={<EntryPage />} /></Routes>
  </MemoryRouter>));
  expect(text()).toContain('아직 열리지 않았어요');
  api.invited.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const wait = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('입장 대기하기'));
  await act(async () => wait!.click());
  expect(api.invited).toHaveBeenCalledTimes(2);
  // 재시도 응답 대기 중에도 카드가 남아 있어야 한다
  expect(text()).toContain('아직 열리지 않았어요');
  expect(text()).not.toContain('입장 정보를 확인하고 있어요');
  await act(async () => release(undefined));
});
