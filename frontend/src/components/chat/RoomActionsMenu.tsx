import { useEffect, useId, useRef, useState } from 'react';
import { unblockChatUser, listChatRooms, type ChatRoom } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { canInviteToRoom } from '../../lib/api/chat-invite';
import { useAuthStore } from '../../stores/authStore';

interface Props {
  room: ChatRoom;
  onSettings: () => void;
  onInvite?: () => void;
  /** 차단 해제가 서버에 반영된 직후 호출(선택) */
  onUnblocked?: () => void;
}

export function RoomActionsMenu({ room, onSettings, onInvite, onUnblocked }: Props) {
  const user = useAuthStore((state) => state.user);
  const canInvite = !!onInvite && canInviteToRoom(room, user);
  const [open, setOpen] = useState(false);
  const [unblockError, setUnblockError] = useState(false);
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
          className="w-full rounded-lg px-3 py-2 mobile:min-h-11 text-left text-sm mobile:text-mb-compact text-[#1F1F1F] hover:bg-[#F5EDFC] focus:bg-[#F5EDFC] focus:outline-none">채팅방 설정</button>
      </div>}
      {unblockError && <p role="alert" className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg bg-white p-2 text-xs text-red-700 shadow">내가 건 차단만 해제할 수 있어요. 설정 &gt; 차단한 사용자에서 확인해 주세요.</p>}
    </div>
  );
}
