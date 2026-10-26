import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { unblockChatUser, listChatRooms, type ChatRoom } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { canInviteToRoom } from '../../lib/api/chat-invite';
import { useAuthStore } from '../../stores/authStore';
import { ReportDialog } from './report-dialog';

interface Props {
  room: ChatRoom;
  onSettings: () => void;
  onInvite?: () => void;
  /** 차단 해제가 서버에 반영된 직후 호출(선택) */
  onUnblocked?: () => void;
  /** 지정하면 상단 바용 메뉴로 동작 — '나가기'(확인 후 호출)와 '신고하기'가 추가된다. */
  onLeave?: () => void;
}

const ITEM = 'w-full rounded-lg px-3 py-2 mobile:min-h-11 text-left text-sm mobile:text-mb-compact hover:bg-[#F5EDFC] focus:bg-[#F5EDFC] focus:outline-none';

interface ReportCandidate { userId: string; name: string }

export function RoomActionsMenu({ room, onSettings, onInvite, onUnblocked, onLeave }: Props) {
  const user = useAuthStore((state) => state.user);
  const canInvite = !!onInvite && canInviteToRoom(room, user);
  const [open, setOpen] = useState(false);
  const [unblockError, setUnblockError] = useState(false);
  const [dialog, setDialog] = useState<'leave' | 'pick' | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportCandidate | null>(null);
  const messages = useChatStore((state) => state.messagesByRoom[room.id]);
  // 신고 대상: 1:1 은 상대, 그룹·세션 방은 대화에 등장한 상대 발신자 중 선택(서버 API 변경 없음).
  const candidates = useMemo<ReportCandidate[]>(() => {
    if (room.room_type === 'direct') {
      return room.peer_id && !room.peer_deleted && room.is_blocked !== true
        ? [{ userId: room.peer_id, name: room.peer_name || '상대방' }]
        : [];
    }
    const seen = new Map<string, string>();
    for (const m of messages ?? []) {
      if (m.type !== 'system' && m.sender_id && m.sender_id !== user?.id && !seen.has(m.sender_id)) {
        seen.set(m.sender_id, m.sender_name || '사용자');
      }
    }
    return [...seen].map(([userId, name]) => ({ userId, name }));
  }, [room, messages, user?.id]);
  const startReport = (): void => {
    if (candidates.length === 1) setReportTarget(candidates[0]);
    else if (candidates.length > 1) setDialog('pick');
  };
  const canUnblock = room.room_type === 'direct' && room.is_blocked === true && !!room.peer_id;
  const unblock = async (): Promise<void> => {
    if (!room.peer_id) return;
    try {
      await unblockChatUser(room.peer_id);
      setUnblockError(false);
      useChatStore.getState().updateRoom(room.id, { is_blocked: false });
      void listChatRooms().then((res) => useChatStore.getState().setRooms(res.rooms)).catch(() => { /* 조용히 실패 */ });
      onUnblocked?.();
    } catch {
      // 내가 건 차단이 아니면 서버가 404 — 안내만 한다.
      setUnblockError(true);
    }
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const title = room.display_name || (room.room_type === 'direct' ? room.peer_name || '1:1 채팅' : room.room_type === 'group' ? room.name || '그룹 채팅' : room.session_title || '세션');

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? []);
        const index = items.findIndex((item) => item === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={buttonRef} type="button" aria-label={`${title} 메뉴`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((previous) => !previous)} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
        }} className="flex h-10 w-10 mobile:h-11 mobile:w-11 items-center justify-center rounded-lg text-xl text-[#6F6F6F] hover:bg-[#F5EDFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080]">⋯</button>
      {open && <div id={menuId} role="menu" className="absolute right-0 top-full z-20 w-36 rounded-xl border border-[#DDDEE7] bg-white p-1 shadow-lg">
        {canInvite && <button role="menuitem" type="button" onClick={() => { buttonRef.current?.focus(); setOpen(false); onInvite?.(); }}
          className="w-full rounded-lg px-3 py-2 mobile:min-h-11 text-left text-sm mobile:text-mb-compact text-[#5F0080] hover:bg-[#F5EDFC] focus:bg-[#F5EDFC] focus:outline-none">회원 초대</button>}
        {canUnblock && <button role="menuitem" type="button" onClick={() => { buttonRef.current?.focus(); setOpen(false); void unblock(); }}
          className="w-full rounded-lg px-3 py-2 mobile:min-h-11 text-left text-sm mobile:text-mb-compact text-[#5F0080] hover:bg-[#F5EDFC] focus:bg-[#F5EDFC] focus:outline-none">차단 해제</button>}
        <button ref={itemRef} role="menuitem" type="button" onClick={() => { buttonRef.current?.focus(); setOpen(false); onSettings(); }}
          className={`${ITEM} text-[#1F1F1F]`}>채팅방 설정</button>
        {onLeave && <button role="menuitem" type="button" onClick={() => { buttonRef.current?.focus(); setOpen(false); startReport(); }}
          disabled={candidates.length === 0} className={`${ITEM} text-[#B3261E] disabled:text-[#9A9A9A]`}>신고하기</button>}
        {onLeave && <button role="menuitem" type="button" onClick={() => { buttonRef.current?.focus(); setOpen(false); setDialog('leave'); }}
          className={`${ITEM} text-[#1F1F1F]`}>나가기</button>}
      </div>}
      {dialog === 'leave' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-label="채팅방 나가기" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-base mobile:text-mb-body font-bold text-[#1F1F1F]">채팅방에서 나갈까요?</h2>
            <p className="mt-2 text-sm mobile:text-mb-compact text-[#6F6F6F]">대화 목록으로 돌아가요. 대화 내용은 그대로 남아 있어요.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setDialog(null)} className="flex-1 rounded-xl border border-[#DDDEE7] px-4 py-3 mobile:min-h-12 text-sm mobile:text-mb-compact">취소</button>
              <button type="button" onClick={() => { setDialog(null); onLeave?.(); }} className="flex-1 rounded-xl bg-[#5F0080] px-4 py-3 mobile:min-h-12 text-sm mobile:text-mb-compact font-semibold text-white">나가기</button>
            </div>
          </div>
        </div>, document.body)}
      {dialog === 'pick' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="신고할 사람 선택" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-base mobile:text-mb-body font-bold text-[#1F1F1F]">누구를 신고할까요?</h2>
            <ul className="mt-3 space-y-1">
              {candidates.map((c) => (
                <li key={c.userId}>
                  <button type="button" onClick={() => { setDialog(null); setReportTarget(c); }} className={`${ITEM} border border-[#EFEFEF]`}>{c.name}</button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setDialog(null)} className="mt-3 w-full rounded-xl border border-[#DDDEE7] px-4 py-3 mobile:min-h-12 text-sm mobile:text-mb-compact">취소</button>
          </div>
        </div>, document.body)}
      {reportTarget && <ReportDialog
        targetUserId={reportTarget.userId}
        targetName={reportTarget.name}
        roomId={room.id}
        onClose={() => setReportTarget(null)}
        onReported={(result) => {
          if (!result.blocked) return;
          // 즉시 캐시에서 상대 콘텐츠를 지우고, 그룹 방 preview 등은 서버 기준으로 다시 받는다.
          useChatStore.getState().applyBlock(reportTarget.userId);
          void listChatRooms().then((res) => useChatStore.getState().setRooms(res.rooms)).catch(() => { /* 조용히 실패 */ });
        }}
      />}
      {unblockError && <p role="alert" className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg bg-white p-2 text-xs text-red-700 shadow">내가 건 차단만 해제할 수 있어요. 설정 &gt; 차단한 사용자에서 확인해 주세요.</p>}
    </div>
  );
}
