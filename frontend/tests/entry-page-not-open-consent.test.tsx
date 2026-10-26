// @vitest-environment jsdom
// 회원 회차 입장: 녹음·녹화 동의 후 회차가 아직 열리지 않았으면(409 session_not_open)
// '동의를 저장하지 못했어요'가 아니라 '아직 열리지 않았어요'를 보여 준다.
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

it('동의 후 409 session_not_open 이면 동의 저장 실패가 아니라 아직 열리지 않음 화면', async () => {
  api.invited
    .mockRejectedValueOnce(new ApiError(403, 'Forbidden', { detail: { code: 'RECORDING_CONSENT_REQUIRED' } }))
    .mockRejectedValue(new ApiError(409, 'Conflict', { detail: { code: 'session_not_open' } }));
  await act(async () => root.render(<MemoryRouter initialEntries={[`/class/${sid}/enter`]}>
    <Routes><Route path="/class/:sessionId/enter" element={<EntryPage />} /></Routes>
  </MemoryRouter>));
  expect(text()).toContain('입장 전 확인');
  const box = container.querySelector<HTMLElement>('[role="checkbox"]');
  await act(async () => box!.click());
  const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '동의하고 입장하기');
  await act(async () => confirm!.click());
  expect(text()).not.toContain('동의를 저장하지 못했어요');
  expect(text()).toContain('아직 열리지 않았어요');
  expect(api.invited).toHaveBeenLastCalledWith(sid, expect.objectContaining({ recordingConsent: true }));
});
