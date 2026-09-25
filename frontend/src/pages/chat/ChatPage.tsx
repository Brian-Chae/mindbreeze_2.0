// 채팅 페이지 — 좌측 대화 목록 + 우측 채팅 영역. /chat 또는 /chat/:roomId

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/layout/AppShell';
import { ChatRoom } from '../../components/chat/ChatRoom';
import { CreateRoomModal } from '../../components/chat/CreateRoomModal';
import { listChatRooms, type ChatRoom as ChatRoomDto } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { ChatSortToggle } from '../../components/chat/ChatSortToggle';
import { RoomActionsMenu } from '../../components/chat/RoomActionsMenu';
import { RoomSettingsModal } from '../../components/chat/RoomSettingsModal';
import { useChatSortPreference } from '../../hooks/useChatSortPreference';
import { sortRooms, chatRoomDisplayName, lastMessagePreview, formatChatTime } from '../../lib/chat-sort';

function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return '세션 채팅';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '세션 채팅';
  const day = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${day}) ${hh}:${mm}`;
}

function roomLabel(room: ChatRoomDto): string {
  const count = room.participant_count ?? 0;
  const countStr = count > 0 ? ` (${count}명)` : '';

  return `${chatRoomDisplayName(room)}${countStr}`;
}

function roomSub(room: ChatRoomDto): string {
  if (room.room_type === 'direct') return '1:1 대화';
  if (room.room_type === 'group') return '그룹 대화';
  return formatSessionDate(room.session_scheduled_at);
}

export default function ChatPage() {
  const { roomId: paramRoomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const rooms = useChatStore((s) => s.rooms);
  const setRooms = useChatStore((s) => s.setRooms);
  const sortPreference = useChatSortPreference();
  const sortedRooms = useMemo(() => sortRooms(rooms, sortPreference.mode, sortPreference.unreadFirst), [rooms, sortPreference.mode, sortPreference.unreadFirst]);
  const [settingsRoom, setSettingsRoom] = useState<ChatRoomDto | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

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
      void listChatRooms()
      .then((res) => {
        if (cancelled || currentRequest !== requestId) return;
        setError(null);
        setRooms(res.rooms);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || currentRequest !== requestId) return;
        setError(err instanceof Error ? err.message : '로딩 실패');
        setLoading(false);
      });
    };
    refreshRooms();
    window.addEventListener('focus', refreshRooms);
    return () => { cancelled = true; window.removeEventListener('focus', refreshRooms); };
  }, [setRooms]);

  const selectedRoom: ChatRoomDto | null = useMemo(() => {
    if (!paramRoomId) return null;
    // room.id 또는 session_id로 검색 (하위 호환)
    return (
      rooms.find((r) => r.id === paramRoomId) ??
      rooms.find((r) => r.session_id === paramRoomId) ??
      null
    );
  }, [rooms, paramRoomId]);

  const handleSelect = (room: ChatRoomDto): void => {
    navigate(`/chat/${room.id}`);
  };

  const headerTitle = useMemo(() => {
    if (!selectedRoom) return '채팅';
    return roomLabel(selectedRoom);
  }, [selectedRoom]);

  const headerSub = useMemo(() => {
    if (!selectedRoom) return 'MESSAGES';
    return roomSub(selectedRoom);
  }, [selectedRoom]);

  return (
    <AppShell title={headerTitle} sub={headerSub} contentPad="" noScroll hideBottomTab={!!paramRoomId} noBottomPad={!!paramRoomId}>
      <div className="h-full flex flex-col md:flex-row">
        {/* 좌측 대화 목록 */}
        <aside
          className={`md:w-80 shrink-0 border-r border-[#EFEFEF] bg-white overflow-y-auto flex flex-col ${
            paramRoomId ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* 헤더: 새 채팅방 버튼 */}
          <div className="shrink-0 px-5 py-3 border-b border-[#EFEFEF]">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="w-full h-10 rounded-xl bg-[#5F0080] text-white font-semibold text-sm hover:bg-[#4B0066] transition-colors"
            >
              + 새 채팅방
            </button>
          </div>

          <ChatSortToggle {...sortPreference} />
          {loading ? (
            <div className="p-6 text-center text-sm text-[#6F6F6F]">불러오는 중…</div>
          ) : error ? (
            <div className="p-6 text-center text-sm text-red-500">{error}</div>
          ) : rooms.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#6F6F6F]">
              아직 채팅방이 없습니다.<br />
              <span className="text-[#5F0080]">+ 새 채팅방</span> 버튼으로 시작하세요.
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
                        className={`min-w-0 flex-1 text-left flex items-center gap-3 px-5 py-4 transition-colors ${isActive ? 'bg-[#F5EDFC]' : 'hover:bg-[#F8F8FB]'}`}
                    >
                      <div className="w-11 h-11 rounded-full bg-[#F5EDFC] ring-2 ring-[#5F0080]/20 flex items-center justify-center text-[#5F0080] font-bold shrink-0">
                        {room.room_type === 'direct' ? '1:1' : '#'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[14px] text-[#1F1F1F] truncate">
                            {roomLabel(room)}
                          </span>
                          <span className="text-[11px] text-[#6F6F6F] font-mono shrink-0">
                            {formatChatTime(room.last_message_at ?? room.last_message?.created_at ?? room.created_at)}
                          </span>
                        </div>
                        <p className="text-[12px] text-[#6F6F6F] truncate mt-0.5">
                          {lastMessagePreview(room, roomSub(room))}
                        </p>
                      </div>
                      {room.unread_count > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#5F0080] text-white text-[11px] font-bold inline-flex items-center justify-center font-mono shrink-0">
                          {room.unread_count}
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
                  onClick={() => navigate('/chat')}
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

      {status && <p role="status" className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#5F0080] px-4 py-3 text-sm text-white">{status}</p>}
      {settingsRoom && <RoomSettingsModal key={settingsRoom.id} room={settingsRoom} onClose={() => setSettingsRoom(null)} onSaved={setStatus} />}
      <CreateRoomModal open={showCreate} onClose={() => setShowCreate(false)} />
    </AppShell>
  );
}
