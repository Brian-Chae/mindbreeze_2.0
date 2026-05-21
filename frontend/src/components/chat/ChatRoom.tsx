// 채팅방 — 진단: MessageBubble import만 테스트
import { useEffect, useState } from 'react';
import { listChatMessages } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { SystemMessage } from './SystemMessage';

interface Props {
  roomId: string;
}

export function ChatRoom({ roomId }: Props) {
  const messages = useChatStore((s) => s.messagesByRoom[roomId] ?? []);
  const setMessages = useChatStore((s) => s.setMessages);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listChatMessages(roomId)
      .then((res) => {
        if (!cancelled) {
          setMessages(roomId, res.messages);
          setCount(res.messages.length);
          setLoading(false);
        }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [roomId, setMessages]);

  // MessageBubble/SystemMessage import만 하고 사용하지 않음
  void MessageBubble;
  void SystemMessage;
  void (messages as unknown);

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-white items-center justify-center p-6">
      <p className="text-sm font-bold text-[#5F0080]">채팅방 연결됨 (import 진단)</p>
      <p className="text-xs text-[#6F6F6F] mt-1">Room: {roomId.slice(0, 12)}…</p>
      {loading ? (
        <p className="text-xs text-[#9CA0AE] mt-2">로딩 중…</p>
      ) : (
        <p className="text-xs text-[#1F8A5B] mt-2">메시지 {count}건 로드 완료</p>
      )}
    </div>
  );
}
