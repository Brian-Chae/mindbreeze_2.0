import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addChatRoomParticipants, getChatRoom, listChatRoomParticipants,
  removeChatRoomParticipant, updateChatRoom,
  type ChatRoom, type ChatRoomParticipant,
} from '../../lib/api/chat';
import { listClients, type ClientListItem } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';

interface Props {
  room: ChatRoom;
  onClose: () => void;
  onSaved?: (message: string) => void;
}

const disabledReasons: Record<string, string> = {
  not_host: '채팅방을 만든 상담사만 이름을 변경할 수 있습니다.',
  role_not_allowed: '상담사만 채팅방 이름을 변경할 수 있습니다.',
  membership_required: '소속 기관 정보를 확인한 후 변경할 수 있습니다.',
  participant_scope_invalid: '참여자 연결 정보를 확인한 후 변경할 수 있습니다.',
  session_managed: '세션 채팅방 이름은 세션 제목을 따릅니다.',
  host_missing: '채팅방의 상담사 정보를 확인할 수 없습니다.',
};

function roomLabel(room: ChatRoom): string {
  if (room.display_name) return room.display_name;
  if (room.room_type === 'direct') return room.peer_name || '1:1 채팅';
  if (room.room_type === 'session') return room.session_title || '세션';
  return room.name || '그룹 채팅';
}

function formatDate(value: string | null): string {
  if (!value) return '일정 미지정';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '날짜 정보 없음' : date.toLocaleString('ko-KR');
}

// 읽음 수와 새 메시지를 오래된 상세 조회 응답으로 덮어쓰지 않는다.
function roomSettings(room: ChatRoom): Partial<ChatRoom> {
  return {
    name: room.name, custom_name: room.custom_name, display_name: room.display_name,
    can_rename: room.can_rename, rename_disabled_reason: room.rename_disabled_reason,
    participant_count: room.participant_count,
  };
}

export function RoomSettingsModal({ room, onClose, onSaved }: Props) {
  const userId = useAuthStore((state) => state.user?.id);
  const updateRoom = useChatStore((state) => state.updateRoom);
  const [detail, setDetail] = useState<ChatRoom | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ChatRoomParticipant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);
  const [participantsReady, setParticipantsReady] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mutationRef = useRef(false);
  const titleId = useId();
  const nameId = useId();
  const searchId = useId();
  const trimmedName = name.trim();
  const originalName = detail?.custom_name ?? '';
  const dirty = trimmedName !== originalName;
  const nameLength = Array.from(trimmedName).length;
  const invalidName = nameLength < 1 || nameLength > 120 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(trimmedName);
  const canRename = detail?.can_rename === true && detail.room_type !== 'session';
  const canManage = detail?.room_type === 'group' && detail.host_id === userId;

  const requestClose = useCallback((): void => {
    if (mutationRef.current) return;
    if (dirty && !window.confirm('저장하지 않은 이름 변경을 취소하시겠습니까?')) return;
    onClose();
  }, [dirty, onClose]);
  const requestCloseRef = useRef(requestClose);
  useEffect(() => { requestCloseRef.current = requestClose; }, [requestClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); requestCloseRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getChatRoom(room.id).then((fresh) => {
      if (!active) return;
      setDetail(fresh);
      setName(fresh.custom_name ?? '');
      updateRoom(room.id, roomSettings(fresh));
    }).catch(() => { if (active) setError('채팅방 정보를 불러오지 못했습니다. 다시 시도해 주세요.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [room.id, reload, updateRoom]);

  const loadParticipants = useCallback(async (): Promise<void> => {
    setParticipantsLoading(true);
    setParticipantsError(null);
    setParticipantsReady(false);
    try {
      const response = await listChatRoomParticipants(room.id);
      setParticipants(response.participants);
      setParticipantsReady(true);
    } catch {
      setParticipantsError('참여자 목록을 불러오지 못했습니다.');
    } finally { setParticipantsLoading(false); }
  }, [room.id]);

  useEffect(() => { if (canManage) void loadParticipants(); }, [canManage, loadParticipants]);

  useEffect(() => {
    if (!adding || !canManage) return;
    let active = true;
    setClientsLoading(true);
    setClientsError(null);
    const timer = window.setTimeout(() => {
      listClients({ q: search.trim() || undefined, size: 50 }).then((response) => {
        if (active) setClients(response.clients);
      }).catch(() => { if (active) setClientsError('추가할 내담자를 불러오지 못했습니다. 검색어를 변경하거나 다시 열어 주세요.'); })
        .finally(() => { if (active) setClientsLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [adding, canManage, search]);

  const save = async (): Promise<void> => {
    if (!canRename || invalidName || !dirty || mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fresh = await updateChatRoom(room.id, { name: trimmedName });
      updateRoom(room.id, roomSettings(fresh));
      setDetail(fresh);
      setName(fresh.custom_name ?? '');
      if (onSaved) { onSaved('채팅방 이름을 변경했습니다.'); onClose(); }
      else setNotice('채팅방 이름을 변경했습니다.');
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403 ? '이름 변경 권한이 없습니다. 최신 권한을 확인해 주세요.' : '이름을 저장하지 못했습니다. 입력을 확인하고 다시 시도해 주세요.');
      if (cause instanceof ApiError && cause.status === 403) {
        try {
          const fresh = await getChatRoom(room.id);
          setDetail(fresh);
          updateRoom(room.id, roomSettings(fresh));
        } catch { /* 입력을 보존하고 최초 저장 오류를 유지한다. */ }
      }
    } finally { mutationRef.current = false; setBusy(false); }
  };

  const changeParticipants = async (userIdToRemove?: string): Promise<void> => {
    if (!canManage || !participantsReady || mutationRef.current) return;
    if (userIdToRemove && !window.confirm('이 참여자를 채팅방에서 내보내시겠습니까? 내보내면 채팅방에 접근할 수 없습니다.')) return;
    if (!userIdToRemove && selectedIds.length === 0) return;
    mutationRef.current = true;
    setBusy(true);
    setParticipantsError(null);
    setNotice(null);
    try {
      if (userIdToRemove) await removeChatRoomParticipant(room.id, userIdToRemove);
      else await addChatRoomParticipants(room.id, selectedIds);
      setSelectedIds([]);
      setAdding(false);
      setNotice(userIdToRemove ? '참여자를 내보냈습니다.' : '참여자를 추가했습니다.');
      await loadParticipants();
      const fresh = await getChatRoom(room.id);
      setDetail(fresh);
      updateRoom(room.id, roomSettings(fresh));
    } catch {
      await loadParticipants();
      setParticipantsError('참여자 변경 또는 최신 정보 조회에 실패했습니다. 명단을 다시 확인해 주세요.');
    } finally { mutationRef.current = false; setBusy(false); }
  };

  const candidates = clients.filter((client) => client.id !== detail?.host_id && !participants.some((participant) => participant.user_id === client.id));
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={loading || busy}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold text-[#1F1F1F]">채팅방 설정</h2>
          <button ref={closeRef} type="button" aria-label="채팅방 설정 닫기" disabled={busy} onClick={requestClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F2F3F8] text-[#6F6F6F] focus-visible:ring-2 focus-visible:ring-[#5F0080] disabled:opacity-50">✕</button>
        </div>
        {loading ? <p role="status" className="py-8 text-center text-sm text-[#6F6F6F]">채팅방 정보를 불러오는 중...</p> : detail && <>
          <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-[#F8F8FB] p-4 text-sm">
            <dt className="text-[#6F6F6F]">표시 이름</dt><dd className="break-words text-[#1F1F1F]">{roomLabel(detail)}</dd>
            <dt className="text-[#6F6F6F]">방 종류</dt><dd>{detail.room_type === 'direct' ? '1:1 채팅' : detail.room_type === 'group' ? '그룹 채팅' : '세션 채팅'}</dd>
            <dt className="text-[#6F6F6F]">생성일</dt><dd>{formatDate(detail.created_at)}</dd>
            <dt className="text-[#6F6F6F]">{detail.room_type === 'session' ? '세션 등록 참여자' : '참여자'}</dt><dd>{detail.participant_count}명</dd>
            {detail.room_type === 'direct' && <><dt className="text-[#6F6F6F]">상대방</dt><dd>{detail.peer_name || '이름 정보 없음'}</dd></>}
            {detail.room_type === 'session' && <><dt className="text-[#6F6F6F]">세션 제목</dt><dd>{detail.session_title || '제목 없음'}</dd><dt className="text-[#6F6F6F]">예정일</dt><dd>{formatDate(detail.session_scheduled_at)}</dd></>}
          </dl>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label htmlFor={nameId} className="mb-2 block text-sm font-semibold text-[#1F1F1F]">채팅방 이름</label>
            <input id={nameId} value={name} onChange={(event) => { setName(event.target.value); setNotice(null); }} readOnly={!canRename} disabled={busy}
              placeholder={detail.room_type === 'direct' ? detail.peer_name || '1:1 채팅' : detail.room_type === 'session' ? detail.session_title || '제목 없음' : '그룹 채팅'}
              aria-describedby={`${nameId}-help`} aria-invalid={canRename && dirty && invalidName}
              className="w-full rounded-xl border border-[#DDDEE7] px-3.5 py-2.5 text-sm text-[#1F1F1F] outline-none read-only:bg-[#F2F3F8] focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-50" />
            <p id={`${nameId}-help`} className="mt-2 text-xs text-[#6F6F6F]">{canRename ? '1~120자 · 모든 참여자에게 표시되는 이름입니다.' : detail.room_type === 'session' ? disabledReasons.session_managed : disabledReasons[detail.rename_disabled_reason ?? 'not_host'] || '이 채팅방의 이름은 변경할 수 없습니다.'}</p>
            {canRename && dirty && invalidName && <p className="mt-2 text-xs text-red-600">공백만 있는 이름, 줄바꿈·제어문자는 사용할 수 없으며 이름은 1~120자여야 합니다.</p>}
            {canRename && <button type="submit" disabled={busy || invalidName || !dirty} className="mt-4 h-11 w-full rounded-xl bg-[#5F0080] text-sm font-semibold text-white hover:bg-[#4B0066] disabled:opacity-50">{busy ? '처리 중...' : '이름 저장'}</button>}
          </form>
          {canManage && <section aria-label="그룹 참여자 관리" className="mt-6 border-t border-[#EFEFEF] pt-4">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">그룹 참여자</h3><button type="button" disabled={busy || !participantsReady} onClick={() => { setAdding((previous) => !previous); setSelectedIds([]); }} className="rounded-lg px-3 py-2 text-sm font-semibold text-[#5F0080] hover:bg-[#F5EDFC] disabled:opacity-50">{adding ? '추가 취소' : '참여자 추가'}</button></div>
            <p className="mb-2 text-xs text-[#6F6F6F]">방장(나)은 내보낼 수 없습니다.</p>
            {participantsLoading ? <p role="status" className="text-sm text-[#6F6F6F]">참여자를 불러오는 중...</p> : participantsReady && <ul className="max-h-48 divide-y divide-[#EFEFEF] overflow-y-auto rounded-xl border border-[#EFEFEF]">{participants.map((participant) => <li key={participant.user_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="min-w-0 truncate">{participant.name || '이름 정보 없음'}{participant.user_id === detail.host_id ? ' (방장)' : ''}</span>{participant.user_id !== detail.host_id && <button type="button" disabled={busy} aria-label={`${participant.name || '참여자'} 내보내기`} onClick={() => void changeParticipants(participant.user_id)} className="shrink-0 rounded-lg px-2 py-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">내보내기</button>}</li>)}{participants.length === 0 && <li className="p-3 text-sm text-[#6F6F6F]">등록된 참여자가 없습니다.</li>}</ul>}
            {participantsError && <div role="alert" className="mt-2 text-sm text-red-600">{participantsError}<button type="button" disabled={busy || participantsLoading} onClick={() => void loadParticipants()} className="ml-2 underline disabled:opacity-50">다시 조회</button></div>}
            {adding && <div className="mt-3 rounded-xl bg-[#F8F8FB] p-3"><label htmlFor={searchId} className="mb-2 block text-xs text-[#6F6F6F]">추가할 내담자 검색</label><input id={searchId} value={search} onChange={(event) => setSearch(event.target.value)} disabled={busy} placeholder="이름 또는 이메일" className="w-full rounded-lg border border-[#DDDEE7] px-3 py-2 text-sm outline-none focus:border-[#5F0080]" />
              {clientsLoading ? <p role="status" className="py-3 text-sm">검색 중...</p> : clientsError ? <p role="alert" className="py-3 text-sm text-red-600">{clientsError}</p> : <div className="mt-2 max-h-40 overflow-y-auto">{candidates.map((client) => <label key={client.id} className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={selectedIds.includes(client.id)} disabled={busy} onChange={() => setSelectedIds((previous) => previous.includes(client.id) ? previous.filter((id) => id !== client.id) : [...previous, client.id])} className="accent-[#5F0080]" /><span>{client.name}</span><span className="truncate text-xs text-[#6F6F6F]">{client.email}</span></label>)}{candidates.length === 0 && <p className="py-3 text-sm text-[#6F6F6F]">추가할 내담자가 없습니다.</p>}</div>}
              <button type="button" disabled={busy || !participantsReady || selectedIds.length === 0} onClick={() => void changeParticipants()} className="mt-3 w-full rounded-lg bg-[#5F0080] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{selectedIds.length}명 추가</button>
            </div>}
          </section>}
        </>}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        {!loading && !detail && <button type="button" onClick={() => setReload((previous) => previous + 1)} className="mt-3 rounded-lg bg-[#F5EDFC] px-4 py-2 text-sm text-[#5F0080]">다시 시도</button>}
        {notice && <p role="status" className="mt-3 text-sm text-[#5F0080]">{notice}</p>}
      </div>
    </div>, document.body,
  );
}
