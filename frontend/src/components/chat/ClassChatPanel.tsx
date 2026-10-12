// SDD-095: 클래스 내 실시간 채팅 패널 — 우측 고정 오버레이(모바일은 하단 시트).
// 기존 채팅 자산을 그대로 재사용한다: 방 메시지 목록·전송·읽음 처리·WebSocket 수신은
// ChatRoom(zustand chatStore + /chat 네임스페이스)이 담당하고, 이 패널은
//   ⓐ 세션 → 채팅방 해석, ⓑ 접기/펼치기, ⓒ 접힘 상태의 안읽음 배지만 책임진다.
// 발언권(손들기)·스피커·몰입(화면 끄기) 등 기존 클래스 동작은 건드리지 않는다.

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { getChatRoom, getSessionChatRoom, type ChatMessage } from '../../lib/api/chat';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { getChatSocket } from '../../lib/socket';
import { ChatRoom } from './ChatRoom';

interface ClassChatPanelProps {
  sessionId: string;
  /** 상담사 토글이 켜졌을 때만 true — false면 아무것도 렌더하지 않는다 */
  enabled: boolean;
  /** 세션 응답이 방 id를 함께 내려주면 조회를 생략한다 */
  roomId?: string | null;
  title?: string;
  /** 접힘 여부(제어 컴포넌트) — 호출측이 소유한다 */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

/** 채팅 아이콘 */
function ChatIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/** 안읽음 배지 — 99 초과는 99+ */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#5F0080] px-1.5 font-mono text-[11px] font-bold text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function ClassChatPanel({
  sessionId,
  enabled,
  roomId,
  title = '클래스 채팅',
  collapsed,
  onCollapsedChange,
}: ClassChatPanelProps) {
  const token = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [fetchedRoomId, setFetchedRoomId] = useState<string | null>(null);
  const activeRoomId = roomId ?? fetchedRoomId;

  // 방 id 미제공 시 세션 채팅방을 조회한다. 404(방 미개설)·403(게스트)이면
  // 조용히 패널을 숨긴다 — 클래스 진행을 막지 않는다.
  useEffect(() => {
    if (!enabled || roomId || !sessionId || !token) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const room = await getSessionChatRoom(sessionId);
        if (!cancelled) setFetchedRoomId(room.room_id ?? null);
      } catch {
        // 방 조회 실패 → 패널 미표시(다음 렌더에서 재시도)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, roomId, sessionId, token]);

  // 안읽음 배지는 chatStore의 방 unread_count를 쓰므로, 방이 목록에 없으면 한 번 채워 둔다.
  useEffect(() => {
    if (!enabled || !activeRoomId || !token) return;
    if (useChatStore.getState().rooms.some((room) => room.id === activeRoomId)) return;
    void getChatRoom(activeRoomId)
      .then((room) => {
        useChatStore.getState().upsertRoom(room);
      })
      .catch(() => {
        // 목록·알림 조회가 복구한다
      });
  }, [enabled, activeRoomId, token]);

  // 접힘 상태에서는 ChatRoom이 없어 새 메시지를 못 받으므로, 패널이 방에 join해
  // 배지만 올린다(메시지 본문은 펼칠 때 ChatRoom이 다시 조회한다).
  useEffect(() => {
    if (!enabled || !collapsed || !activeRoomId || !token) return undefined;
    const socket: Socket = getChatSocket(token);
    socket.emit('join_room', { room_id: activeRoomId });

    const handleNewMessage = (msg: ChatMessage): void => {
      if (msg.room_id !== activeRoomId) return;
      // 내가 보낸 메시지는 배지로 세지 않는다
      if (userId && msg.sender_id === userId) return;
      useChatStore.getState().incrementUnread(activeRoomId);
    };

    socket.on('new_message', handleNewMessage);
    return () => {
      socket.off('new_message', handleNewMessage);
    };
  }, [enabled, collapsed, activeRoomId, token, userId]);

  const unread = useChatStore(
    (s) => s.rooms.find((room) => room.id === activeRoomId)?.unread_count ?? 0,
  );

  // 미인증(게스트)·비활성·방 미해석 → 아무것도 그리지 않는다
  if (!enabled || !isAuthenticated || !activeRoomId) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => onCollapsedChange(false)}
        aria-expanded={false}
        aria-label={`${title} 펼치기`}
        className="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-full bg-white/95 px-4 py-3 text-sm font-semibold text-[#5F0080] shadow-lg ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-white"
      >
        <ChatIcon />
        <span>{title}</span>
        <UnreadBadge count={unread} />
      </button>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label={title}
      className="fixed inset-x-0 bottom-0 z-50 flex h-[55vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-black/10 md:inset-x-auto md:bottom-4 md:right-4 md:top-20 md:h-auto md:w-[360px] md:rounded-2xl"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#EFEFEF] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold text-[#1F1F1F]">{title}</span>
          <UnreadBadge count={unread} />
        </div>
        <button
          type="button"
          onClick={() => onCollapsedChange(true)}
          aria-expanded={true}
          aria-label={`${title} 접기`}
          className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-[#6F6F6F] transition-colors hover:bg-[#F2F3F8] hover:text-[#1F1F1F]"
        >
          접기
        </button>
      </header>

      {/* 기존 ChatRoom 재사용 — 목록·전송·읽음·실시간 수신 모두 이 컴포넌트가 담당한다 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatRoom key={activeRoomId} roomId={activeRoomId} />
      </div>
    </aside>
  );
}
