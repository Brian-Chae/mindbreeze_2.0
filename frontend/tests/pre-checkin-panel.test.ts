// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PreCheckinPanel } from '../src/components/class/PreCheckinPanel';
import { submitCheckin } from '../src/lib/api/checkin';
vi.mock('../src/lib/api/checkin', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api/checkin')>(), submitCheckin: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
const props = { sessionId: 's1', participantId: 'p1', participantToken: 'guest-token', isLoggedIn: false };
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent === text);
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
it('명시적 건너뛰기를 부모에게 알리고 완료 내용을 남긴다', async () => {
  const onSkipped = vi.fn();
  await act(async () => root.render(createElement(PreCheckinPanel, { ...props, onSkipped })));
  await click('건너뛰기');
  expect(onSkipped).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('설문을 건너뛰었습니다');
  expect(submitCheckin).not.toHaveBeenCalled();
});
it('저장 실패는 완료로 보고하지 않으며 입력을 유지한다', async () => {
  vi.mocked(submitCheckin).mockRejectedValue(new Error('offline'));
  const onSubmitted = vi.fn();
  await act(async () => root.render(createElement(PreCheckinPanel, { ...props, onSubmitted })));
  await act(async () => container.querySelector('fieldset button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await click('체크인 남기기');
  expect(onSubmitted).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-pressed="true"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('실패');
});
