// 채팅 페이지 — 좌측 대화 목록 + 우측 채팅 영역. /chat 또는 /chat/:sessionId

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { ChatRoom } from '../../components/chat/ChatRoom';
import { listChatRooms, type ChatRoom as ChatRoomDto } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';

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
    <AppShell title="채팅" sub="MESSAGES" contentPad="" noScroll hideBottomTab noBottomPad>
      <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[320px_1fr]">
        {/* 좌측 대화 목록 */}
        <aside
          className={`border-r border-[#EFEFEF] bg-white overflow-y-auto ${
            sessionId ? 'hidden md:block' : 'block'
          }`}
        >
          {loading ? (
            <div className="p-6 text-center text-sm text-[#6F6F6F]">불러오는 중…</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-500">{error}</div>
          ) : rooms.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#6F6F6F]">
              아직 채팅방이 없습니다.
            </div>
          ) : (
            <ul className="divide-y divide-[#EFEFEF]">
              {rooms.map((room) => {
                const isActive = room.session_id === sessionId;
                return (
                  <li key={room.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(room)}
                      className={`w-full text-left flex items-center gap-3 px-5 py-4 transition-colors ${
                        isActive ? 'bg-[#F5EDFC]' : 'hover:bg-[#F8F8FB]'
                      }`}
                    >
                      <div className="w-11 h-11 rounded-full bg-[#F5EDFC] ring-2 ring-[#5F0080]/20 flex items-center justify-center text-[#5F0080] font-bold shrink-0">
                        #
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[14px] text-[#1F1F1F] truncate">
                            세션 {room.session_id.slice(0, 8)}
                          </span>
                          <span className="text-[11px] text-[#6F6F6F] font-mono shrink-0">
                            {new Date(room.created_at).toLocaleDateString('ko-KR')}
                          </span>
                        </div>
                        <p className="text-[12px] text-[#6F6F6F] truncate mt-0.5">
                          채팅방으로 이동
                        </p>
                      </div>
                      {room.unread_count > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#5F0080] text-white text-[11px] font-bold inline-flex items-center justify-center font-mono shrink-0">
                          {room.unread_count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* 우측 채팅 영역 */}
        <main
          className={`flex-1 flex flex-col overflow-hidden bg-white ${
            sessionId ? 'flex' : 'hidden md:flex'
          }`}
        >
          {selectedRoom ? (
            <>
              <div className="md:hidden border-b border-[#EFEFEF] px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => navigate('/chat')}
                  className="text-sm text-[#5F0080] font-medium"
                >
                  ← 대화 목록
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <ChatRoom roomId={selectedRoom.id} />
              </div>
            </>
          ) : sessionId && !loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-[#6F6F6F]">
              채팅방을 찾을 수 없습니다.
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[#6F6F6F]">
              왼쪽에서 대화를 선택하세요.
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
