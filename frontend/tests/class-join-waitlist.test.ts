// @vitest-environment jsdom
// SDD-208 I1 — 입장 페이지가 join 응답으로 대기열 여부를 판별해 진행 씬에 넘기고, 자리가 나면 자동으로 입장 화면으로 바꾼다.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClassJoinPage from '../src/pages/class-join-page';
import { useAuthStore } from '../src/stores/authStore';

const mocks = vi.hoisted(() => ({ state: vi.fn(), lookup: vi.fn(), joins: vi.fn(), sceneProps: [] as Array<Record<string, unknown>> }));
vi.mock('../src/lib/api/session', () => ({ getSessionByCode: mocks.lookup, getSessionByCodeState: mocks.state, joinSessionByCode: mocks.joins }));
vi.mock('../src/components/class/FadingImageBackground', () => ({ FadingImageBackground: () => null }));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }));
vi.mock('../src/hooks/useSessionLiveSocket', () => ({ useSessionLiveSocket: () => ({ isConnected: false }) }));
vi.mock('../src/lib/eeg/bluetoothService', () => ({ bluetoothService: { disconnect: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../src/components/player/MemberEndScene', () => ({ MemberEndScene: () => '종료 화면' }));
vi.mock('../src/components/player/MemberSessionScene', () => ({
  MemberSessionScene: (props: Record<string, unknown>) => {
    mocks.sceneProps.push(props);
    return props.waitlisted ? '대기열 화면' : '진행 화면';
  },
}));
vi.mock('../src/components/player/MemberWaitingScene', () => ({
  MemberWaitingScene: ({ onEnter }: { onEnter: (value: { nickname: string; cameraOn: boolean; micOn: boolean }) => void }) =>
    createElement('button', { onClick: () => onEnter({ nickname: '회원', cameraOn: false, micOn: true }) }, '입장하기'),
}));

let root: Root;
let container: HTMLDivElement;
const base = { id: 's1', title: '저녁 명상', status: 'in_progress', type: 'meditation', duration_min: 50, started_at: '2026-10-16T10:00:00Z' };
const sessionWith = (waitlisted: boolean) => ({
  ...base,
  participants: [
    { participant_id: 'someone', is_waitlisted: false },
    { participant_id: 'p1', is_waitlisted: waitlisted },
  ],
});
async function flush(ms = 1): Promise<void> { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.sceneProps.length = 0;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuthStore.setState({ isAuthenticated: true, isInitialized: true, user: { id: 'u1', name: '회원', email: 'member@example.test', role: 'client', verified_tier: 'fully_verified', onboarding_completed: true, auth_provider: 'email', counselors: [] } });
  mocks.lookup.mockResolvedValue(base);
  mocks.state.mockResolvedValue({ status: 'in_progress', guest_state: 'meditation' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

/** 입장 페이지를 열어 join 응답이 대기열인지 아닌지에 따라 대기 단계까지 진행한다 */
async function mount(waitlisted: boolean): Promise<void> {
  mocks.joins.mockResolvedValue({ participant_id: 'p1', session: sessionWith(waitlisted) });
  await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: ['/join?code=ABC123'] }, createElement(ClassJoinPage))); });
  await flush();
}
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

async function enterMeditation(): Promise<void> {
  await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === '입장하기')?.click(); });
  await flush();
}

it('join 응답에서 본인이 대기열이면 진행 씬에 waitlisted=true 를 넘긴다', async () => {
  await mount(true);
  await enterMeditation();
  expect(container.textContent).toContain('대기열 화면');
  expect(mocks.sceneProps.at(-1)).toMatchObject({ waitlisted: true, participantId: 'p1' });
});

it('대기열이 아니면 waitlisted=false 로 바로 진행 화면이다', async () => {
  await mount(false);
  await enterMeditation();
  expect(container.textContent).toContain('진행 화면');
  expect(mocks.sceneProps.at(-1)).toMatchObject({ waitlisted: false });
});

it('대기열 중 5초 간격으로 join 을 다시 불러 자리가 나면 자동으로 진행 화면이 된다', async () => {
  await mount(true);
  await enterMeditation();
  const callsBefore = mocks.joins.mock.calls.length;
  mocks.joins.mockResolvedValue({ participant_id: 'p1', session: sessionWith(false) });
  await flush(5000);
  expect(mocks.joins.mock.calls.length).toBeGreaterThan(callsBefore);
  expect(container.textContent).toContain('진행 화면');
  expect(mocks.sceneProps.at(-1)).toMatchObject({ waitlisted: false });
});

it('대기열이 아닐 때는 join 을 다시 부르지 않는다', async () => {
  await mount(false);
  await enterMeditation();
  const calls = mocks.joins.mock.calls.length;
  await flush(15000);
  expect(mocks.joins.mock.calls.length).toBe(calls);
});

it('수업이 끝나면 새 종료 화면(MemberEndScene)으로 이동한다', async () => {
  await mount(false);
  await enterMeditation();
  mocks.state.mockResolvedValue({ status: 'completed', guest_state: 'complete' });
  await flush(4000);
  expect(container.textContent).toContain('종료 화면');
});
