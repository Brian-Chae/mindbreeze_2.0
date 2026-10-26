// @vitest-environment jsdom
// SDD-220 TS32~TS35(FE) · TS3(채팅 부분) — 채팅 신고→상호 차단 UI, AI 비공개 시 루시 채널 제거.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatRoom } from '../src/components/chat/ChatRoom';
import { RoomActionsMenu } from '../src/components/chat/RoomActionsMenu';
import ChatPage from '../src/pages/chat/ChatPage';
import ClientChatPage from '../src/pages/client/ClientChatPage';
import { ApiError } from '../src/lib/api/client';
import { useAuthStore } from '../src/stores/authStore';
import { useChatStore } from '../src/stores/chatStore';
import type { ChatMessage, ChatRoom as ChatRoomDto } from '../src/lib/api/chat';

const api = vi.hoisted(() => ({
  listChatMessages: vi.fn(),
  listChatMessagesAround: vi.fn(),
  listChatRooms: vi.fn(),
  sendChatMessage: vi.fn(),
  markRoomRead: vi.fn(async () => ({})),
  markMessagesRead: vi.fn(async () => ({})),
  reportChatUser: vi.fn(),
}));
vi.mock('../src/lib/api/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/chat')>()),
  ...api,
}));
vi.mock('../src/lib/socket', () => ({
  getChatSocket: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() })),
}));
vi.mock('../src/stores/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ fetch: vi.fn(async () => {}) }) },
}));
const flag = vi.hoisted(() => ({ ai: false }));
vi.mock('../src/lib/feature-flags', () => ({
  isAiEnabled: () => flag.ai,
  isCounselingEnabled: () => true,
  isDesignRoutesEnabled: () => false,
}));
// 페이지 테스트용 — 레이아웃·AI 화면·방 본문은 마운트 여부만 본다.
const mounted = vi.hoisted(() => ({ counselorAgent: 0, clientAgent: 0 }));
vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/components/client/ClientShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/components/chat/CreateRoomModal', () => ({ CreateRoomModal: () => null }));
vi.mock('../src/hooks/useChatSortPreference', () => ({ useChatSortPreference: () => ({ unreadFirst: false, setUnreadFirst: vi.fn() }) }));
vi.mock('../src/pages/agent/counselor-agent-page', () => ({
  default: () => { mounted.counselorAgent += 1; return createElement('div', null, 'COUNSELOR_AGENT'); },
}));
vi.mock('../src/pages/client/ai-agent-page', () => ({
  default: () => { mounted.clientAgent += 1; return createElement('div', null, 'CLIENT_AGENT'); },
}));

const ME = 'me';
const PEER = 'peer';
const directRoom = (changes: Partial<ChatRoomDto> = {}): ChatRoomDto => ({
  id: 'room', session_id: null, room_type: 'direct', host_id: PEER, name: ME, peer_name: '상담사', peer_id: PEER,
  session_title: null, session_scheduled_at: null, participant_count: 2, created_at: '2026-10-08T00:00:00Z',
  unread_count: 1, last_message: { content: '상대 마지막', created_at: '2026-10-08T00:00:00Z' }, ...changes,
});
const msg = (id: string, senderId: string): ChatMessage => ({
  id, room_id: 'room', sender_id: senderId, sender_name: senderId === PEER ? '상담사' : '나', type: 'text',
  content: `내용-${id}`, file_url: null, event_type: null, created_at: '2026-10-08T00:00:00Z',
} as ChatMessage);

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> { await act(async () => { root.render(node); }); }
async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  await act(async () => { (element as HTMLElement).click(); });
}
const button = (text: string) => [...document.querySelectorAll('button')].find((el) => el.textContent === text);

beforeEach(() => {
  vi.clearAllMocks();
  flag.ai = false;
  mounted.counselorAgent = 0;
  mounted.clientAgent = 0;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Element.prototype.scrollTo = vi.fn();
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
  api.listChatMessages.mockResolvedValue({ messages: [msg('m2', ME), msg('m1', PEER)] });
  api.listChatRooms.mockResolvedValue({ rooms: [directRoom({ is_blocked: true, last_message: null, unread_count: 0 })] });
  useChatStore.setState({ rooms: [directRoom()], messagesByRoom: {}, activeRoomId: null });
  useAuthStore.setState({
    isAuthenticated: true, accessToken: 'token',
    user: { id: ME, name: '나', email: 'me@x.com', role: 'client', counselors: [{ id: PEER, name: '상담사', profile_image: null }] },
  } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// 신고 진입점은 방 상단 ⋯ 메뉴의 '신고하기' 하나다(메시지별·상단 '상대방 신고' 버튼은 제거).
async function openReportFromMenu(): Promise<void> {
  await click(document.querySelector('button[aria-haspopup=menu]'));
  await click(document.querySelector('[role=menuitem][type=button]:nth-of-type(2)') && [...document.querySelectorAll('[role=menuitem]')].find((el) => el.textContent === '신고하기'));
}

describe('TS32 신고 → 즉시 상호 차단 UI', () => {
  const renderRoomWithMenu = async (): Promise<void> => {
    await render(createElement('div', null,
      createElement(RoomActionsMenu, { room: directRoom(), onSettings: vi.fn(), onLeave: vi.fn() }),
      createElement(ChatRoom, { roomId: 'room' })));
  };

  it('메시지 옆·방 상단에는 신고 버튼이 없고, ⋯ 메뉴 신고하기 → 사유 선택(선택) → 접수 시 상대 메시지·preview 가 즉시 사라지고 문의 이메일을 안내한다', async () => {
    api.reportChatUser.mockResolvedValue({ reported: true, blocked: true, report_id: 'r1' });
    await renderRoomWithMenu();
    expect(document.body.textContent).toContain('내용-m1');
    expect(document.querySelectorAll('[aria-label="이 메시지 신고"]')).toHaveLength(0);
    expect(button('상대방 신고')).toBeUndefined();

    await openReportFromMenu();
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await click(document.querySelector('input[type=radio]'));
    await click(button('신고하고 차단'));

    expect(api.reportChatUser).toHaveBeenCalledTimes(1);
    expect(api.reportChatUser.mock.calls[0][0]).toMatchObject({ target_user_id: PEER, room_id: 'room', reason: 'abuse' });
    expect(api.reportChatUser.mock.calls[0][0].operation_key).toBeTruthy();

    // 성공 즉시: 상대 메시지 제거, 방 blocked, preview·미읽음 제거, 운영 이메일 링크
    const state = useChatStore.getState();
    expect(state.messagesByRoom.room.map((m) => m.sender_id)).not.toContain(PEER);
    expect(state.rooms[0]).toMatchObject({ is_blocked: true, last_message: null, unread_count: 0 });
    expect(document.querySelector('a[href^="mailto:"]')?.getAttribute('href')).toBe('mailto:admin-mindbreeze@looxidlabs.com'); // [MB261026][FIX] 개인 주소 → 승인된 운영 이메일
    expect(document.body.textContent).not.toContain('내용-m1');
  });

  it('사유 없이도 접수된다', async () => {
    api.reportChatUser.mockResolvedValue({ reported: true, blocked: true, report_id: 'r1' });
    await renderRoomWithMenu();
    await openReportFromMenu();
    await click(button('신고하고 차단'));
    const payload = api.reportChatUser.mock.calls[0][0];
    expect(payload).toMatchObject({ target_user_id: PEER, room_id: 'room' });
    expect(payload.message_id).toBeUndefined();
    expect(payload.reason).toBeUndefined();
  });

  it('접수 실패 후 다시 눌러도 같은 operation_key 로 재전송한다(중복 접수 방지)', async () => {
    api.reportChatUser.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ reported: true, blocked: true, report_id: 'r1' });
    await renderRoomWithMenu();
    await openReportFromMenu();
    await click(button('신고하고 차단'));
    expect(document.querySelector('[role=alert]')?.textContent).toContain('신고를 접수하지 못했습니다');
    await click(button('신고하고 차단'));
    const keys = api.reportChatUser.mock.calls.map((call) => call[0].operation_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('TS33 차단 우회 — UI 는 서버 판정을 따른다', () => {
  it('서버가 is_blocked 로 내려준 방은 입력이 막히고 신고 버튼이 사라지며 문의 이메일이 보인다', async () => {
    useChatStore.setState({ rooms: [directRoom({ is_blocked: true })] });
    await render(createElement(ChatRoom, { roomId: 'room' }));
    expect(document.querySelector('textarea')?.disabled).toBe(true);
    expect(button('상대방 신고')).toBeUndefined();
    expect(document.querySelector('[role=status] a[href^="mailto:"]')).not.toBeNull();
  });

  it('전송이 서버에서 CHAT_BLOCKED 로 거부되면 차단 상태로 전환하고 재전송 버튼을 두지 않는다', async () => {
    api.sendChatMessage.mockRejectedValue(new ApiError(403, '차단', { detail: { code: 'CHAT_BLOCKED' } }));
    await render(createElement(ChatRoom, { roomId: 'room' }));
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '안녕');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('전송'));
    expect(document.querySelector('[role=alert]')?.textContent).toContain('차단된 상대와는 대화할 수 없습니다');
    expect(button('다시보내기')).toBeUndefined();
    expect(useChatStore.getState().rooms[0].is_blocked).toBe(true);
  });

  it('applyBlock 은 그룹 방의 해당 사용자 메시지도 캐시에서 지운다', () => {
    useChatStore.setState({
      rooms: [directRoom({ id: 'g', room_type: 'group', peer_id: null })],
      messagesByRoom: { g: [msg('a', PEER), msg('b', 'other'), { ...msg('sys', ME), sender_id: null }] },
    });
    useChatStore.getState().applyBlock(PEER);
    expect(useChatStore.getState().messagesByRoom.g.map((m) => m.id)).toEqual(['b', 'sys']);
    expect(useChatStore.getState().rooms[0].is_blocked).toBeUndefined(); // direct 방만 표시
  });
});

describe('TS3(채팅) AI 비공개면 루시 채널·embedded agent 가 없다', () => {
  function Where() { return createElement('output', { 'data-testid': 'where' }, useLocation().pathname); }

  it('상담사 ChatPage: 루시 행 0, /chat/lucy 직접 진입은 /chat 으로 replace, agent 마운트 0', async () => {
    useAuthStore.setState({ user: { id: ME, name: '상담사', email: '', role: 'counselor' } } as never);
    await render(createElement(MemoryRouter, { initialEntries: ['/chat/lucy'] },
      createElement(Routes, null, createElement(Route, { path: '/chat/:roomId?', element: createElement('div', null, createElement(ChatPage), createElement(Where)) }))));
    expect(document.body.textContent).not.toContain('루시');
    expect(mounted.counselorAgent).toBe(0);
    expect(document.querySelector('[data-testid=where]')?.textContent).toBe('/chat');
  });

  it('내담자 ClientChatPage: 루시 행 0, /app/chat/lucy 는 /app/chat 으로 replace, agent 마운트 0', async () => {
    await render(createElement(MemoryRouter, { initialEntries: ['/app/chat/lucy'] },
      createElement(Routes, null, createElement(Route, { path: '/app/*', element: createElement('div', null, createElement(ClientChatPage), createElement(Where)) }))));
    expect(document.body.textContent).not.toContain('루시');
    expect(mounted.clientAgent).toBe(0);
    expect(document.querySelector('[data-testid=where]')?.textContent).toBe('/app/chat');
  });

  it('AI 가 켜져 있으면 기존대로 루시 행과 agent 가 보인다(회귀)', async () => {
    flag.ai = true;
    await render(createElement(MemoryRouter, { initialEntries: ['/app/chat/lucy'] },
      createElement(Routes, null, createElement(Route, { path: '/app/*', element: createElement(ClientChatPage) }))));
    expect(document.body.textContent).toContain('루시 (AI)');
    expect(mounted.clientAgent).toBeGreaterThan(0);
  });
});
