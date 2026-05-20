// 채팅 페이지 — /chat/:sessionId 경로. 세션의 채팅방을 찾아 ChatRoom 렌더링.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { listChatRooms, type ChatRoom as ChatRoomDto } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { ChatRoom } from '../../components/chat/ChatRoom';

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const setRooms = useChatStore((s) => s.setRooms);
  const [room, setRoom] = useState<ChatRoomDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listChatRooms()
      .then((res) => {
        if (cancelled) return;
        setRooms(res.rooms);
        const target = res.rooms.find((r) => r.session_id === sessionId);
        if (!target) {
          setError('채팅방을 찾을 수 없습니다');
        } else {
          setRoom(target);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '로딩 실패');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, setRooms]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <Link
          to={sessionId ? `/sessions/${sessionId}` : '/sessions'}
          className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
        >
          ← 세션으로
        </Link>
        <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">채팅</h1>
        <div className="w-16" />
      </header>
      <main className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            불러오는 중…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-500">{error}</div>
        ) : room ? (
          <ChatRoom roomId={room.id} />
        ) : null}
      </main>
    </div>
  );
}
