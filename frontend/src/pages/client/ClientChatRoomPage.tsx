// 내담자 채팅방 페이지 (단일 채팅방)
// Portal overlay 제거 — ClientShell 내부에서 h-full로 정상 배치
// 통합 채팅 페이지(ClientChatPage) 사용을 권장합니다

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getChatRoom, type ChatRoom as ChatRoomDto } from '../../lib/api/chat';
import { ChatRoom } from '../../components/chat/ChatRoom';

interface ClientChatRoomPageProps {
  roomId?: string;
}

export default function ClientChatRoomPage({ roomId: propRoomId }: ClientChatRoomPageProps) {
  const params = useParams<{ roomId: string }>();
  const roomId = propRoomId || params.roomId;
  const navigate = useNavigate();
  const [room, setRoom] = useState<ChatRoomDto | null>(null);

  useEffect(() => {
    if (!roomId) return;
    getChatRoom(roomId)
      .then(setRoom)
      .catch(() => setRoom(null));
  }, [roomId]);

  const handleBack = (): void => {
    navigate('/app/chat');
  };

  if (!roomId) return null;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 상단 헤더 */}
      <header className="h-14 flex items-center px-4 gap-3 border-b border-[#EFEFEF] bg-white shrink-0 max-w-3xl mx-auto w-full">
        <div className="md:hidden">
          <button
            type="button"
            onClick={handleBack}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#EFEFEF] shrink-0 transition-colors"
            aria-label="뒤로가기"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12l4.58-4.59Z"
                fill="#1F1F1F"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-[#1F1F1F] truncate">
            {room?.peer_name || room?.name || '채팅방'}
          </h1>
        </div>
      </header>

      {/* 채팅 영역 */}
      <div className="flex-1 min-h-0">
        <ChatRoom roomId={roomId} peerName={room?.peer_name ?? undefined} />
      </div>
    </div>
  );
}
