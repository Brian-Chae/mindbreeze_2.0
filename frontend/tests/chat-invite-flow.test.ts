// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatInvite } from '../src/hooks/use-chat-invite';
import { useAuthStore } from '../src/stores/authStore';
import { useChatStore } from '../src/stores/chatStore';
import { addChatRoomParticipants, getChatRoom, listChatRoomParticipants, type ChatRoom } from '../src/lib/api/chat';
import { forkChatRoom, listInvitableCounselors } from '../src/lib/api/chat-invite';
import { listClients } from '../src/lib/api/clients';
import { ApiError } from '../src/lib/api/client';
vi.mock('../src/lib/api/chat', () => ({ getChatRoom: vi.fn(), listChatRoomParticipants: vi.fn(), addChatRoomParticipants: vi.fn() }));
vi.mock('../src/lib/api/clients', () => ({ listClients: vi.fn() }));
vi.mock('../src/lib/api/chat-invite', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/lib/api/chat-invite')>(), forkChatRoom: vi.fn(), listInvitableCounselors: vi.fn() }));
const room: ChatRoom = { id: 'source', room_type: 'group', host_id: 'host', peer_id: 'peer', peer_name: '상대', name: '그룹', session_id: null, session_title: null, session_scheduled_at: null, participant_count: 2, created_at: '2026-09-25', unread_count: 3 };
const counselor = { userId: 'counselor', name: '상담사', role: 'counselor' as const, orgNames: ['기관'] };
const client = { userId: 'client', name: '내담자', role: 'client' as const, orgNames: [] };
let root: Root;
let state: ReturnType<typeof useChatInvite>;
const success = vi.fn();
async function mount(source = room): Promise<void> {
  vi.mocked(getChatRoom).mockResolvedValue(source);
  function Probe() { state = useChatInvite(source, success); return null; }
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); success.mockReset();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement('div'));
  useAuthStore.setState({ user: { id: 'host', name: '호스트', email: '', role: 'counselor', verified_tier: 'fully_verified', onboarding_completed: true, auth_provider: 'email', counselors: [] } });
  useChatStore.setState({ rooms: [room], messagesByRoom: {} });
  vi.mocked(listChatRoomParticipants).mockResolvedValue({ participants: [{ user_id: 'peer', name: '기존 참여자' }] });
  vi.mocked(listInvitableCounselors).mockResolvedValue({ counselors: [{ user_id: 'counselor', name: '상담사', role: 'counselor', org_names: ['기관'] }], total: 1, page: 1 });
  vi.mocked(listClients).mockResolvedValue({ clients: [{ id: 'client', name: '내담자', email: '', concerns: [], last_session_at: null }], total: 1, page: 1 });
  vi.mocked(addChatRoomParticipants).mockResolvedValue({ ...room, participant_count: 4 });
  vi.mocked(forkChatRoom).mockResolvedValue({ ...room, id: 'new' });
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
it('탭 전환에도 혼합 선택을 보존하고 공개 확인 전에는 추가하지 않는다', async () => {
  await mount();
  await act(async () => state.toggleCandidate(counselor));
  await act(async () => state.setTab('client'));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  await act(async () => state.toggleCandidate(client));
  expect(state.selected).toHaveLength(2);
  await act(async () => state.next());
  await act(async () => state.setMode('existing'));
  await act(async () => state.submit());
  expect(addChatRoomParticipants).not.toHaveBeenCalled();
  await act(async () => state.setAcknowledged(true));
  await act(async () => { void state.submit(); void state.submit(); });
  expect(addChatRoomParticipants).toHaveBeenCalledExactlyOnceWith('source', ['counselor', 'client']);
  expect(useChatStore.getState().rooms[0]).toMatchObject({ unread_count: 3, participant_count: 4 });
});
it('direct는 기존 방 추가를 차단하고 새 방을 먼저 삽입한 뒤 성공을 알린다', async () => {
  await mount({ ...room, room_type: 'direct' });
  expect(listChatRoomParticipants).not.toHaveBeenCalled();
  await act(async () => state.toggleCandidate(counselor));
  await act(async () => state.next());
  await act(async () => { state.setMode('existing'); state.setAcknowledged(true); });
  await act(async () => state.submit());
  expect(addChatRoomParticipants).not.toHaveBeenCalled();
  await act(async () => state.setMode('fork'));
  success.mockImplementation(() => expect(useChatStore.getState().rooms.some((item) => item.id === 'new')).toBe(true));
  await act(async () => state.submit());
  expect(forkChatRoom).toHaveBeenCalledExactlyOnceWith('source', { participant_ids: ['counselor'] });
  expect(useChatStore.getState().rooms.some((item) => item.id === 'source')).toBe(true);
});
it('내담자는 후보 조회와 실행 모두 차단한다', async () => {
  const user = useAuthStore.getState().user!;
  useAuthStore.setState({ user: { ...user, role: 'client' } });
  await mount();
  expect(listInvitableCounselors).not.toHaveBeenCalled();
  await act(async () => { state.toggleCandidate(counselor); state.setMode('fork'); });
  await act(async () => state.submit());
  expect(forkChatRoom).not.toHaveBeenCalled();
});
it('참여자 조회 실패 시 다음 단계로 넘어가지 않는다', async () => {
  vi.mocked(listChatRoomParticipants).mockRejectedValue(new Error('조회 실패'));
  await mount();
  await act(async () => state.toggleCandidate(counselor));
  await act(async () => state.next());
  expect(state.step).toBe('select');
  expect(state.ready).toBe(false);
});
it('새 방 응답 유실 시 입력을 유지하고 반복 생성을 막는다', async () => {
  vi.mocked(forkChatRoom).mockRejectedValue(new TypeError('network'));
  await mount();
  await act(async () => state.toggleCandidate(counselor));
  await act(async () => state.next());
  await act(async () => state.setMode('fork'));
  await act(async () => state.submit());
  await act(async () => state.submit());
  expect(forkChatRoom).toHaveBeenCalledTimes(1);
  expect(state.selected).toHaveLength(1);
  expect(state.error).toContain('처리 결과');
});
it('늦게 도착한 이전 검색 응답이 최신 후보를 덮지 않는다', async () => {
  let resolveOld!: (response: Awaited<ReturnType<typeof listInvitableCounselors>>) => void;
  vi.mocked(listInvitableCounselors).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  await mount();
  await act(async () => state.setQuery('최신'));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  await act(async () => resolveOld({ counselors: [{ user_id: 'old', name: '과거', role: 'counselor', org_names: [] }], total: 1, page: 1 }));
  expect(state.search.items.map((item) => item.userId)).toEqual(['counselor']);
});
it('자신·기존 참여자 선택을 막고 더 보기와 검색 초기화에도 선택을 보존한다', async () => {
  vi.mocked(listInvitableCounselors).mockResolvedValueOnce({ counselors: [{ user_id: 'counselor', name: '상담사', role: 'counselor', org_names: [] }], total: 51, page: 1 });
  await mount();
  await act(async () => { state.toggleCandidate({ ...counselor, userId: 'host' }); state.toggleCandidate({ ...counselor, userId: 'peer' }); state.toggleCandidate(counselor); });
  expect(state.selected.map((item) => item.userId)).toEqual(['counselor']);
  vi.mocked(listInvitableCounselors).mockResolvedValueOnce({ counselors: [{ user_id: 'last', name: '마지막', role: 'counselor', org_names: [] }], total: 51, page: 2 });
  await act(async () => state.loadMore());
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(listInvitableCounselors).toHaveBeenLastCalledWith({ q: undefined, page: 2, size: 50 });
  expect(state.search.items.map((item) => item.userId)).toEqual(['counselor', 'last']);
  await act(async () => state.setQuery('다른 검색'));
  expect(state.search.page).toBe(1);
  expect(state.selected).toHaveLength(1);
});
it('제출 직전에 이미 참여한 대상은 제거하고 재확인 전 mutation을 하지 않는다', async () => {
  await mount();
  await act(async () => state.toggleCandidate(counselor));
  await act(async () => state.next());
  await act(async () => state.setMode('fork'));
  vi.mocked(listChatRoomParticipants).mockResolvedValue({ participants: [{ user_id: 'peer', name: '기존' }, { user_id: 'counselor', name: '상담사' }] });
  await act(async () => state.submit());
  expect(forkChatRoom).not.toHaveBeenCalled();
  expect(state.selected).toHaveLength(0);
  expect(state.error).toContain('참여자 명단이 변경');
});
it('확인 중 모달이 닫히면 mutation을 보내지 않는다', async () => {
  await mount();
  await act(async () => state.toggleCandidate(counselor));
  await act(async () => state.next());
  await act(async () => state.setMode('fork'));
  let resolveRoom!: (value: ChatRoom) => void;
  vi.mocked(getChatRoom).mockImplementationOnce(() => new Promise((resolve) => { resolveRoom = resolve; }));
  await act(async () => { void state.submit(); });
  await act(async () => root.unmount());
  await act(async () => resolveRoom(room));
  expect(forkChatRoom).not.toHaveBeenCalled();
});

it('상담사 후보 조회가 실패해도 연결 내담자 탭은 사용할 수 있다', async () => {
  vi.mocked(listInvitableCounselors).mockRejectedValue(new Error('후보 조회 실패'));
  await mount();
  expect(state.search.error).not.toBeNull();
  await act(async () => state.setTab('client'));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(state.search.error).toBeNull();
  expect(state.search.items.map((item) => item.userId)).toEqual(['client']);
});
it('100명 선택 상한을 두 탭 합계에 적용한다', async () => {
  await mount();
  await act(async () => {
    for (let index = 0; index < 101; index += 1) state.toggleCandidate({ ...counselor, userId: `candidate-${index}`, role: index % 2 === 0 ? 'client' : 'counselor' });
  });
  expect(state.selected).toHaveLength(100);
});
it('기관 관리자는 명단 조회가 허용되면 호스트가 아니어도 기존 방에 초대한다', async () => {
  const user = useAuthStore.getState().user!;
  useAuthStore.setState({ user: { ...user, id: 'manager', role: 'org_admin' } });
  await mount();
  await act(async () => state.toggleCandidate(counselor));
  await act(async () => state.next());
  await act(async () => state.setMode('existing'));
  await act(async () => state.setAcknowledged(true));
  await act(async () => state.submit());
  expect(addChatRoomParticipants).toHaveBeenCalledExactlyOnceWith('source', ['counselor']);
});
it('422는 선택을 보존하고 403은 반복 제출을 차단한다', async () => {
  await mount();
  await act(async () => state.toggleCandidate(counselor));
  await act(async () => state.next());
  await act(async () => state.setMode('fork'));
  vi.mocked(forkChatRoom).mockRejectedValueOnce(new ApiError(422, '잘못된 요청', null));
  await act(async () => state.submit());
  expect(state.selected).toHaveLength(1);
  expect(state.blocked).toBe(false);
  vi.mocked(forkChatRoom).mockRejectedValueOnce(new ApiError(403, '권한 없음', null));
  await act(async () => state.submit());
  expect(state.blocked).toBe(true);
  await act(async () => state.submit());
  expect(forkChatRoom).toHaveBeenCalledTimes(2);
});
