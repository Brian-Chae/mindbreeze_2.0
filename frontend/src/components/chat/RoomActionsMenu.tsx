import { useEffect, useId, useRef, useState } from 'react';
import type { ChatRoom } from '../../lib/api/chat';
import { canInviteToRoom } from '../../lib/api/chat-invite';
import { useAuthStore } from '../../stores/authStore';

interface Props {
  room: ChatRoom;
  onSettings: () => void;
  onInvite?: () => void;
}

export function RoomActionsMenu({ room, onSettings, onInvite }: Props) {
  const user = useAuthStore((state) => state.user);
  const canInvite = !!onInvite && canInviteToRoom(room, user);
  const [open, setOpen] = useState(false);
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
        }} className="flex h-10 w-10 items-center justify-center rounded-lg text-xl text-[#6F6F6F] hover:bg-[#F5EDFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080]">⋯</button>
      {open && <div id={menuId} role="menu" className="absolute right-0 top-full z-20 w-36 rounded-xl border border-[#DDDEE7] bg-white p-1 shadow-lg">
        {canInvite && <button role="menuitem" type="button" onClick={() => { buttonRef.current?.focus(); setOpen(false); onInvite?.(); }}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#5F0080] hover:bg-[#F5EDFC] focus:bg-[#F5EDFC] focus:outline-none">회원 초대</button>}
        <button ref={itemRef} role="menuitem" type="button" onClick={() => { buttonRef.current?.focus(); setOpen(false); onSettings(); }}
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#1F1F1F] hover:bg-[#F5EDFC] focus:bg-[#F5EDFC] focus:outline-none">채팅방 설정</button>
      </div>}
    </div>
  );
}
