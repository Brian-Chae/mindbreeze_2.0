// @vitest-environment jsdom
// 같은 계정을 두 기기에서 쓸 때: 다른 기기가 보낸 내 메시지도 실시간으로 받아야 하고,
// 이 기기에서 보낸 메시지의 소켓 에코는 중복되지 않아야 한다.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatRoom } from '../src/components/chat/ChatRoom';
import { useAuthStore } from '../src/stores/authStore';
import { useChatStore } from '../src/stores/chatStore';
import type { ChatMessage } from '../src/lib/api/chat';

const api = vi.hoisted(() => ({
  listChatMessages: vi.fn(),
  listChatMessagesAround: vi.fn(),
  sendChatMessage: vi.fn(),
  markRoomRead: vi.fn(async () => ({})),
  markMessagesRead: vi.fn(async () => ({})),
}));
vi.mock('../src/lib/api/chat', () => api);

const socket = vi.hoisted(() => {
  const listeners: Record<string, (payload: unknown) => void> = {};
  return {
    listeners,
    getChatSocket: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (payload: unknown) => void) => { listeners[event] = handler; }),
      off: vi.fn(),
    })),
  };
});
vi.mock('../src/lib/socket', () => ({ getChatSocket: socket.getChatSocket }));
vi.mock('../src/stores/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ fetch: vi.fn(async () => {}) }) },
}));

const ME = 'me';
const msg = (id: string, senderId: string): ChatMessage => ({
  id, room_id: 'room', sender_id: senderId, type: 'text', content: `내용-${id}`,
  file_url: null, event_type: null, created_at: '2026-10-08T00:00:00Z',
} as ChatMessage);

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom 에는 없는 브라우저 API
  Element.prototype.scrollTo = vi.fn();
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
  api.listChatMessages.mockResolvedValue({ messages: [] });
  useChatStore.setState({ rooms: [], messagesByRoom: {} });
  useAuthStore.setState({
    isAuthenticated: true, accessToken: 'token',
    user: { id: ME, name: '나', email: 'me@x.com', role: 'client' },
  } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(ChatRoom, { roomId: 'room' })); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const messagesOf = () => useChatStore.getState().messagesByRoom.room ?? [];

it('다른 기기에서 내가 보낸 메시지도 실시간으로 추가된다', async () => {
  await act(async () => { socket.listeners.new_message(msg('from-other-device', ME)); });
  expect(messagesOf().map((m) => m.id)).toEqual(['from-other-device']);
});

it('상대 메시지와 내 다른 기기 메시지가 순서대로 모두 보인다', async () => {
  await act(async () => {
    socket.listeners.new_message(msg('mine-on-phone', ME));
    socket.listeners.new_message(msg('reply-from-peer', 'peer'));
  });
  expect(messagesOf().map((m) => m.id)).toEqual(['reply-from-peer', 'mine-on-phone']);
});

it('이 기기에서 보낸 메시지의 소켓 에코는 중복되지 않는다', async () => {
  useChatStore.getState().appendMessage('room', msg('sent-here', ME)); // handleSend 의 REST 응답
  await act(async () => { socket.listeners.new_message(msg('sent-here', ME)); }); // 서버 브로드캐스트
  expect(messagesOf().filter((m) => m.id === 'sent-here')).toHaveLength(1);
});

it('다른 방의 메시지는 무시한다', async () => {
  await act(async () => { socket.listeners.new_message({ ...msg('other-room', 'peer'), room_id: 'another' }); });
  expect(messagesOf()).toHaveLength(0);
});
