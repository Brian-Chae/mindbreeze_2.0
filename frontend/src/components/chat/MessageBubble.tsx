// 메시지 말풍선 — 내/상대 구분
import type { ChatMessage } from '../../lib/api/chat';

interface Props {
  message: ChatMessage;
  isMine: boolean;
}

export function MessageBubble({ message, isMine }: Props) {
  // 방어적 처리
  if (!message) return null;

  const content = message.content ?? '(내용 없음)';
  const createdAt = message.created_at ?? new Date().toISOString();
  const timeStr = createdAt.slice(11, 16); // HH:MM 추출

  return (
    <div style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', margin: '4px 0' }}>
      <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '8px 14px',
          borderRadius: '16px',
          fontSize: '14px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: isMine ? '#5F0080' : '#F5EDFC',
          color: isMine ? '#fff' : '#1F1F1F',
        }}>
          {content}
        </div>
        <span style={{
          fontSize: '10px',
          color: '#9CA0AE',
          marginTop: '2px',
          textAlign: isMine ? 'right' : 'left',
        }}>
          {timeStr}
        </span>
      </div>
    </div>
  );
}
