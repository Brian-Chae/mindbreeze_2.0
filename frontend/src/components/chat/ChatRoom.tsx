// 채팅방 컴포넌트 — 메시지 리스트 + 입력창
import { useEffect, useRef, useState, useCallback } from 'react';
import { listChatMessages, sendChatMessage } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

interface Props {
  roomId: string;
}

export function ChatRoom({ roomId }: Props) {
  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messagesByRoom[roomId]);
  // store는 최신순 저장 → 일반 flex-col용으로 오래된 순으로 뒤집기
  const msgList = messages ? [...messages].reverse() : [];
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const didInitialScroll = useRef(false);

  // DOM ref로 직접 스크롤 (store 의존성 회피)
  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // 초기 로딩 완료 시 한 번만 하단 스크롤
  useEffect(() => {
    if (!loading && !didInitialScroll.current) {
      // DOM이 렌더링된 후 스크롤
      requestAnimationFrame(() => {
        scrollToBottom();
        didInitialScroll.current = true;
      });
    }
  }, [loading, scrollToBottom]);

  // 초기 메시지 로딩
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    didInitialScroll.current = false;
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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try {
      const msg = await sendChatMessage(roomId, { content, type: 'text' });
      appendMessage(roomId, msg);
      // 전송 후 최하단 스크롤
      requestAnimationFrame(() => scrollToBottom());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '전송 실패');
    }
  }, [input, roomId, appendMessage, scrollToBottom]);

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-white">
      {/* 메시지 리스트 — 일반 flex-col (oldest top → newest bottom) */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-2"
      >
        {loading ? (
          <div className="text-center text-gray-500 py-4">메시지를 불러오는 중…</div>
        ) : msgList.length === 0 ? (
          <div className="text-center text-gray-500 py-4">아직 메시지가 없습니다</div>
        ) : (
          msgList.map((m) =>
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
        <div className="px-4 py-1 text-xs text-red-500 bg-red-50">{error}</div>
      )}

      {/* 입력창 — 항상 하단 고정 */}
      <div className="border-t border-[#EFEFEF] p-3 flex gap-2 bg-white shrink-0">
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
