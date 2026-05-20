// 채팅방 컴포넌트 — 메시지 리스트 + 입력창 + WebSocket 연동

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  listChatMessages,
  sendChatMessage,
  markRoomRead,
  type ChatMessage,
} from '../../lib/api/chat';
import { tokenStorage } from '../../lib/api/client';
import { getChatSocket, disconnectChatSocket } from '../../lib/socket';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

interface Props {
  roomId: string;
}

export function ChatRoom({ roomId }: Props) {
  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messagesByRoom[roomId] ?? []);
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const clearRoomUnread = useChatStore((s) => s.clearRoomUnread);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 초기 메시지 로딩
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listChatMessages(roomId)
      .then((res) => {
        if (!cancelled) {
          setMessages(roomId, res.messages);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '메시지 로딩 실패');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, setMessages]);

  // 읽음 처리 + 미수신 카운트 클리어
  useEffect(() => {
    markRoomRead(roomId).catch(() => undefined);
    clearRoomUnread(roomId);
  }, [roomId, clearRoomUnread]);

  // Socket.IO 연결 + 메시지 수신
  useEffect(() => {
    const token = tokenStorage.getAccess();
    if (!token) return;
    const socket = getChatSocket(token);
    socket.emit('join', { room_id: roomId });
    const onMessage = (data: ChatMessage): void => {
      if (data.room_id === roomId) {
        appendMessage(roomId, data);
      }
    };
    socket.on('message', onMessage);
    socket.on('system', onMessage);
    return () => {
      socket.emit('leave', { room_id: roomId });
      socket.off('message', onMessage);
      socket.off('system', onMessage);
    };
  }, [roomId, appendMessage]);

  // 컴포넌트 언마운트 시 소켓 종료
  useEffect(() => {
    return () => {
      disconnectChatSocket();
    };
  }, []);

  // 새 메시지 도착 시 최하단으로 스크롤 (리스트는 최신순 → flex-col-reverse 사용 시 자동)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try {
      const msg = await sendChatMessage(roomId, { content, type: 'text' });
      appendMessage(roomId, msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : '전송 실패');
    }
  }, [input, roomId, appendMessage]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2 flex flex-col-reverse"
      >
        {loading ? (
          <div className="text-center text-gray-500 py-4">메시지를 불러오는 중…</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500 py-4">아직 메시지가 없습니다.</div>
        ) : (
          messages.map((m) =>
            m.type === 'system' ? (
              <SystemMessage key={m.id} content={m.content} createdAt={m.created_at} />
            ) : (
              <MessageBubble
                key={m.id}
                message={m}
                isMine={!!user && m.sender_id === user.id}
              />
            )
          )
        )}
      </div>
      {error && (
        <div className="px-4 py-1 text-xs text-red-500 bg-red-50">
          {error}
        </div>
      )}
      <div className="border-t border-[#EFEFEF] p-3 flex gap-2 bg-white">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="메시지를 입력하세요"
          className="flex-1 h-11 px-4 rounded-xl border border-[#DDDEE7] bg-white text-sm text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15 transition"
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
