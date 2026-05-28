// 내담자 채팅 페이지 — 상담사 ChatPage와 동일 구조
// ClientShell + 좌측 대화 목록 + 우측 채팅 영역
// /app/chat 또는 /app/chat/:roomId

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ClientShell from '../../components/client/ClientShell';
import { ChatRoom } from '../../components/chat/ChatRoom';
import { listChatRooms, type ChatRoom as ChatRoomDto } from '../../lib/api/chat';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';

/** 상담사 이름에서 이니셜 추출 (최대 2글자) */
function getInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** 마지막 메시지 미리보기 (40자 제한) */
function lastMessagePreview(room: ChatRoomDto): string {
  const content = room.last_message?.content;
  if (!content) {
    if (room.room_type === 'direct') return '1:1 대화';
    if (room.room_type === 'group') return '그룹 대화';
    return '세션 채팅';
  }
  return content.length > 40 ? content.slice(0, 40) + '...' : content;
}

/** HH:mm 형식 */
function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

export default function ClientChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const rooms = useChatStore((s) => s.rooms);
  const setRooms = useChatStore((s) => s.setRooms);
  const hasCounselors = (user?.counselors?.length ?? 0) > 0;

  // /app/chat/:roomId 에서 roomId 추출 (Route가 /app/* 이므로 useParams 사용 불가)
  const paramRoomId = useMemo(() => {
    const match = location.pathname.match(/^\/app\/chat\/([^/]+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError(err instanceof Error ? err.message : '채팅방 목록을 불러올 수 없습니다');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRoom: ChatRoomDto | null = useMemo(() => {
    if (!paramRoomId) return null;
    return (
      rooms.find((r) => r.id === paramRoomId) ??
      rooms.find((r) => r.session_id === paramRoomId) ??
      null
    );
  }, [rooms, paramRoomId]);

  const handleSelect = (room: ChatRoomDto): void => {
    navigate(`/app/chat/${room.id}`);
  };

  const headerTitle = useMemo(() => {
    if (!selectedRoom) return '채팅';
    return selectedRoom.peer_name || selectedRoom.name || '채팅방';
  }, [selectedRoom]);

  const headerSub = useMemo(() => {
    if (!selectedRoom) return 'MESSAGES';
    if (selectedRoom.room_type === 'direct') return '1:1 대화';
    if (selectedRoom.room_type === 'group') return '그룹 대화';
    return '세션 채팅';
  }, [selectedRoom]);

  return (
    <ClientShell title={headerTitle} sub={headerSub} contentPad="" noScroll hideBottomTab noBottomPad>
      {/* 상담사 연결 전 안내 */}
      {!hasCounselors ? (
        <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] px-6">
          <div className="w-16 h-16 rounded-full bg-[#EFEFEF] flex items-center justify-center mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z"
                fill="#6F6F6F"
              />
            </svg>
          </div>
          <p className="text-[#6F6F6F] text-sm text-center">
            상담사와 연결 후 채팅이 가능합니다
          </p>
          <p className="text-[#9CA0AE] text-xs mt-1 text-center">
            상담사에게 받은 코드를 입력하여 연결을 시작하세요
          </p>
        </div>
      ) : (
        <div className="h-full flex flex-col md:flex-row">
          {/* 좌측 대화 목록 */}
          <aside
            className={`md:w-80 shrink-0 border-r border-[#EFEFEF] bg-white overflow-y-auto flex flex-col ${
              paramRoomId ? 'hidden md:flex' : 'flex'
            }`}
          >
            {loading ? (
              <div className="p-6 text-center text-sm text-[#6F6F6F]">불러오는 중...</div>
            ) : error ? (
              <div className="p-6 text-center text-sm text-red-500">{error}</div>
            ) : rooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 min-h-[40vh] px-6">
                <div className="w-16 h-16 rounded-full bg-[#EFEFEF] flex items-center justify-center mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z"
                      fill="#6F6F6F"
                    />
                  </svg>
                </div>
                <p className="text-[#6F6F6F] text-sm">아직 대화가 없어요</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#EFEFEF]">
                {rooms.map((room) => {
                  const isActive = room.id === paramRoomId;
                  return (
                    <li key={room.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(room)}
                        className={`w-full text-left flex items-center gap-3 px-4 md:px-5 py-3.5 md:py-4 transition-colors ${
                          isActive ? 'bg-[#F5EDFC]' : 'hover:bg-[#F8F8FB] active:bg-[#F0F0F5]'
                        }`}
                      >
                        {/* 상담사 아바타 (이니셜) */}
                        <div className="w-11 h-11 rounded-full bg-[#EFEFEF] flex items-center justify-center shrink-0 ring-2 ring-[#5F0080]/20">
                          <span className="text-sm font-bold text-[#5F0080]">
                            {getInitials(room.peer_name || room.name)}
                          </span>
                        </div>

                        {/* 대화 정보 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[14px] font-semibold text-[#1F1F1F] truncate">
                              {room.peer_name || room.name || '채팅방'}
                            </span>
                            {room.last_message?.created_at && (
                              <span className="text-[11px] text-[#9CA0AE] shrink-0">
                                {formatTime(room.last_message.created_at)}
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] text-[#6F6F6F] truncate mt-0.5">
                            {lastMessagePreview(room)}
                          </p>
                        </div>

                        {/* 안 읽은 뱃지 */}
                        {(room.unread_count ?? 0) > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#5F0080] text-white text-[11px] font-bold inline-flex items-center justify-center shrink-0">
                            {room.unread_count > 99 ? '99+' : room.unread_count}
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
            className={`flex-1 min-h-0 flex flex-col bg-white ${
              paramRoomId ? 'flex' : 'hidden md:flex'
            }`}
          >
            {selectedRoom ? (
              <>
                <div className="md:hidden border-b border-[#EFEFEF] px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => navigate('/app/chat')}
                    className="text-sm text-[#5F0080] font-medium"
                  >
                    ← 대화 목록
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <ChatRoom roomId={selectedRoom.id} peerName={selectedRoom.peer_name ?? undefined} />
                </div>
              </>
            ) : paramRoomId && !loading ? (
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
      )}
    </ClientShell>
  );
}
