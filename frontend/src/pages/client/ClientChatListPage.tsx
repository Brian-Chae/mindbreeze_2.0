// 내담자 채팅방 목록 페이지
// 상담사별 채팅방 리스트, 아바타(이니셜), 마지막 메시지 미리보기, 안 읽은 뱃지

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listChatRooms, type ChatRoom } from '../../lib/api/chat';
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

/** 마지막 메시지 미리보기 (50자 제한) */
function lastMessagePreview(room: ChatRoom): string {
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

export default function ClientChatListPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const rooms = useChatStore((s) => s.rooms);
  const setRooms = useChatStore((s) => s.setRooms);
  const hasCounselors = (user?.counselors?.length ?? 0) > 0;

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

  // 상담사 연결 전
  if (!hasCounselors) {
    return (
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
    );
  }

  return (
    <div className="pb-14 px-0 md:px-4">
      {loading ? (
        <div className="p-8 text-center text-sm text-[#6F6F6F]">불러오는 중...</div>
      ) : error ? (
        <div className="p-8 text-center text-sm text-red-500">{error}</div>
      ) : rooms.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] px-6">
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
          {rooms.map((room) => (
            <li key={room.id}>
              <button
                type="button"
                onClick={() => navigate(`/app/chat/${room.id}`)}
                className="w-full text-left flex items-center gap-3 px-4 md:px-6 py-3.5 md:py-4 hover:bg-[#F8F8FB] active:bg-[#F0F0F5] transition-colors"
              >
                {/* 상담사 아바타 (이니셜) */}
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[#EFEFEF] flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-[#5F0080]">
                    {getInitials(room.peer_name || room.name)}
                  </span>
                </div>

                {/* 대화 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-[#1F1F1F] truncate">
                      {room.peer_name || room.name || '채팅방'}
                    </span>
                    {room.last_message?.created_at && (
                      <span className="text-[11px] text-[#9CA0AE] shrink-0">
                        {formatTime(room.last_message.created_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-[#6F6F6F] truncate mt-0.5">
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
          ))}
        </ul>
      )}
    </div>
  );
}
