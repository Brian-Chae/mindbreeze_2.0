// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import ChatPage from '../src/pages/chat/ChatPage';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomActionsMenu } from '../src/components/chat/RoomActionsMenu';
import { RoomSettingsModal } from '../src/components/chat/RoomSettingsModal';
import { InviteMemberModal } from '../src/components/chat/InviteMemberModal';
import ClientChatPage from '../src/pages/client/ClientChatPage';
import { useAuthStore } from '../src/stores/authStore';
import { useChatStore } from '../src/stores/chatStore';
import type { UserRole } from '../src/lib/api/auth';
import { getChatRoom, listChatRooms, listChatRoomParticipants, type ChatRoom } from '../src/lib/api/chat';
import { listInvitableCounselors } from '../src/lib/api/chat-invite';
import { listClients } from '../src/lib/api/clients';
vi.mock('../src/lib/api/chat', () => ({ getChatRoom: vi.fn(), listChatRooms: vi.fn(), listChatRoomParticipants: vi.fn(), addChatRoomParticipants: vi.fn(), removeChatRoomParticipant: vi.fn(), updateChatRoom: vi.fn() }));
vi.mock('../src/lib/api/clients', () => ({ listClients: vi.fn() }));
vi.mock('../src/lib/api/chat-invite', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/lib/api/chat-invite')>(), forkChatRoom: vi.fn(), listInvitableCounselors: vi.fn() }));
vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/components/chat/CreateRoomModal', () => ({ CreateRoomModal: () => null }));
vi.mock('../src/components/client/ClientShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/components/chat/ChatRoom', () => ({ ChatRoom: () => null }));
vi.mock('../src/hooks/useChatSortPreference', () => ({ useChatSortPreference: () => ({ unreadFirst: false, setUnreadFirst: vi.fn() }) }));
const room: ChatRoom = { id: 'source', room_type: 'group', host_id: 'host', peer_id: 'peer', peer_name: '상대', name: '그룹', session_id: null, session_title: null, session_scheduled_at: null, participant_count: 2, created_at: '2026-09-25', unread_count: 3, can_rename: true };
let root: Root;
let container: HTMLDivElement;
function setRole(role: UserRole, id = 'host'): void {
  useAuthStore.setState({ user: { id, name: '사용자', email: '', role, verified_tier: 'fully_verified', onboarding_completed: true, auth_provider: 'email', counselors: [{ id: 'host', name: '상담사', profile_image: null }] } });
}
async function render(node: ReactNode): Promise<void> { await act(async () => { root.render(node); }); }
async function click(element: Element | null): Promise<void> {
  expect(element).not.toBeNull();
  await act(async () => { (element as HTMLElement).click(); });
}
function button(text: string): HTMLButtonElement | undefined { return [...document.querySelectorAll('button')].find((element) => element.textContent === text); }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  setRole('counselor');
  useChatStore.setState({ rooms: [room], messagesByRoom: {} });
  vi.mocked(getChatRoom).mockResolvedValue(room);
  vi.mocked(listChatRooms).mockResolvedValue({ rooms: [room] });
  vi.mocked(listChatRoomParticipants).mockResolvedValue({ participants: [{ user_id: 'peer', name: '참여자', role: 'client' }] });
  vi.mocked(listInvitableCounselors).mockResolvedValue({ counselors: [{ user_id: 'new', name: '새 상담사', role: 'counselor', org_names: ['기관'] }], total: 1, page: 1 });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
it.each([['counselor', 'host', true], ['org_admin', 'manager', true], ['counselor', 'other', false], ['client', 'host', false], ['platform_admin', 'host', false]] as const)('메뉴의 %s / %s 초대 노출은 %s', async (role, id, visible) => {
  setRole(role, id);
  await render(createElement(RoomActionsMenu, { room, onSettings: vi.fn(), onInvite: vi.fn() }));
  await click(document.querySelector('[aria-haspopup=menu]'));
  expect(!!button('회원 초대')).toBe(visible);
  expect(button('채팅방 설정')).toBeDefined();
});
it('메뉴 화살표 이동과 Escape 포커스 복귀', async () => {
  await render(createElement(RoomActionsMenu, { room, onSettings: vi.fn(), onInvite: vi.fn() }));
  const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup=menu]')!;
  await click(trigger);
  expect(document.activeElement).toBe(button('회원 초대'));
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(document.activeElement).toBe(button('채팅방 설정'));
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(trigger);
});
it('기관 관리자는 설정에서도 회원 초대에 접근하지만 내보내기는 제공하지 않는다', async () => {
  setRole('org_admin', 'manager');
  const invite = vi.fn();
  await render(createElement(RoomSettingsModal, { room, onClose: vi.fn(), onInvite: invite }));
  await click(button('회원 초대')!);
  expect(invite).toHaveBeenCalledWith(room);
  expect(button('내보내기')).toBeUndefined();
});
it('direct 모달은 기존 방식 비활성과 사유를 표시하고 이전 메시지 미복사를 안내한다', async () => {
  const direct = { ...room, room_type: 'direct' as const };
  vi.mocked(getChatRoom).mockResolvedValue(direct);
  await render(createElement(InviteMemberModal, { room: direct, onClose: vi.fn(), onSuccess: vi.fn() }));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  await click(document.querySelector('input[type=checkbox]'));
  await click(button('다음 · 1명')!);
  const radios = document.querySelectorAll<HTMLInputElement>('input[type=radio]');
  expect(radios[0].disabled).toBe(true);
  expect(radios[1].disabled).toBe(false);
  expect(document.body.textContent).toContain('1:1 채팅은 새 그룹방으로만 초대할 수 있습니다.');
  expect(document.body.textContent).toContain('이전 메시지와 파일은 새 방으로 옮겨지지 않습니다.');
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
  expect(document.activeElement?.textContent).toBe('어떻게 초대할까요?');
});
it('실제 내담자 페이지는 초대받은 방을 표시하지만 메뉴·설정에 초대가 없고 후보 API를 호출하지 않는다', async () => {
  setRole('client', 'peer');
  vi.mocked(getChatRoom).mockResolvedValue({ ...room, can_rename: false });
  await render(createElement(MemoryRouter, { initialEntries: ['/app/chat'] }, createElement(ClientChatPage)));
  expect(document.body.textContent).toContain('그룹');
  await click(document.querySelector('[aria-haspopup=menu]'));
  expect(button('회원 초대')).toBeUndefined();
  await click(button('채팅방 설정')!);
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  expect(button('회원 초대')).toBeUndefined();
  expect(button('참여자 추가')).toBeUndefined();
  expect(listInvitableCounselors).not.toHaveBeenCalled();
  expect(listClients).not.toHaveBeenCalled();
});

it('설정에서 초대를 열고 취소하면 단일 dialog로 원래 설정에 돌아간다', async () => {
  await render(createElement(MemoryRouter, { initialEntries: ['/chat'] }, createElement(ChatPage)));
  await click(document.querySelector('[aria-haspopup=menu]'));
  await click(button('채팅방 설정')!);
  await click(button('회원 초대')!);
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('채팅방에 회원 초대');
  await click(button('취소')!);
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('채팅방 설정');
});
it('방 경로가 변경되면 기존 방의 초대 모달을 닫는다', async () => {
  let navigate!: NavigateFunction;
  function Harness() {
    navigate = useNavigate();
    return createElement(Routes, null, createElement(Route, { path: '/chat/:roomId', element: createElement(ChatPage) }));
  }
  await render(createElement(MemoryRouter, { initialEntries: ['/chat/source'] }, createElement(Harness)));
  await click(document.querySelector('[aria-haspopup=menu]'));
  await click(button('회원 초대')!);
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  await act(async () => navigate('/chat/other'));
  expect(document.querySelector('[role=dialog]')).toBeNull();
});
