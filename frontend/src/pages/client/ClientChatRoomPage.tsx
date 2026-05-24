// 내담자 채팅방 페이지
// 상담사와의 1:1 채팅 — WebSocket 실시간 메시지 + REST 전송

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listChatMessages, sendChatMessage, getChatRoom, type ChatMessage, type ChatRoom } from '../../lib/api/chat';
import { useAuthStore } from '../../stores/authStore';
import { getChatSocket } from '../../lib/socket';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import type { Socket } from 'socket.io-client';

/** HH:mm 형식 */
function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

export default function ClientChatRoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.accessToken);

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const keyboardHeight = useKeyboardHeight();
  const myUserId = user?.id ?? '';

  // 채팅방 정보 + 메시지 로딩
  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getChatRoom(roomId).catch(() => null),
      listChatMessages(roomId).catch(() => ({ messages: [] as ChatMessage[], next_cursor: null })),
    ])
      .then(([roomRes, msgRes]) => {
        if (cancelled) return;
        if (roomRes) setRoom(roomRes);
        // API는 최신순으로 반환하므로 reverse 하여 오래된 순으로 표시
        setMessages([...msgRes.messages].reverse());
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '채팅방을 불러올 수 없습니다');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // WebSocket 연결 + room join
  useEffect(() => {
    if (!roomId || !token) return;

    const socket = getChatSocket(token);
    socketRef.current = socket;

    socket.emit('join_room', { room_id: roomId });

    const handleNewMessage = (msg: ChatMessage): void => {
      if (msg.room_id !== roomId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    socket.on('new_message', handleNewMessage);

    // 연결이 끊어졌다 재연결 시에도 room 재join
    const handleReconnect = (): void => {
      socket.emit('join_room', { room_id: roomId });
    };
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('connect', handleReconnect);
      socket.emit('leave_room', { room_id: roomId });
    };
  }, [roomId, token]);

  // 새 메시지 도착 시 스크롤 하단으로
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // 메시지 전송
  const handleSend = useCallback(async (): Promise<void> => {
    const content = input.trim();
    if (!content || !roomId || sending) return;

    setInput('');
    setSending(true);

    try {
      const msg = await sendChatMessage(roomId, { content, type: 'text' });
      setMessages((prev) => [...prev, msg]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '메시지 전송 실패');
    } finally {
      setSending(false);
    }
  }, [input, roomId, sending]);

  // 메시지 그룹화: 같은 sender_id가 연속될 경우 첫 메시지만 아바타 표시
  const renderMessage = (msg: ChatMessage, idx: number): React.ReactNode => {
    if (msg.type === 'system') {
      return (
        <div key={msg.id} className="flex justify-center my-2">
          <div className="bg-[#F5F5F5] text-[#6F6F6F] text-xs text-center rounded-xl py-1.5 px-4 max-w-[60%]">
            {msg.content ?? ''}
          </div>
        </div>
      );
    }

    const isMine = msg.sender_id === myUserId;
    const isCounselor = !isMine;
    const prevMsg = idx > 0 ? messages[idx - 1] : null;
    const isFirstInGroup = !prevMsg || prevMsg.sender_id !== msg.sender_id || prevMsg.type === 'system';

    return (
      <div key={msg.id} className={`flex items-end gap-2 my-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
        {/* 상담사 아바타 (첫 메시지만) */}
        <div className="w-7 shrink-0">
          {isCounselor && isFirstInGroup ? (
            <div className="w-7 h-7 rounded-full bg-[#EFEFEF] flex items-center justify-center">
              <span className="text-[10px] font-bold text-[#5F0080]">
                {(room?.name ?? '상')[0]}
              </span>
            </div>
          ) : null}
        </div>

        {/* 말풍선 */}
        <div className={`max-w-[75%] ${isMine ? 'order-[-1]' : ''}`}>
          <div
            className={
              isMine
                ? 'bg-[#5F0080] text-white rounded-2xl rounded-br-md ml-auto px-3.5 py-2.5 text-[15px] leading-relaxed'
                : 'bg-white border border-[#EFEFEF] text-[#1F1F1F] rounded-2xl rounded-bl-md mr-auto px-3.5 py-2.5 text-[15px] leading-relaxed'
            }
            style={{ wordBreak: 'break-word' }}
          >
            {msg.content ?? ''}
          </div>
          {/* 시간 */}
          <p
            className={`text-[10px] text-[#6F6F6F] mt-0.5 ${
              isMine ? 'text-right' : 'text-left'
            }`}
          >
            {formatTime(msg.created_at)}
          </p>
        </div>
      </div>
    );
  };

  // 뒤로가기
  const handleBack = (): void => {
    navigate('/app/chat');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] min-h-0 bg-white">
      {/* 상단 헤더 */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-white border-b border-[#EFEFEF] flex items-center px-4 gap-3 max-w-lg mx-auto w-full">
        <button
          type="button"
          onClick={handleBack}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#EFEFEF] shrink-0 transition-colors"
          aria-label="뒤로가기"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12l4.58-4.59Z"
              fill="#1F1F1F"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-[#1F1F1F] truncate">
            {room?.name || '채팅방'}
          </h1>
        </div>
      </header>

      {/* 메시지 리스트 */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 mt-14"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-sm text-[#6F6F6F]">
            메시지를 불러오는 중...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-12 h-12 rounded-full bg-[#EFEFEF] flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z"
                  fill="#6F6F6F"
                />
              </svg>
            </div>
            <p className="text-sm text-[#6F6F6F]">대화를 시작해보세요</p>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => renderMessage(msg, idx))}
            <div ref={bottomRef} />
          </>
        )}

        {/* 에러 표시 */}
        {error && (
          <div className="mx-4 my-2 p-2 bg-red-50 rounded-lg text-xs text-red-500 text-center">
            {error}
          </div>
        )}
      </div>

      {/* 입력창 */}
      <div
        className="bg-white border-t border-[#EFEFEF] p-3 flex gap-2 shrink-0"
        style={{ paddingBottom: `calc(0.75rem + ${keyboardHeight}px)` }}
      >
        <input
          ref={inputRef}
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
          className="flex-1 h-10 px-4 rounded-full bg-[#F5F5F5] text-[15px] text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:ring-2 focus:ring-[#5F0080]/20 transition"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full bg-[#5F0080] flex items-center justify-center shrink-0 disabled:opacity-40 transition-opacity active:scale-95"
          aria-label="전송"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2 .01 7Z"
              fill="white"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
