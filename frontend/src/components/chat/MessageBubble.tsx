// 메시지 말풍선 — 내/상대 구분

import type { ChatMessage } from '../../lib/api/chat';

interface Props {
  message: ChatMessage;
  isMine: boolean;
}

export function MessageBubble({ message, isMine }: Props) {
  const time = new Date(message.created_at).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} my-1`}>
      <div className="flex flex-col max-w-[70%]">
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
            isMine
              ? 'bg-[#5F0080] text-white rounded-br-sm'
              : 'bg-[#F5EDFC] text-[#1F1F1F] rounded-bl-sm'
          }`}
        >
          {message.content}
        </div>
        <span
          className={`text-[10px] text-[#9CA0AE] mt-1 font-mono ${
            isMine ? 'text-right' : 'text-left'
          }`}
        >
          {time}
        </span>
      </div>
    </div>
  );
}
