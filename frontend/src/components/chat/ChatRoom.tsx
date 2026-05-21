// 채팅방 컴포넌트 — 진단용 최소 버전
import { useEffect, useState } from 'react';
import { listChatMessages } from '../../lib/api/chat';
import { useChatStore } from '../../stores/chatStore';

interface Props {
  roomId: string;
}

export function ChatRoom({ roomId }: Props) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [msgCount, setMsgCount] = useState(0);
  const setMessages = useChatStore((s) => s.setMessages);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    listChatMessages(roomId)
      .then((res) => {
        if (!cancelled) {
          setMessages(roomId, res.messages);
          setMsgCount(res.messages.length);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : '로딩 실패');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [roomId, setMessages]);

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-white items-center justify-center p-6">
      <p className="text-sm font-bold text-[#5F0080]">채팅방 연결됨</p>
      <p className="text-xs text-[#6F6F6F] mt-1">Room: {roomId.slice(0, 12)}…</p>
      {loading && <p className="text-xs text-[#9CA0AE] mt-2">메시지 로딩 중…</p>}
      {errorMsg && <p className="text-xs text-[#B3261E] mt-2">{errorMsg}</p>}
      {!loading && !errorMsg && (
        <p className="text-xs text-[#1F8A5B] mt-2">메시지 {msgCount}건 로드 완료</p>
      )}
    </div>
  );
}
