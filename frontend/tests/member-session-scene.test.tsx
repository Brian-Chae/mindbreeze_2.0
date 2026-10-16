// @vitest-environment jsdom
// SDD-208 I1 — 회원 진행 씬이 새 화면(MemberClassContainer)을 쓰고, 옛 GuestMeditationPanel 은 더 이상 쓰지 않는다.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemberSessionScene } from '../src/components/player/MemberSessionScene';

const h = vi.hoisted(() => ({ containerProps: [] as Array<Record<string, unknown>>, legacy: vi.fn() }));

vi.mock('../src/components/class/player/member/MemberClassContainer', () => ({
  MemberClassContainer: (props: Record<string, unknown>) => {
    h.containerProps.push(props);
    return createElement('section', { 'data-testid': 'member-container' }, '새 진행 화면');
  },
}));
vi.mock('../src/components/class/GuestMeditationPanel', () => ({
  GuestMeditationPanel: () => {
    h.legacy();
    return createElement('section', null, '옛 진행 화면');
  },
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.containerProps.length = 0;
  h.legacy.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const baseProps = {
  title: '저녁 명상',
  startedAt: '2026-10-16T10:00:00Z',
  durationMin: 50,
  sessionId: 's1',
  participantId: 'p1',
  error: null,
  onLeave: vi.fn(),
  classCode: 'ABC123',
  participantToken: 'tok',
  locationType: 'online' as const,
  participantMode: 'group' as const,
  maxParticipants: 12,
  linkbandMode: 'optional' as const,
};

it('진행 중 구간을 새 컨테이너로 그리고 세션 속성을 그대로 넘긴다', async () => {
  await act(async () => root.render(createElement(MemberSessionScene, baseProps)));
  expect(container.querySelector('[data-testid="member-container"]')).not.toBeNull();
  expect(container.textContent).not.toContain('옛 진행 화면');
  expect(h.legacy).not.toHaveBeenCalled();
  expect(h.containerProps.at(-1)).toMatchObject({
    title: '저녁 명상', sessionId: 's1', participantId: 'p1', classCode: 'ABC123', participantToken: 'tok',
    locationType: 'online', participantMode: 'group', maxParticipants: 12, linkbandMode: 'optional', waitlisted: false,
  });
});

it('대기열 참가자는 waitlisted 로 컨테이너에 알린다', async () => {
  await act(async () => root.render(createElement(MemberSessionScene, { ...baseProps, waitlisted: true })));
  expect(h.containerProps.at(-1)).toMatchObject({ waitlisted: true });
});

it('오류 문구는 화면 아래 알림(role=alert)으로 이어서 보여 준다', async () => {
  await act(async () => root.render(createElement(MemberSessionScene, { ...baseProps, error: '클래스가 취소되었습니다.' })));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('클래스가 취소되었습니다.');
});
