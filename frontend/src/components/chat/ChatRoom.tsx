// 채팅방 — iOS 모바일 대응 재구현
import { useCallback, useEffect, useRef, useState } from 'react';
import { listChatMessages, sendChatMessage } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { useAutoScroll } from '../../hooks/useAutoScroll';
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

  const keyboardHeight = useKeyboardHeight();
  const { handleScroll, scrollToBottom } = useAutoScroll(listRef, [msgList.length, loading]);

  // 초기 메시지 로딩
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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

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
            if (e.key === 'Enter' && !e.shiftKey) {
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
