// 채팅방 컴포넌트 — 메시지 리스트 + 입력창
import { useEffect, useState, useCallback } from 'react';
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
  const msgList = messages ?? [];
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // flex-col-reverse가 새 메시지를 자동으로 하단에 배치하므로 별도 스크롤 불필요

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try {
      const msg = await sendChatMessage(roomId, { content, type: 'text' });
      appendMessage(roomId, msg);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '전송 실패');
    }
  }, [input, roomId, appendMessage]);

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-white pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <div
        className="flex-1 overflow-y-auto px-4 py-2 flex flex-col-reverse"
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
