// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRoom } from '../src/components/chat/ChatRoom';
import { useChatStore } from '../src/stores/chatStore';
import { useAuthStore } from '../src/stores/authStore';
import type { ChatMessage } from '../src/lib/api/chat';

const api = vi.hoisted(() => ({ listChatMessages: vi.fn(), listChatMessagesAround: vi.fn(), markRoomRead: vi.fn(), markMessagesRead: vi.fn(), sendChatMessage: vi.fn() }));
vi.mock('../src/lib/api/chat', () => api);
vi.mock('../src/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
const message = (id: string): ChatMessage => ({ id, room_id: 'room', sender_id: null, type: 'system', content: `본문 ${id}`, file_url: null, event_type: null, created_at: '2026-09-27T00:00:00Z' });
let root: Root;
let container: HTMLDivElement;
let scrolled: string[];
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  scrolled = [];
  HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.dataset.messageId ?? ''); };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  useAuthStore.setState({ user: null, accessToken: null });
  useChatStore.setState({ messagesByRoom: {} });
  api.listChatMessages.mockResolvedValue({ messages: [message('recent')], next_cursor: null });
  api.markRoomRead.mockRejectedValue(new Error('테스트 읽음 요청 생략'));
  api.listChatMessagesAround.mockResolvedValue({ messages: [message('old')], next_cursor: null });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render(targetMessageId?: string) {
  await act(async () => root.render(createElement(ChatRoom, { roomId: 'room', ...{ targetMessageId } })));
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
}
it('최근 목록 밖 메시지를 주변 조회하여 포커스·스크롤·하이라이트한다', async () => {
  await render('old');
  expect(container.textContent).toContain('본문 old');
  expect(scrolled).toContain('old');
  expect(document.activeElement?.getAttribute('data-message-id')).toBe('old');
  expect(container.querySelector('[data-message-id=old]')?.textContent).toContain('알림의 메시지');
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(container.querySelector('[data-message-id=old]')?.textContent ?? '').not.toContain('알림의 메시지');
});
it('같은 방의 message 변경 때 새 대상을 탐색한다', async () => {
  await render('old');
  api.listChatMessagesAround.mockResolvedValue({ messages: [message('other')], next_cursor: null });
  await render('other');
  expect(scrolled.at(-1)).toBe('other');
  expect(container.textContent).toContain('본문 other');
});
it.each(['missing', 'failure'])('대상 %s이면 최근 대화로 돌아갈 수 있다', async (mode) => {
  if (mode === 'failure') api.listChatMessagesAround.mockRejectedValue(new Error('조회 실패'));
  else api.listChatMessagesAround.mockResolvedValue({ messages: [], next_cursor: null });
  await render('old');
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === '최근 대화 보기');
  expect(button).toBeDefined();
  expect(container.querySelector('input')?.disabled).toBe(true);
  await act(async () => button!.click());
  expect(container.textContent).toContain('본문 recent');
  expect(container.querySelector('[data-message-id=old]')?.textContent ?? '').not.toContain('알림의 메시지');
});
it('늦게 도착한 이전 대상 응답은 새 대상을 덮어쓰지 않는다', async () => {
  let resolveOld!: (value: { messages: ChatMessage[] }) => void;
  api.listChatMessagesAround.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  await render('old');
  api.listChatMessagesAround.mockResolvedValue({ messages: [message('other')] });
  await render('other');
  await act(async () => resolveOld({ messages: [message('old')] }));
  expect(container.textContent).toContain('본문 other');
  expect(container.textContent).not.toContain('본문 old');
});

it('최근 대화 복귀 후 동일 메시지 알림을 다시 탐색한다', async () => {
  await render('old');
  await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent === '최근 대화 보기')!.click());
  await render(undefined);
  const previousScrollCount = scrolled.length;
  await render('old');
  expect(scrolled.length).toBeGreaterThan(previousScrollCount);
  expect(document.activeElement?.getAttribute('data-message-id')).toBe('old');
});
