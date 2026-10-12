// @vitest-environment jsdom
// SDD-095: 클래스 채팅 패널 — chat_enabled 게이트 · ChatRoom 재사용 · 접힘 시 안읽음 배지
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClassChatPanel } from '../src/components/chat/ClassChatPanel';
import { useAuthStore } from '../src/stores/authStore';
import { useChatStore } from '../src/stores/chatStore';
import { getChatRoom, getSessionChatRoom, type ChatMessage, type ChatRoom } from '../src/lib/api/chat';

/** ChatRoom은 별도로 검증하므로 패널이 방을 넘기는지만 확인한다 */
vi.mock('../src/components/chat/ChatRoom', () => ({
  ChatRoom: ({ roomId }: { roomId: string }) => `CHAT_ROOM:${roomId}`,
}));
vi.mock('../src/lib/api/chat', () => ({ getChatRoom: vi.fn(), getSessionChatRoom: vi.fn() }));

const socket = vi.hoisted(() => {
  const listeners: Record<string, (payload: unknown) => void> = {};
  return {
    listeners,
    getChatSocket: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        listeners[event] = handler;
      }),
      off: vi.fn(),
    })),
  };
});
vi.mock('../src/lib/socket', () => ({ getChatSocket: socket.getChatSocket }));

const room: ChatRoom = {
  id: 'session-room', room_type: 'session', session_id: 'session-1', host_id: 'host',
  name: '클래스 채팅', peer_name: null, peer_id: null, session_title: '명상 클래스',
  session_scheduled_at: null, participant_count: 3, created_at: '2026-09-28T00:00:00Z',
  unread_count: 3,
};

function message(senderId: string): ChatMessage {
  return {
    id: `m-${senderId}`, room_id: 'session-room', sender_id: senderId, type: 'text',
    content: '안녕하세요', file_url: null, event_type: null, created_at: '2026-09-28T00:01:00Z',
  };
}

let root: Root;
let container: HTMLDivElement;

function signIn(): void {
  useAuthStore.setState({
    isAuthenticated: true,
    accessToken: 'access-token',
    user: {
      id: 'host', name: '상담사', email: 'host@example.com', role: 'counselor',
      verified_tier: 'fully_verified', onboarding_completed: true, auth_provider: 'email',
      counselors: [{ id: 'host', name: '상담사', profile_image: null }],
    },
  });
}

/** 접힘 상태를 호출측이 소유하는 제어 컴포넌트 — 실제 통합 방식과 동일하게 배선한다 */
function Harness({ enabled, roomId }: { enabled: boolean; roomId?: string | null }): ReactNode {
  const [collapsed, setCollapsed] = useState(false);
  return createElement(ClassChatPanel, {
    sessionId: 'session-1',
    enabled,
    roomId,
    collapsed,
    onCollapsedChange: setCollapsed,
    title: '클래스 채팅',
  });
}

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((el) => el.textContent === text);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(socket.listeners)) delete socket.listeners[key];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  signIn();
  useChatStore.setState({ rooms: [room], messagesByRoom: {}, activeRoomId: null });
  vi.mocked(getChatRoom).mockResolvedValue(room);
  vi.mocked(getSessionChatRoom).mockResolvedValue({ room_id: 'session-room', room_type: 'session' });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useAuthStore.setState({ isAuthenticated: false, accessToken: null, user: null });
});

it('chat_enabled=false면 채팅 패널을 렌더하지 않는다', async () => {
  await render(createElement(Harness, { enabled: false, roomId: 'session-room' }));
  expect(container.textContent).toBe('');
  expect(document.querySelector('aside')).toBeNull();
});

it('chat_enabled=true면 기존 ChatRoom을 재사용해 세션 방 대화를 보여준다', async () => {
  await render(createElement(Harness, { enabled: true, roomId: 'session-room' }));
  expect(container.textContent).toContain('CHAT_ROOM:session-room');
  expect(container.textContent).toContain('클래스 채팅');
  expect(button('접기')).toBeDefined();
});

it('접으면 안읽음 배지를 유지한 축약 버튼만 남고 다시 펼칠 수 있다', async () => {
  await render(createElement(Harness, { enabled: true, roomId: 'session-room' }));
  await act(async () => { button('접기')?.click(); });
  expect(document.querySelector('aside')).toBeNull();
  expect(container.textContent).toContain('3');
  const expand = document.querySelector<HTMLButtonElement>('[aria-label="클래스 채팅 펼치기"]');
  expect(expand).not.toBeNull();
  await act(async () => { expand?.click(); });
  expect(container.textContent).toContain('CHAT_ROOM:session-room');
});

it('접힘 상태에서도 새 메시지를 세어 배지에 반영하고 내 메시지는 세지 않는다', async () => {
  await render(createElement(Harness, { enabled: true, roomId: 'session-room' }));
  await act(async () => { button('접기')?.click(); });
  const deliver = socket.listeners.new_message;
  expect(deliver).toBeDefined();
  // 상대 메시지 → 배지 +1
  await act(async () => { deliver(message('peer')); });
  expect(useChatStore.getState().rooms[0].unread_count).toBe(4);
  expect(container.textContent).toContain('4');
  // 내가 보낸 메시지 → 증가 없음
  await act(async () => { deliver(message('host')); });
  expect(useChatStore.getState().rooms[0].unread_count).toBe(4);
});

it('방 id 미제공 시 세션 채팅방 조회로 방을 해석한다', async () => {
  vi.mocked(getSessionChatRoom).mockResolvedValue({ room_id: 'dynamic-room', room_type: 'session' });
  await render(createElement(Harness, { enabled: true, roomId: null }));
  await act(async () => {});
  expect(getSessionChatRoom).toHaveBeenCalledWith('session-1');
  expect(container.textContent).toContain('CHAT_ROOM:dynamic-room');
});

it('미인증(게스트)이면 채팅 패널을 숨긴다', async () => {
  useAuthStore.setState({ isAuthenticated: false, accessToken: null, user: null });
  await render(createElement(Harness, { enabled: true, roomId: 'session-room' }));
  expect(container.textContent).toBe('');
});
