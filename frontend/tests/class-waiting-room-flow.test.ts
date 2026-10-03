// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClassWaitingRoom, type ClassWaitingRoomProps } from '../src/components/class/ClassWaitingRoom';
import { useAuthStore } from '../src/stores/authStore';
import { submitCheckin } from '../src/lib/api/checkin';
vi.mock('../src/components/class/waiting-room-reminder', () => ({ WaitingRoomReminder: () => null }));
vi.mock('../src/hooks/useBand', () => ({ useBand: () => ({ connectionState: 'unsupported', isSupported: false }) }));
vi.mock('../src/hooks/useWaitingRoomPresence', () => ({ useWaitingRoomPresence: vi.fn() }));
vi.mock('../src/components/class/LobbyBgmBar', () => ({ LobbyBgmBar: () => null }));
vi.mock('../src/hooks/useLobbyBgm', () => ({ useLobbyBgm: () => ({ state: {}, setVolume: vi.fn(), toggleMute: vi.fn(), resume: vi.fn() }) }));
vi.mock('../src/lib/api/checkin', async (original) => ({ ...await original<typeof import('../src/lib/api/checkin')>(), submitCheckin: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let props: ClassWaitingRoomProps;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks(); localStorage.clear();
  useAuthStore.setState({ isAuthenticated: false, accessToken: null, user: null });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  props = { title: '명상', classCode: 'ABC', statusLabel: '대기 중', sessionId: 's1', participantId: 'p1', memberName: null, initialNickname: '지우', participantToken: 'guest', isLoggedIn: false, onEnter: vi.fn(), onLeave: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(createElement(ClassWaitingRoom, props))); }
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent === text);
  expect(button).toBeDefined(); await act(async () => button?.click());
}
async function tab(index: number) {
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index].click());
}
it('설문·밴드·기기 건너뛰기가 단계 이동과 3/3 준비 완료로 이어진다', async () => {
  await render();
  await click('건너뛰기');
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('링크밴드');
  await click('밴드 없이 진행하기');
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('기기 테스트');
  await click('기기 테스트 건너뛰기');
  expect(container.textContent).toContain('3/3 완료');
  await tab(0);
  expect(container.textContent).toContain('설문을 건너뛰었습니다');
  expect(submitCheckin).not.toHaveBeenCalled();
});
it('탭 이동으로 설문 초안이 사라지지 않으며 숨긴 패널은 hidden이다', async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('fieldset button')?.click());
  await tab(1);
  expect(container.querySelector<HTMLElement>('#preparation-panel-0')?.hidden).toBe(true);
  await tab(0);
  expect(container.querySelector('fieldset button')?.getAttribute('aria-pressed')).toBe('true');
});
it('저장 실패는 설문 탭과 미완료 상태를 유지하고 재시도 성공만 다음 단계로 진행한다', async () => {
  vi.mocked(submitCheckin).mockRejectedValueOnce(new Error('offline'));
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('fieldset button')?.click());
  await click('체크인 남기기');
  expect(container.textContent).toContain('0/3 완료');
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('설문');
  vi.mocked(submitCheckin).mockResolvedValue({} as Awaited<ReturnType<typeof submitCheckin>>);
  await click('체크인 남기기');
  expect(container.textContent).toContain('1/3 완료');
  expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('링크밴드');
});
it('live 상태라도 빈 이름은 자동 입장하지 않는다', async () => {
  props = { ...props, initialNickname: '', sessionLive: true };
  await render();
  expect(props.onEnter).not.toHaveBeenCalled();
});
