// 채팅 페이지 — 좌측 대화 목록 + 우측 채팅 영역. /chat 또는 /chat/:sessionId

import { useEffect, useMemo, useState, useRef, useCallback, Component, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import {
  listChatRooms,
  listChatMessages,
  sendChatMessage,
  markRoomRead,
  type ChatRoom as ChatRoomDto,
  type ChatMessage,
} from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { useAuthStore } from '../../stores/authStore';

// 인라인 ErrorBoundary
class InlineErrorBoundary extends Component<{ children: ReactNode; name: string }, { hasError: boolean; errorMsg: string }> {
  constructor(props: { children: ReactNode; name: string }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, errorMsg: err.message ?? String(err) };
  }
  componentDidCatch(err: Error, info: { componentStack: string }) {
    console.error(`[ErrorBoundary:${this.props.name}]`, err, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 p-4 rounded-xl bg-red-50 border border-red-200 text-sm">
          <p className="font-bold text-red-600">⚠️ {this.props.name} 렌더링 오류</p>
          <p className="text-red-500 mt-1 font-mono text-xs whitespace-pre-wrap">{this.state.errorMsg}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// 인라인 채팅방 (ChatRoom 없이)
function InlineChatRoom({ roomId }: { roomId: string }) {
  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messagesByRoom[roomId] ?? []);
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const clearRoomUnread = useChatStore((s) => s.clearRoomUnread);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        console.error('[InlineChatRoom] API error:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '메시지 로딩 실패');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [roomId, setMessages]);

  useEffect(() => {
    markRoomRead(roomId).catch(() => undefined);
    clearRoomUnread(roomId);
  }, [roomId, clearRoomUnread]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
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
      <div className="px-3 py-1.5 text-[11px] font-mono flex gap-3 border-b border-[#EFEFEF] bg-[#FFF9F0]">
        <span>state: {loading ? 'loading' : error ? 'error' : `msgs(${messages.length})`}</span>
        <span className="text-[#9CA0AE]">user: {user ? '✓' : '✗'}</span>
        {error && <span className="text-red-500">err: {error}</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 flex flex-col-reverse">
        {loading ? (
          <div className="text-center text-gray-500 py-4">메시지를 불러오는 중…</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500 py-4">아직 메시지가 없습니다</div>
        ) : (
          messages.map((m: ChatMessage) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.type === 'system' ? 'center' : (!!user && m.sender_id === user.id ? 'flex-end' : 'flex-start'), margin: '4px 0' }}>
              <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 14px', borderRadius: m.type === 'system' ? '999px' : '16px', fontSize: m.type === 'system' ? '12px' : '14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: m.type === 'system' ? '#F2F3F8' : (!!user && m.sender_id === user.id ? '#5F0080' : '#F5EDFC'), color: m.type === 'system' ? '#6F6F6F' : (!!user && m.sender_id === user.id ? '#fff' : '#1F1F1F') }}>
                  {m.content ?? '(내용 없음)'}
                </div>
                <span style={{ fontSize: '10px', color: '#9CA0AE', marginTop: '2px', textAlign: (!!user && m.sender_id === user.id) ? 'right' : 'left' }}>
                  {(m.created_at ?? '').slice(11, 16)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-[#EFEFEF] p-3 flex gap-2 bg-white">
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
          placeholder="메시지를 입력하세요"
          className="flex-1 h-11 px-4 rounded-xl border border-[#DDDEE7] bg-white text-sm text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15 transition" />
        <button type="button" onClick={() => void handleSend()} disabled={!input.trim()}
          className="mb-btn disabled:opacity-50">전송</button>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const rooms = useChatStore((s) => s.rooms);
  const setRooms = useChatStore((s) => s.setRooms);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listChatRooms()
      .then((res) => {
        if (cancelled) return;
        setRooms(res.rooms);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '로딩 실패');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [setRooms]);

  const selectedRoom: ChatRoomDto | null = useMemo(() => {
    if (!sessionId) return null;
    return rooms.find((r) => r.session_id === sessionId) ?? null;
  }, [rooms, sessionId]);

  const handleSelect = (room: ChatRoomDto): void => {
    navigate(`/chat/${room.session_id}`);
  };

  return (
    <AppShell title="채팅" sub="MESSAGES" contentPad="" noScroll>
      <div className="h-full flex flex-col md:grid md:grid-cols-[320px_1fr]">
        <aside className={`border-r border-[#EFEFEF] bg-white overflow-y-auto ${sessionId ? 'hidden md:block' : 'block'}`}>
          {loading ? (
            <div className="p-6 text-center text-sm text-[#6F6F6F]">불러오는 중…</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-500">{error}</div>
          ) : rooms.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#6F6F6F]">아직 채팅방이 없습니다.</div>
          ) : (
            <ul className="divide-y divide-[#EFEFEF]">
              {rooms.map((room) => {
                const isActive = room.session_id === sessionId;
                return (
                  <li key={room.id}>
                    <button type="button" onClick={() => handleSelect(room)}
                      className={`w-full text-left flex items-center gap-3 px-5 py-4 transition-colors ${isActive ? 'bg-[#F5EDFC]' : 'hover:bg-[#F8F8FB]'}`}>
                      <div className="w-11 h-11 rounded-full bg-[#F5EDFC] ring-2 ring-[#5F0080]/20 flex items-center justify-center text-[#5F0080] font-bold shrink-0">#</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[14px] text-[#1F1F1F] truncate">세션 {room.session_id.slice(0, 8)}</span>
                          <span className="text-[11px] text-[#6F6F6F] font-mono shrink-0">{new Date(room.created_at).toLocaleDateString('ko-KR')}</span>
                        </div>
                        <p className="text-[12px] text-[#6F6F6F] truncate mt-0.5">채팅방으로 이동</p>
                      </div>
                      {room.unread_count > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#5F0080] text-white text-[11px] font-bold inline-flex items-center justify-center font-mono shrink-0">{room.unread_count}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className={`flex-1 flex flex-col overflow-hidden bg-white ${sessionId ? 'flex' : 'hidden md:flex'}`}>
          {selectedRoom ? (
            <InlineErrorBoundary name="ChatRoom">
              <div className="md:hidden border-b border-[#EFEFEF] px-4 py-2.5">
                <button type="button" onClick={() => navigate('/chat')} className="text-sm text-[#5F0080] font-medium">← 대화 목록</button>
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="px-3 py-1.5 text-[11px] font-mono bg-yellow-200 border-b border-yellow-400">
                  ✅ ChatRoom 영역 진입 — roomId: {selectedRoom.id.slice(0, 12)}…
                </div>
                <InlineChatRoom roomId={selectedRoom.id} />
              </div>
            </InlineErrorBoundary>
          ) : sessionId && !loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-[#6F6F6F]">채팅방을 찾을 수 없습니다.</div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[#6F6F6F]">왼쪽에서 대화를 선택하세요.</div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
