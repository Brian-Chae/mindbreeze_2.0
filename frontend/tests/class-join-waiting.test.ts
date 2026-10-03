// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClassJoinPage from '../src/pages/class-join-page';
import { useAuthStore } from '../src/stores/authStore';

const mocks = vi.hoisted(() => ({ state: vi.fn(), lookup: vi.fn(), joins: vi.fn(), mounted: vi.fn(), unmounted: vi.fn(), wake: vi.fn() }));
vi.mock('../src/lib/api/session', () => ({ getSessionByCode: mocks.lookup, getSessionByCodeState: mocks.state, joinSessionByCode: mocks.joins }));
vi.mock('../src/components/class/FadingImageBackground', () => ({ FadingImageBackground: () => null }));
vi.mock('../src/components/class/WelcomeText', () => ({ WelcomeText: () => '기존 환영 화면' }));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: mocks.wake }));
vi.mock('../src/lib/eeg/bluetoothService', () => ({ bluetoothService: { disconnect: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../src/components/class/GuestCompletePanel', () => ({ GuestCompletePanel: () => '완료 화면' }));
vi.mock('../src/components/player/MemberSessionScene', () => ({ MemberSessionScene: () => '명상 화면' }));
vi.mock('../src/components/class/ClassWaitingRoom', () => ({
  ClassWaitingRoom: ({ sessionLive, onEnter, error }: { sessionLive?: boolean; onEnter: (value: { nickname: string; cameraOn: boolean; micOn: boolean }) => void; error?: string }) => {
    const [draft, setDraft] = useState('설문 초안');
    const payload = { nickname: '회원', cameraOn: false, micOn: true };
    useEffect(() => { mocks.mounted(); return () => { mocks.unmounted(); }; }, []);
    useEffect(() => { if (sessionLive) onEnter(payload); }, [sessionLive, onEnter]);
    return createElement('section', null,
      createElement('button', { onClick: () => setDraft('보존된 초안') }, draft),
      createElement('button', { onClick: () => onEnter(payload) }, '입장하기'), error);
  },
}));
let root: Root;
let container: HTMLDivElement;
const session = { id: 's1', title: '저녁 명상', status: 'open', type: 'meditation', duration_min: 50 };
async function flush(): Promise<void> { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuthStore.setState({ isAuthenticated: true, isInitialized: true, user: { id: 'u1', name: '회원', email: 'member@example.test', role: 'client', verified_tier: 'fully_verified', onboarding_completed: true, auth_provider: 'email', counselors: [] } });
  mocks.lookup.mockResolvedValue(session);
  mocks.joins.mockResolvedValue({ participant_id: 'p1', session });
  mocks.state.mockResolvedValue({ status: 'open' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: ['/join?code=ABC123'] }, createElement(ClassJoinPage))); });
  await flush();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
it('시작 전 입장 버튼을 눌러도 같은 대기 화면과 설문 상태를 유지한다', async () => {
  await act(async () => { [...container.querySelectorAll('button')].find(b => b.textContent === '설문 초안')?.click(); });
  await act(async () => { [...container.querySelectorAll('button')].find(b => b.textContent === '입장하기')?.click(); });
  expect(container.textContent).toContain('보존된 초안');
  expect(mocks.mounted).toHaveBeenCalledTimes(1);
  expect(mocks.unmounted).not.toHaveBeenCalled();
});
it('준비 중에도 시작을 감지하여 대기 화면의 이름 게이트를 통해 명상으로 전환한다', async () => {
  mocks.state.mockResolvedValue({ status: 'in_progress', guest_state: 'meditation' });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.textContent).toContain('명상 화면');
  expect(mocks.unmounted).toHaveBeenCalledTimes(1);
});
it('준비 중 종료되면 완료 화면으로 이동한다', async () => {
  mocks.state.mockResolvedValue({ status: 'completed', guest_state: 'complete' });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.textContent).toContain('완료 화면');
});
it('상태 API 실패 시 코드 조회로 시작을 감지한다', async () => {
  mocks.state.mockRejectedValue(new Error('일시 오류'));
  mocks.lookup.mockResolvedValue({ ...session, status: 'in_progress' });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.textContent).toContain('명상 화면');
});
it('준비 중 취소되면 대기 화면에 오류를 표시하고 명상으로 들어가지 않는다', async () => {
  mocks.state.mockResolvedValue({ status: 'cancelled' });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.textContent).toContain('취소');
  expect(container.textContent).not.toContain('명상 화면');
});
it('구버전 guest_state의 시작 신호도 이름 게이트를 거친다', async () => {
  mocks.state.mockResolvedValue({ status: 'open', guest_state: 'meditation' });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.textContent).toContain('명상 화면');
});
