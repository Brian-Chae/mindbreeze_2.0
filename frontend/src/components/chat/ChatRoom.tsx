// 채팅방 — 진단 Step 1: plain div 렌더링 (컴포넌트 없이)
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  listChatMessages,
  sendChatMessage,
  markRoomRead,
} from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';

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
    setError(null);
    listChatMessages(roomId)
      .then((res) => {
        if (!cancelled) {
          setMessages(roomId, res.messages);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        console.error('[ChatRoom] API error:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '메시지 로딩 실패');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, setMessages]);

  // 읽음 처리
  useEffect(() => {
    markRoomRead(roomId).catch(() => undefined);
    clearRoomUnread(roomId);
  }, [roomId, clearRoomUnread]);

  // 새 메시지 도착 시 최하단 스크롤
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '전송 실패');
    }
  }, [input, roomId, appendMessage]);

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-white">
      {/* 디버그 헤더 */}
      <div className="px-3 py-1.5 text-[11px] font-mono flex gap-3 border-b border-[#EFEFEF] bg-[#FFF9F0]">
        <span>state: {loading ? 'loading' : error ? 'error' : `msgs(${messages.length})`}</span>
        {error && <span className="text-red-500">err: {error}</span>}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2 flex flex-col-reverse"
      >
        {loading ? (
          <div className="text-center text-gray-500 py-4">메시지를 불러오는 중…</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500 py-4">아직 메시지가 없습니다</div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                justifyContent: m.type === 'system' ? 'center' : (!!user && m.sender_id === user.id ? 'flex-end' : 'flex-start'),
                margin: '4px 0',
              }}
            >
              <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column' }}>
                <div style={{
                  padding: '8px 14px',
                  borderRadius: m.type === 'system' ? '999px' : '16px',
                  fontSize: m.type === 'system' ? '12px' : '14px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: m.type === 'system' ? '#F2F3F8' : (!!user && m.sender_id === user.id ? '#5F0080' : '#F5EDFC'),
                  color: m.type === 'system' ? '#6F6F6F' : (!!user && m.sender_id === user.id ? '#fff' : '#1F1F1F'),
                }}>
                  {m.content ?? '(내용 없음)'}
                  {m.type === 'system' && (
                    <span style={{ marginLeft: '8px', opacity: 0.7, fontSize: '10px' }}>
                      {(m.created_at ?? '').slice(11, 16)}
                    </span>
                  )}
                </div>
                {m.type !== 'system' && (
                  <span style={{
                    fontSize: '10px',
                    color: '#9CA0AE',
                    marginTop: '2px',
                    textAlign: (!!user && m.sender_id === user.id) ? 'right' : 'left',
                  }}>
                    {(m.created_at ?? '').slice(11, 16)}
                  </span>
                )}
              </div>
            </div>
          ))
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
