// 메시지 말풍선 — 카톡 스타일: 상대방 메시지에 이름+아바타, 시간 말풍선 옆
import type { ChatMessage } from '../../lib/api/chat';

interface Props {
  message: ChatMessage;
  isMine: boolean;
  /** 상대방 이름 (showSender=true 일 때만 표시) */
  senderName?: string;
  /** 상대방 메시지 첫 번째일 때 이름+아바타 표시 */
  showSender?: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hour = parseInt(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }), 10);
  const mm = d.toLocaleString('en-US', { timeZone: 'Asia/Seoul', minute: '2-digit' });
  const hour12 = hour % 12 || 12;
  const ampm = hour < 12 ? '오전' : '오후';
  return `${ampm} ${hour12}:${mm}`;
}

/** 이름에서 이니셜 추출 (첫 글자) */
function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** read_by + recipient_count로 안읽은 사람 수 계산 (백엔드 unread_count 폴백) */
function calcUnreadCount(msg: ChatMessage): number {
  // 백엔드에서 unread_count를 명시적으로 보내줬으면 우선 사용
  if (msg.unread_count != null) return msg.unread_count;
  // read_by + recipient_count로 클라이언트 계산
  if (msg.read_by != null && msg.recipient_count != null && msg.recipient_count > 0) {
    return Math.max(0, msg.recipient_count - msg.read_by.length);
  }
  return 0;
}

export function MessageBubble({ message, isMine, senderName, showSender }: Props) {
  if (!message) return null;

  const content = message.content ?? '(내용 없음)';
  const createdAt = message.created_at ?? new Date().toISOString();
  const timeStr = formatTime(createdAt);
  const unread = calcUnreadCount(message);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isMine ? 'flex-end' : 'flex-start',
        alignItems: 'flex-end',
        gap: '4px',
        margin: '6px 0',
      }}
    >
      {/* 내 메시지: 안읽은 사람 수 + 시간 왼쪽 */}
      {isMine && (
        <>
          {unread > 0 && (
            <span style={{ fontSize: '11px', color: '#F5B041', flexShrink: 0, marginBottom: '6px', fontWeight: 500 }}>
              {unread}
            </span>
          )}
          <span style={{ fontSize: '10px', color: '#9CA0AE', flexShrink: 0, marginBottom: '6px' }}>
            {timeStr}
          </span>
        </>
      )}
      {/* 상대 메시지: 아바타 영역 */}
      {!isMine && (
        <div style={{ width: '32px', flexShrink: 0, alignSelf: showSender ? 'flex-start' : 'flex-end', marginBottom: '2px' }}>
          {showSender ? (
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: '#E8E0F0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
                color: '#5F0080',
              }}
            >
              {senderName ? getInitial(senderName) : '?'}
            </div>
          ) : null}
        </div>
      )}
      <div style={{ maxWidth: '70%' }}>
        {/* 상대방 이름 (첫 메시지만) */}
        {!isMine && showSender && senderName && (
          <div style={{ fontSize: '11px', color: '#6F6F6F', marginBottom: '3px', marginLeft: '2px' }}>
            {senderName}
          </div>
        )}
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
      </div>
      {/* 상대 메시지: 시간 오른쪽 */}
      {!isMine && (
        <span style={{ fontSize: '10px', color: '#9CA0AE', flexShrink: 0, marginBottom: '4px' }}>
          {timeStr}
        </span>
      )}
    </div>
  );
}
