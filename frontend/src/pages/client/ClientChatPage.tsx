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
import { ChatSortToggle } from '../../components/chat/ChatSortToggle';
import { RoomActionsMenu } from '../../components/chat/RoomActionsMenu';
import { RoomSettingsModal } from '../../components/chat/RoomSettingsModal';
import { useChatSortPreference } from '../../hooks/useChatSortPreference';
import { sortRooms, chatRoomDisplayName, lastMessagePreview, formatChatTime } from '../../lib/chat-sort';

/** 상담사 이름에서 이니셜 추출 (최대 2글자) */
function getInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** 세션 일자 포맷 (M월 D일 (요일) HH:mm) */
function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return '세션 채팅';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '세션 채팅';
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${day}) ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 방 부제목 */
function roomDisplaySub(room: ChatRoomDto): string {
  if (room.room_type === 'direct') return '1:1 대화';
  if (room.room_type === 'group') return '그룹 대화';
  return formatSessionDate(room.session_scheduled_at);
}

export default function ClientChatPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const rooms = useChatStore((s) => s.rooms);
  const setRooms = useChatStore((s) => s.setRooms);
  const sortPreference = useChatSortPreference();
  const sortedRooms = useMemo(() => sortRooms(rooms, sortPreference.unreadFirst), [rooms, sortPreference.unreadFirst]);
  const [settingsRoom, setSettingsRoom] = useState<ChatRoomDto | null>(null);
  const [status, setStatus] = useState('');
  const hasCounselors = (user?.counselors?.length ?? 0) > 0;

  // /app/chat/:roomId 에서 roomId 추출 (Route가 /app/* 이므로 useParams 사용 불가)
  const paramRoomId = useMemo(() => {
    const match = location.pathname.match(/^\/app\/chat\/([^/]+)$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(''), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    let requestId = 0;
    const refreshRooms = () => {
      const currentRequest = ++requestId;
      const snapshot = useChatStore.getState().rooms;
      void listChatRooms()
      .then((res) => {
        if (cancelled || currentRequest !== requestId) return;
        setError(null);
        setRooms(res.rooms, snapshot);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || currentRequest !== requestId) return;
        setError(err instanceof Error ? err.message : '채팅방 목록을 불러올 수 없습니다');
        setLoading(false);
      });
    };
    refreshRooms();
    window.addEventListener('focus', refreshRooms);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshRooms);
    };
  }, [setRooms]);

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
    return chatRoomDisplayName(selectedRoom);
  }, [selectedRoom]);

  const headerSub = useMemo(() => {
    if (!selectedRoom) return 'MESSAGES';
    return roomDisplaySub(selectedRoom);
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
            <ChatSortToggle {...sortPreference} />
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
                {sortedRooms.map((room) => {
                  const isActive = room.id === paramRoomId;
                  return (
                    <li key={room.id} className={`flex items-center ${isActive ? 'bg-[#F5EDFC]' : ''}`}>
                      <button
                        type="button"
                        onClick={() => handleSelect(room)}
                        className={`min-w-0 flex-1 text-left flex items-center gap-3 px-4 md:px-5 py-3.5 md:py-4 transition-colors ${
                          isActive ? 'bg-[#F5EDFC]' : 'hover:bg-[#F8F8FB] active:bg-[#F0F0F5]'
                        }`}
                      >
                        {/* 상담사 아바타 (이니셜) */}
                        <div className="w-11 h-11 rounded-full bg-[#EFEFEF] flex items-center justify-center shrink-0 ring-2 ring-[#5F0080]/20">
                          <span className="text-sm font-bold text-[#5F0080]">
                            {room.room_type === 'direct' ? getInitials(room.peer_name) : '#'}
                          </span>
                        </div>

                        {/* 대화 정보 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[14px] font-semibold text-[#1F1F1F] truncate">
                              {chatRoomDisplayName(room)}
                            </span>
                            {(room.last_message_at ?? room.last_message?.created_at ?? room.created_at) && (
                              <span className="text-[11px] text-[#9CA0AE] shrink-0">
                                {formatChatTime(room.last_message_at ?? room.last_message?.created_at ?? room.created_at)}
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] text-[#6F6F6F] truncate mt-0.5">
                            {lastMessagePreview(room, roomDisplaySub(room))}
                          </p>
                        </div>

                        {/* 안 읽은 뱃지 */}
                        {(room.unread_count ?? 0) > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#5F0080] text-white text-[11px] font-bold inline-flex items-center justify-center shrink-0">
                            {room.unread_count > 99 ? '99+' : room.unread_count}
                          </span>
                        )}
                      </button>
                      <RoomActionsMenu room={room} onSettings={() => setSettingsRoom(room)} />
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
      {status && <p role="status" className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#5F0080] px-4 py-3 text-sm text-white">{status}</p>}
      {settingsRoom && <RoomSettingsModal key={settingsRoom.id} room={settingsRoom} onClose={() => setSettingsRoom(null)} onSaved={setStatus} />}
    </ClientShell>
  );
}
