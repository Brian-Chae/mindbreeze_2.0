// 채팅방 — iOS 모바일 대응 재구현 + WebSocket 실시간
import { useCallback, useEffect, useRef, useState } from 'react';
import { listChatMessages, sendChatMessage, markRoomRead, type ChatMessage } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { getChatSocket } from '../../lib/socket';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';
import type { Socket } from 'socket.io-client';

// ---- 날짜 포맷 유틸 (KST 기준) ----

const DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const KST_OPTS = { timeZone: 'Asia/Seoul' } as const;

/** ISO 문자열 → KST 기준 "2025년 5월 27일 화요일 오전" */
function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const y = d.toLocaleString('en-US', { ...KST_OPTS, year: 'numeric' });
  const M = d.toLocaleString('en-US', { ...KST_OPTS, month: 'numeric' });
  const dd = d.toLocaleString('en-US', { ...KST_OPTS, day: 'numeric' });
  const dayName = DAYS[new Date(d.toLocaleString('en-US', KST_OPTS)).getDay()];
  const hour = parseInt(d.toLocaleString('en-US', { ...KST_OPTS, hour: 'numeric', hour12: false }), 10);
  const ampm = hour < 12 ? '오전' : '오후';
  return `${y}년 ${M}월 ${dd}일 ${dayName} ${ampm}`;
}

/** 두 ISO 문자열이 KST 기준 서로 다른 날짜인지 */
function isDifferentDay(a: string, b: string): boolean {
  return new Date(a).toLocaleDateString('ko-KR', KST_OPTS) !==
         new Date(b).toLocaleDateString('ko-KR', KST_OPTS);
}

// ---- DateSeparator 컴포넌트 ----

function DateSeparator({ iso }: { iso: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 8px' }}>
      <span
        style={{
          fontSize: '12px',
          color: '#8E8E93',
          background: '#F2F2F7',
          borderRadius: '12px',
          padding: '4px 12px',
        }}
      >
        {formatDateLabel(iso)}
      </span>
    </div>
  );
}

interface Props {
  roomId: string;
  /** 상대방 이름 (직접 채팅에서 표시용). 미지정 시 sender_id 기반 "사용자" */
  peerName?: string;
}

export function ChatRoom({ roomId, peerName }: Props) {
  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messagesByRoom[roomId]);
  // store는 최신순 저장 → 일반 flex-col용으로 오래된 순으로 뒤집기
  const msgList = messages ? [...messages].reverse() : [];
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateSenderName = useChatStore((s) => s.updateSenderName);
  const clearRoomUnread = useChatStore((s) => s.clearRoomUnread);
  const setActiveRoom = useChatStore((s) => s.setActiveRoom);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const keyboardHeight = useKeyboardHeight();
  const { handleScroll, scrollToBottom } = useAutoScroll(listRef, [msgList.length, loading]);

  // 초기 메시지 로딩 + 최하단 스크롤 + 읽음 처리
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listChatMessages(roomId)
      .then((res) => {
        if (!cancelled) {
          setMessages(roomId, res.messages);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '메시지 로딩 실패');
          setLoading(false);
        }
      });
    // 읽음 처리 — API 호출 + 스토어 초기화
    clearRoomUnread(roomId);
    markRoomRead(roomId)
      .then(() => useNotificationStore.getState().fetch())
      .catch(() => { /* 조용히 실패 */ });
    // 현재 보고 있는 방 활성화 (다른 방 메시지 unread 증가 방지)
    setActiveRoom(roomId);
    return () => {
      cancelled = true;
      setActiveRoom(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // 메시지 로딩 완료 후 최하단 스크롤
  useEffect(() => {
    if (!loading && msgList.length > 0) {
      const timer = setTimeout(() => scrollToBottom(), 100);
      return () => clearTimeout(timer);
    }
  }, [loading, msgList.length, scrollToBottom]);

  // WebSocket 실시간 수신
  const token = useAuthStore((s) => s.accessToken);
  useEffect(() => {
    if (!roomId || !token) return;

    const socket: Socket = getChatSocket(token);
    socket.emit('join_room', { room_id: roomId });

    const handleNewMessage = (msg: ChatMessage): void => {
      if (msg.room_id !== roomId) return;
      appendMessage(roomId, msg);
    };

    socket.on('new_message', handleNewMessage);

    const handleProfileUpdated = (payload: { user_id: string; name: string }): void => {
      updateSenderName(payload.user_id, payload.name);
    };
    socket.on('profile_updated', handleProfileUpdated);

    const handleReconnect = (): void => {
      socket.emit('join_room', { room_id: roomId });
    };
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('profile_updated', handleProfileUpdated);
      socket.off('connect', handleReconnect);
      socket.emit('leave_room', { room_id: roomId });
    };
  }, [roomId, token, appendMessage, updateSenderName]);

  const handleSend = useCallback(async (): Promise<void> => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try {
      const msg = await sendChatMessage(roomId, { content, type: 'text' });
      appendMessage(roomId, msg);
      scrollToBottom();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '전송 실패');
    }
  }, [input, roomId, appendMessage, scrollToBottom]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      {/* 메시지 리스트 */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-2"
      >
        {loading ? (
          <div className="text-center text-gray-500 py-4">메시지를 불러오는 중…</div>
        ) : msgList.length === 0 ? (
          <div className="text-center text-gray-500 py-4">아직 메시지가 없습니다</div>
        ) : (
          msgList.map((m, idx, arr) => {
            const showDateSep =
              idx === 0 || isDifferentDay(arr[idx - 1].created_at, m.created_at);
            const isMine = !!user && m.sender_id === user.id;
            // 같은 발신자의 연속 메시지인지 (시스템 메시지 제외)
            const prevMsg = idx > 0 ? arr[idx - 1] : null;
            const isSameSender =
              prevMsg &&
              prevMsg.type !== 'system' &&
              prevMsg.sender_id === m.sender_id;
            const showSender = !isMine && !isSameSender;
            const senderName = !isMine ? (m.sender_name || peerName || '사용자') : undefined;
            const item =
              m.type === 'system' ? (
                <SystemMessage key={m.id} content={m.content} createdAt={m.created_at} />
              ) : (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isMine={isMine}
                  senderName={senderName}
                  showSender={showSender}
                />
              );
            return showDateSep ? (
              <div key={`group-${m.id}`}>
                <DateSeparator iso={m.created_at} />
                {item}
              </div>
            ) : (
              item
            );
          })
        )}
      </div>

      {error && (
        <div className="px-4 py-1 text-xs text-red-500 bg-red-50 shrink-0">{error}</div>
      )}

      {/* 입력창 */}
      <div
        className="border-t border-[#EFEFEF] p-3 flex gap-2 bg-white shrink-0"
        style={{ paddingBottom: `calc(0.75rem + ${keyboardHeight}px)` }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="메시지를 입력하세요"
          className="flex-1 h-11 px-4 rounded-xl border border-[#DDDEE7] bg-white text-base text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15 transition"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!input.trim()}
          className="mb-btn disabled:opacity-50"
        >
          전송
        </button>
      </div>
    </div>
  );
}
