// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listChatBlocks: vi.fn(),
  unblockChatUser: vi.fn(),
  withdrawChatReport: vi.fn(),
  listChatRooms: vi.fn(),
}));
vi.mock('../src/lib/api/chat', async (orig) => ({ ...(await orig<object>()), ...api }));

import { BlockedUsersList } from '../src/components/chat/blocked-users-list';
import { RoomActionsMenu } from '../src/components/chat/RoomActionsMenu';
import { useChatStore } from '../src/stores/chatStore';
import type { ChatRoom } from '../src/lib/api/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };
const byText = (t: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === t) as HTMLButtonElement | undefined;

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('BlockedUsersList', () => {
  it('목록을 보여주고 해제 후 다시 불러온다', async () => {
    api.listChatBlocks
      .mockResolvedValueOnce({ blocks: [{ user_id: 'u1', name: '상대', blocked_at: null, report_id: 'r1', report_status: 'submitted' }] })
      .mockResolvedValueOnce({ blocks: [] });
    api.unblockChatUser.mockResolvedValue({ unblocked: true });
    await act(async () => { root.render(<BlockedUsersList />); });
    await flush();
    expect(container.textContent).toContain('상대');
    await act(async () => { byText('차단 해제')!.click(); });
    await flush();
    expect(api.unblockChatUser).toHaveBeenCalledWith('u1');
    expect(container.textContent).toContain('차단한 사용자가 없어요');
  });

  it('접수 상태 신고만 철회 버튼이 보이고 클릭하면 철회 API를 부른다', async () => {
    api.listChatBlocks.mockResolvedValue({ blocks: [
      { user_id: 'u1', name: 'A', blocked_at: null, report_id: 'r1', report_status: 'submitted' },
      { user_id: 'u2', name: 'B', blocked_at: null, report_id: 'r2', report_status: 'withdrawn' },
    ] });
    api.withdrawChatReport.mockResolvedValue({ report_id: 'r1', status: 'withdrawn' });
    await act(async () => { root.render(<BlockedUsersList />); });
    await flush();
    expect(container.querySelectorAll('button')).toHaveLength(3); // 철회1 + 해제2
    await act(async () => { byText('신고 철회')!.click(); });
    expect(api.withdrawChatReport).toHaveBeenCalledWith('r1');
  });

  it('해제 실패 시 오류 문구를 보여준다', async () => {
    api.listChatBlocks.mockResolvedValue({ blocks: [{ user_id: 'u1', name: 'A', blocked_at: null, report_id: null, report_status: null }] });
    api.unblockChatUser.mockRejectedValue(new Error('x'));
    await act(async () => { root.render(<BlockedUsersList />); });
    await flush();
    await act(async () => { byText('차단 해제')!.click(); });
    await flush();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('해제하지 못했어요');
  });
});

describe('RoomActionsMenu 차단 해제', () => {
  const room = { id: 'room1', room_type: 'direct', peer_id: 'u1', peer_name: '상대', is_blocked: true } as unknown as ChatRoom;
  it('차단된 1:1 방 메뉴에 차단 해제가 있고 누르면 해제한다', async () => {
    api.unblockChatUser.mockResolvedValue({ unblocked: true });
    api.listChatRooms.mockResolvedValue({ rooms: [{ ...room, is_blocked: false }] });
    useChatStore.setState({ rooms: [room] });
    await act(async () => { root.render(<RoomActionsMenu room={room} onSettings={() => {}} />); });
    await act(async () => { (container.querySelector('button[aria-haspopup=menu]') as HTMLButtonElement).click(); });
    const item = Array.from(container.querySelectorAll('[role=menuitem]')).find((e) => e.textContent === '차단 해제') as HTMLButtonElement;
    expect(item).toBeTruthy();
    await act(async () => { item.click(); });
    expect(api.unblockChatUser).toHaveBeenCalledWith('u1');
    expect(useChatStore.getState().rooms[0].is_blocked).toBe(false);
  });

  it('차단되지 않은 방에는 차단 해제 항목이 없다', async () => {
    await act(async () => { root.render(<RoomActionsMenu room={{ ...room, is_blocked: false }} onSettings={() => {}} />); });
    await act(async () => { (container.querySelector('button[aria-haspopup=menu]') as HTMLButtonElement).click(); });
    expect(container.textContent).not.toContain('차단 해제');
  });
});
