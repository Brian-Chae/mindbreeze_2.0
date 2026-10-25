// @vitest-environment jsdom
// 채팅 신고 메뉴 정리: 메시지별·상단 신고 버튼 제거, ⋯ 메뉴(나가기·신고하기), 열람 presence 전송.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listChatMessages: vi.fn(),
  listChatMessagesAround: vi.fn(),
  sendChatMessage: vi.fn(),
  markRoomRead: vi.fn(async () => ({})),
  markMessagesRead: vi.fn(async () => ({})),
  listChatRooms: vi.fn(async () => ({ rooms: [] })),
  unblockChatUser: vi.fn(),
  reportChatUser: vi.fn(async () => ({ report_id: 'r', blocked: true })),
}));
vi.mock('../src/lib/api/chat', async (orig) => ({ ...(await orig<object>()), ...api }));
const socket = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));
vi.mock('../src/lib/socket', () => ({ getChatSocket: () => socket }));
vi.mock('../src/stores/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ fetch: vi.fn(async () => {}) }) },
}));

import { ChatRoom } from '../src/components/chat/ChatRoom';
import { RoomActionsMenu } from '../src/components/chat/RoomActionsMenu';
import { useAuthStore } from '../src/stores/authStore';
import { useChatStore } from '../src/stores/chatStore';
import type { ChatMessage, ChatRoom as ChatRoomDto } from '../src/lib/api/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

const room = (over: Partial<ChatRoomDto>): ChatRoomDto => ({
  id: 'room', session_id: null, room_type: 'direct', host_id: null, name: null, peer_name: '김상담', peer_id: 'peer',
  session_title: null, session_scheduled_at: null, participant_count: 2, created_at: '2026-10-25T00:00:00Z', unread_count: 0,
  ...over,
} as ChatRoomDto);
const msg = (id: string, senderId: string, name = '타인'): ChatMessage => ({
  id, room_id: 'room', sender_id: senderId, sender_name: name, type: 'text', content: `내용-${id}`,
  file_url: null, event_type: null, created_at: '2026-10-25T00:00:00Z',
} as ChatMessage);
const btn = (t: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === t) as HTMLButtonElement | undefined;
const menuItems = (): string[] => Array.from(document.querySelectorAll('[role=menuitem]')).map((e) => e.textContent?.trim() ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn();
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
  api.listChatMessages.mockResolvedValue({ messages: [] });
  useAuthStore.setState({ isAuthenticated: true, accessToken: 'token', user: { id: 'me', name: '나', email: 'm@x.com', role: 'client' } } as never);
  useChatStore.setState({ rooms: [room({})], messagesByRoom: {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('채팅방 본문', () => {
  it('상대 메시지에도 신고 버튼이 없고 상단 상대방 신고도 없다', async () => {
    api.listChatMessages.mockResolvedValue({ messages: [msg('m2', 'peer'), msg('m1', 'peer')] });
    await act(async () => { root.render(createElement(ChatRoom, { roomId: 'room' })); });
    expect(container.textContent).toContain('내용-m1');
    expect(container.textContent).not.toContain('신고');
    expect(container.querySelector('[aria-label="이 메시지 신고"]')).toBeNull();
  });

  it('입장 시 room_viewing true, 탭이 숨겨지면 false, 언마운트 시 false 를 보낸다', async () => {
    await act(async () => { root.render(createElement(ChatRoom, { roomId: 'room' })); });
    expect(socket.emit).toHaveBeenCalledWith('room_viewing', { room_id: 'room', viewing: true });
    socket.emit.mockClear();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(socket.emit).toHaveBeenCalledWith('room_viewing', { room_id: 'room', viewing: false });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(socket.emit).toHaveBeenLastCalledWith('room_viewing', { room_id: 'room', viewing: true });
    socket.emit.mockClear();
    await act(async () => root.unmount());
    expect(socket.emit).toHaveBeenCalledWith('room_viewing', { room_id: 'room', viewing: false });
    root = createRoot(container);
  });
});

describe('RoomActionsMenu ⋯ (상단 바)', () => {
  const open = async (props: Parameters<typeof RoomActionsMenu>[0]): Promise<void> => {
    await act(async () => { root.render(createElement(RoomActionsMenu, props)); });
    await act(async () => { (container.querySelector('button[aria-haspopup=menu]') as HTMLButtonElement).click(); });
  };

  it('onLeave 가 있으면 신고하기·나가기가 메뉴에 있다', async () => {
    await open({ room: room({}), onSettings: vi.fn(), onLeave: vi.fn() });
    expect(menuItems()).toEqual(expect.arrayContaining(['채팅방 설정', '신고하기', '나가기']));
  });

  it('목록 항목용(onLeave 없음) 메뉴에는 신고하기·나가기가 없다', async () => {
    await open({ room: room({}), onSettings: vi.fn() });
    expect(menuItems()).toEqual(['채팅방 설정']);
  });

  it('차단 해제도 같은 메뉴에 통합된다', async () => {
    await open({ room: room({ is_blocked: true }), onSettings: vi.fn(), onLeave: vi.fn() });
    expect(menuItems()).toEqual(expect.arrayContaining(['차단 해제', '신고하기', '나가기']));
  });

  it('나가기는 확인 단계를 거친 뒤에만 콜백을 부른다 (취소하면 안 부름)', async () => {
    const onLeave = vi.fn();
    await open({ room: room({}), onSettings: vi.fn(), onLeave });
    await act(async () => { btn('나가기')!.click(); });
    expect(onLeave).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alertdialog]')).not.toBeNull();
    await act(async () => { btn('취소')!.click(); });
    expect(onLeave).not.toHaveBeenCalled();
    await act(async () => { (container.querySelector('button[aria-haspopup=menu]') as HTMLButtonElement).click(); });
    await act(async () => { btn('나가기')!.click(); });
    const confirm = Array.from(document.querySelectorAll('[role=alertdialog] button')).find((b) => b.textContent === '나가기') as HTMLButtonElement;
    await act(async () => { confirm.click(); });
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('1:1 신고하기는 신고 다이얼로그를 열고, 제출해야 신고 API 를 부른다', async () => {
    await open({ room: room({}), onSettings: vi.fn(), onLeave: vi.fn() });
    await act(async () => { btn('신고하기')!.click(); });
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('김상담 님 신고');
    expect(api.reportChatUser).not.toHaveBeenCalled();
    await act(async () => { btn('신고하고 차단')!.click(); });
    expect(api.reportChatUser).toHaveBeenCalledWith(expect.objectContaining({ target_user_id: 'peer', room_id: 'room' }));
  });

  it('그룹 방은 대화에 나온 상대 중 신고 대상을 먼저 고른다', async () => {
    useChatStore.setState({ messagesByRoom: { room: [msg('a', 'u1', '가나'), msg('b', 'me', '나'), msg('c', 'u2', '다라')] } });
    await open({ room: room({ room_type: 'group', peer_id: null, peer_name: null, name: '그룹' }), onSettings: vi.fn(), onLeave: vi.fn() });
    await act(async () => { btn('신고하기')!.click(); });
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('누구를 신고할까요?');
    expect(btn('가나')).toBeDefined();
    expect(btn('다라')).toBeDefined();
    expect(btn('나')).toBeUndefined();
    await act(async () => { btn('다라')!.click(); });
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('다라 님 신고');
  });
});
