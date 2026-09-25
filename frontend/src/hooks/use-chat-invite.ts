import { useCallback, useEffect, useRef, useState } from 'react';
import { addChatRoomParticipants, getChatRoom, listChatRoomParticipants, type ChatRoom } from '../lib/api/chat';
import { canInviteToRoom, forkChatRoom, inviteRoomMetadata, listInvitableCounselors, type InviteCandidate, type InviteMode } from '../lib/api/chat-invite';
import { listClients } from '../lib/api/clients';
import { ApiError } from '../lib/api/client';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';

export type InviteTab = 'counselor' | 'client';
interface SearchState {
  query: string;
  page: number;
  items: InviteCandidate[];
  total: number;
  loading: boolean;
  error: string | null;
}
export interface ChatInviteState {
  detail: ChatRoom;
  step: 'select' | 'mode';
  tab: InviteTab;
  setTab: (tab: InviteTab) => void;
  search: SearchState;
  setQuery: (query: string) => void;
  selected: InviteCandidate[];
  toggleCandidate: (candidate: InviteCandidate) => void;
  removeCandidate: (id: string) => void;
  mode: InviteMode | null;
  setMode: (mode: InviteMode) => void;
  acknowledged: boolean;
  setAcknowledged: (value: boolean) => void;
  name: string;
  setName: (name: string) => void;
  invalidName: boolean;
  memberIds: string[];
  ready: boolean;
  loadingRoom: boolean;
  roomError: string | null;
  error: string | null;
  busy: boolean;
  blocked: boolean;
  permitted: boolean;
  canSubmit: boolean;
  next: () => void;
  back: () => void;
  submit: () => Promise<void>;
  isBusy: () => boolean;
  retryRoom: () => void;
  retrySearch: () => void;
  loadMore: () => void;
}
const emptySearch = (): SearchState => ({ query: '', page: 1, items: [], total: 0, loading: true, error: null });

async function readMembers(room: ChatRoom): Promise<string[]> {
  if (room.room_type === 'direct') {
    if (!room.host_id || !room.peer_id) throw new Error('참여자 정보 없음');
    return [...new Set([room.host_id, room.peer_id])];
  }
  const { participants } = await listChatRoomParticipants(room.id);
  return [...new Set([...(room.host_id ? [room.host_id] : []), ...participants.map((member) => member.user_id)])];
}

export function useChatInvite(room: ChatRoom, onSuccess: (room: ChatRoom, mode: InviteMode) => void): ChatInviteState {
  const user = useAuthStore((state) => state.user);
  const [detail, setDetail] = useState(room);
  const [step, setStep] = useState<'select' | 'mode'>('select');
  const [tab, setTab] = useState<InviteTab>('counselor');
  const [searches, setSearches] = useState<Record<InviteTab, SearchState>>({ counselor: emptySearch(), client: emptySearch() });
  const [selected, setSelected] = useState<InviteCandidate[]>([]);
  const [mode, setModeValue] = useState<InviteMode | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [reload, setReload] = useState(0);
  const [searchReload, setSearchReload] = useState(0);
  const lock = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const permitted = canInviteToRoom(detail, user);
  const search = searches[tab];
  const trimmedName = name.trim();
  const invalidName = Array.from(trimmedName).length > 120 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(trimmedName);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false); setLoadingRoom(true); setRoomError(null);
    if (!canInviteToRoom(room, user)) { setLoadingRoom(false); return; }
    void getChatRoom(room.id).then(async (fresh) => {
      if (!canInviteToRoom(fresh, useAuthStore.getState().user)) throw new Error('초대 권한 없음');
      const ids = await readMembers(fresh);
      if (!active) return;
      setDetail(fresh); setMemberIds(ids); setReady(true);
    }).catch(() => { if (active) setRoomError('기존 참여자 또는 초대 권한을 확인하지 못했습니다.'); })
      .finally(() => { if (active) setLoadingRoom(false); });
    return () => { active = false; };
  }, [room.id, room.host_id, room.room_type, user?.id, user?.role, reload]);

  useEffect(() => {
    if (!permitted || blocked) return;
    let active = true;
    const { query, page } = search;
    setSearches((previous) => ({ ...previous, [tab]: { ...previous[tab], loading: true, error: null } }));
    const timer = window.setTimeout(() => {
      const params = { q: query.trim() || undefined, page, size: 50 };
      const request = tab === 'counselor'
        ? listInvitableCounselors(params).then((response) => ({
          items: response.counselors.map((candidate): InviteCandidate => ({ userId: candidate.user_id, name: candidate.name, role: candidate.role, orgNames: candidate.org_names })),
          total: response.total,
        }))
        : listClients(params).then((response) => ({
          items: response.clients.map((candidate): InviteCandidate => ({ userId: candidate.id, name: candidate.name, role: 'client', email: candidate.email, orgNames: [] })),
          total: response.total,
        }));
      void request.then((response) => {
        if (!active) return;
        setSearches((previous) => {
          const combined = page === 1 ? response.items : [...previous[tab].items, ...response.items];
          const items = [...new Map(combined.map((candidate) => [candidate.userId, candidate])).values()];
          return { ...previous, [tab]: { ...previous[tab], items, total: response.total, loading: false, error: null } };
        });
      }).catch(() => {
        if (active) setSearches((previous) => ({ ...previous, [tab]: { ...previous[tab], loading: false, error: '목록을 불러오지 못했습니다.' } }));
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [tab, search.query, search.page, searchReload, permitted, blocked]);

  const setQuery = (query: string): void => {
    setSearches((previous) => ({ ...previous, [tab]: { ...emptySearch(), query } }));
  };
  const toggleCandidate = (candidate: InviteCandidate): void => {
    if (lock.current || !permitted || candidate.userId === user?.id || memberIds.includes(candidate.userId)) return;
    setAcknowledged(false);
    setSelected((previous) => previous.some((item) => item.userId === candidate.userId)
      ? previous.filter((item) => item.userId !== candidate.userId)
      : previous.length < 100 ? [...previous, candidate] : previous);
  };
  const setMode = (value: InviteMode): void => {
    if (lock.current) return;
    setModeValue(value); setAcknowledged(false);
  };
  const next = (): void => {
    if (!ready || !permitted || selected.length === 0 || lock.current) return;
    setAcknowledged(false); setError(null); setStep('mode');
  };
  const canSubmit = ready && permitted && !blocked && !busy && selected.length > 0 && step === 'mode'
    && ((mode === 'existing' && detail.room_type === 'group' && acknowledged) || (mode === 'fork' && !invalidName));

  const submit = async (): Promise<void> => {
    if (!canSubmit || !mode || lock.current || !canInviteToRoom(detail, useAuthStore.getState().user)) return;
    lock.current = true; setBusy(true); setError(null);
    const currentGeneration = generation.current;
    let mutationStarted = false;
    try {
      const fresh = await getChatRoom(room.id);
      if (!canInviteToRoom(fresh, useAuthStore.getState().user)) {
        setBlocked(true); setError('이 채팅방에 회원을 초대할 권한이 없습니다.'); return;
      }
      const ids = await readMembers(fresh);
      if (!mounted.current || currentGeneration !== generation.current) return;
      const valid = selected.filter((candidate) => !ids.includes(candidate.userId) && candidate.userId !== useAuthStore.getState().user?.id);
      const changed = ids.length !== memberIds.length || ids.some((id) => !memberIds.includes(id));
      setDetail(fresh); setMemberIds(ids);
      if (changed || valid.length !== selected.length) {
        setSelected(valid); setAcknowledged(false);
        setError('참여자 명단이 변경되었습니다. 최신 인원과 초대 대상을 확인한 뒤 다시 실행해 주세요.'); return;
      }
      if (mode === 'existing' && fresh.room_type !== 'group') {
        setAcknowledged(false); setError('1:1 채팅은 새 그룹방으로만 초대할 수 있습니다.'); return;
      }
      if (!canInviteToRoom(fresh, useAuthStore.getState().user)) {
        setBlocked(true); setError('이 채팅방에 회원을 초대할 권한이 없습니다.'); return;
      }
      mutationStarted = true;
      const result = mode === 'fork'
        ? await forkChatRoom(room.id, { participant_ids: valid.map((candidate) => candidate.userId), ...(trimmedName ? { name: trimmedName } : {}) })
        : await addChatRoomParticipants(room.id, valid.map((candidate) => candidate.userId));
      // 목록 반영을 라우팅보다 먼저 완료하고 기존 메시지·읽음 상태를 보존한다.
      if (mode === 'fork') useChatStore.getState().upsertRoom(result);
      else useChatStore.getState().updateRoom(result.id, inviteRoomMetadata(result));
      if (mounted.current) { setBlocked(true); onSuccess(result, mode); }
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
        setBlocked(true);
        setError('이 채팅방 또는 선택한 회원에 대한 초대 권한이 없습니다. 닫은 뒤 최신 목록을 확인해 주세요.');
      } else if (mutationStarted && (!(cause instanceof ApiError) || cause.status >= 500)) {
        setBlocked(true);
        setError('처리 결과를 확인하지 못했습니다. 중복 초대를 방지하기 위해 다시 실행하지 않습니다. 닫은 뒤 채팅방 목록을 확인해 주세요.');
      } else {
        setError(cause instanceof ApiError && cause.status === 422
          ? '초대 인원 또는 방 이름을 확인해 주세요.'
          : '초대를 완료하지 못했습니다. 선택한 회원과 참여자 정보를 확인한 뒤 다시 시도해 주세요.');
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const isBusy = useCallback(() => lock.current, []);
  return {
    detail, step, tab, setTab, search, setQuery, selected, toggleCandidate,
    removeCandidate: (id: string): void => { if (!lock.current) { setSelected((previous) => previous.filter((item) => item.userId !== id)); setAcknowledged(false); } },
    mode, setMode, acknowledged, setAcknowledged, name, setName, invalidName,
    memberIds, ready, loadingRoom, roomError, error, busy, blocked, permitted, canSubmit, next, submit, isBusy,
    back: (): void => { if (!lock.current) { setStep('select'); setAcknowledged(false); } },
    retryRoom: (): void => setReload((previous) => previous + 1),
    retrySearch: (): void => setSearchReload((previous) => previous + 1),
    loadMore: (): void => { if (!search.loading && !search.error) setSearches((previous) => ({ ...previous, [tab]: { ...previous[tab], page: previous[tab].page + 1 } })); },
  };
}
