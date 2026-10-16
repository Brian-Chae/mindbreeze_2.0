// @vitest-environment jsdom
// SDD-208 I1 — 종료 화면(M21): 점수 없는 "수고하셨어요" 카드 + 리포트 받기·오늘 상태 남기기를 시트로 연다(plan D5).
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemberEndScene } from '../src/components/player/MemberEndScene';

vi.mock('../src/components/class/ReportEmailRequestPanel', () => ({
  ReportEmailRequestPanel: (props: { isLoggedIn: boolean; accountEmail: string | null }) =>
    createElement('div', { 'data-testid': 'report-panel' }, `리포트 신청 폼 ${props.isLoggedIn ? props.accountEmail : '게스트'}`),
}));
vi.mock('../src/components/class/SelfCheckinPanel', () => ({
  SelfCheckinPanel: () => createElement('div', { 'data-testid': 'checkin-panel' }, '오늘 수업 이후 어떠신가요?'),
}));
vi.mock('../src/components/class/FadingImageBackground', () => ({ FadingImageBackground: () => null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const base = {
  sessionId: 's1',
  sessionTitle: '저녁 명상',
  startedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
  durationMin: 50,
  participantId: 'p1',
  participantToken: 'ptok',
  accountEmail: null as string | null,
  isLoggedIn: false,
  error: null as string | null,
  onReset: vi.fn(),
};
const render = (props: Partial<typeof base> = {}) => act(async () => root.render(
  createElement(MemoryRouter, { initialEntries: ['/join'] },
    createElement(Routes, null,
      createElement(Route, { path: '/join', element: createElement(MemberEndScene, { ...base, ...props }) }),
      createElement(Route, { path: '/', element: createElement('p', null, '홈 화면') }),
      createElement(Route, { path: '/role-redirect', element: createElement('p', null, '역할별 대시보드') })),
  ),
));
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

it('수고하셨어요 카드에 수업명·함께한 시간이 있고 점수·퍼센트 숫자는 없다', async () => {
  await render();
  expect(container.textContent).toContain('수고하셨어요');
  expect(container.textContent).toContain('저녁 명상');
  expect(container.textContent).toContain('31분');
  expect(container.textContent).not.toMatch(/\d+\s*%/);
});

it('리포트 받기·오늘 상태 남기기 버튼이 각각 기존 패널을 시트로 연다', async () => {
  await render({ isLoggedIn: true, accountEmail: 'me@example.test' });
  expect(container.querySelector('[data-testid="report-panel"]')).toBeNull();
  await click(button('리포트 받기'));
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="report-panel"]')?.textContent).toBe('리포트 신청 폼 me@example.test');
  await click(container.querySelector('[role="dialog"] button[aria-label*="닫"]'));
  expect(container.querySelector('[data-testid="report-panel"]')).toBeNull();
  await click(button('오늘 상태 남기기'));
  expect(container.querySelector('[data-testid="checkin-panel"]')).not.toBeNull();
});

it('세션 id 가 없으면 리포트·체크인 버튼을 그리지 않는다', async () => {
  await render({ sessionId: null as unknown as string });
  expect(button('리포트 받기')).toBeNull();
  expect(button('오늘 상태 남기기')).toBeNull();
});

it('게스트는 "홈으로", 회원은 "대시보드로 이동" 이며 누르면 상태를 정리하고 이동한다', async () => {
  const onReset = vi.fn();
  await render({ onReset });
  expect(button('대시보드로 이동')).toBeNull();
  await click(button('홈으로'));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('홈 화면');
});

it('로그인 회원은 역할별 대시보드로 이동한다', async () => {
  const onReset = vi.fn();
  await render({ isLoggedIn: true, accountEmail: 'me@example.test', onReset });
  await click(button('대시보드로 이동'));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('역할별 대시보드');
});

it('오류 문구는 알림(role=alert)으로 이어서 보여 준다', async () => {
  await render({ error: '클래스가 취소되었습니다.' });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('클래스가 취소되었습니다.');
});
