// 루시(AI) 대화 말풍선 — 일반 채팅방(MessageBubble)과 동일한 카톡 스타일.
// 상대(루시) 메시지: 아바타 + 이름 + 말풍선 옆 시간, 내 메시지: 보라 말풍선 + 왼쪽 시간.
import { useEffect, useRef, type ReactNode } from 'react';
import { ChatTextarea } from './ChatTextarea';

interface Props {
  isMine: boolean;
  /** 상대 이름 (연속 메시지의 첫 번째에서만 표시) */
  senderName?: string;
  showSender?: boolean;
  content: string;
  createdAt: string;
  /** 말풍선 안 하단에 붙는 버튼(CTA) 영역 */
  actions?: ReactNode;
  /** 말풍선 위 작은 라벨 (예: 아침 브리핑, 위험 알림) */
  label?: string;
  /** 강조 말풍선 (위험 알림) */
  emphasis?: boolean;
  /** 발신자가 바뀐 첫 말풍선 — 위쪽 간격을 넓혀 대화 묶음을 구분한다. */
  groupStart?: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hour = parseInt(d.toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }), 10);
  const mm = d.toLocaleString('en-US', { timeZone: 'Asia/Seoul', minute: '2-digit' });
  return `${hour < 12 ? '오전' : '오후'} ${hour % 12 || 12}:${mm}`;
}

export function AgentBubble({ isMine, senderName = '루시 (AI)', showSender = true, content, createdAt, actions, label, emphasis, groupStart = false }: Props) {
  const time = formatTime(createdAt);
  return (
    <article style={{ display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '6px', margin: groupStart ? '18px 0 3px' : '3px 0' }}>
      {isMine && <span style={{ fontSize: '12px', color: '#6F6F6F', flexShrink: 0, marginBottom: '6px' }}>{time}</span>}
      {!isMine && (
        <div style={{ width: '32px', flexShrink: 0, alignSelf: showSender ? 'flex-start' : 'flex-end', marginBottom: '2px' }}>
          {showSender && (
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5F0080', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#fff' }}>
              루시
            </div>
          )}
        </div>
      )}
      <div style={{ maxWidth: '80%' }}>
        {!isMine && showSender && (
          <div style={{ fontSize: '13px', color: '#6F6F6F', marginBottom: '3px', marginLeft: '2px' }}>{senderName}</div>
        )}
        <div className={emphasis ? 'border-amber-300' : undefined} style={{
          padding: '8px 14px', borderRadius: '16px', fontSize: '15px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          background: isMine ? '#5F0080' : emphasis ? '#FFF4D6' : '#F5EDFC',
          color: isMine ? '#fff' : '#1F1F1F',
          border: emphasis ? '1px solid #F5B041' : undefined,
        }}>
          {label && <div style={{ fontSize: '12px', fontWeight: 600, color: isMine ? '#fff' : '#5F0080', marginBottom: '4px' }}>{label}</div>}
          {content}
          {actions}
        </div>
      </div>
      {!isMine && <span style={{ fontSize: '12px', color: '#6F6F6F', flexShrink: 0, marginBottom: '4px' }}>{time}</span>}
    </article>
  );
}

/** 일반 채팅방과 같은 하단 입력줄 */
export function AgentInputBar({ value, onChange, onSubmit, disabled, placeholder, ariaLabel, busy }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; disabled?: boolean; placeholder: string; ariaLabel: string; busy?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 첫 진입 시 iOS Safari 가 이전 포커스 상태를 복원해 키보드가 자동으로 올라와
  // 입력창이 위로 밀리는 현상을 막는다.
  useEffect(() => {
    inputRef.current?.blur();
  }, []);
  return (
    <form
      className="border-t border-[#EFEFEF] p-3 bg-white shrink-0"
      onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
    >
      <div className="mx-auto flex w-full max-w-[760px] items-end gap-2">
      <ChatTextarea
        textareaRef={inputRef}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        maxLength={1000}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onSend={() => { if (!disabled && value.trim()) onSubmit(); }}
      />
      <button type="submit" disabled={disabled || !value.trim()} className="mb-btn shrink-0 disabled:opacity-50">
        {busy ? <span className="inline-flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />답변 중</span> : '전송'}
      </button>
      </div>
    </form>
  );
}

/** 루시가 답변을 입력 중이라는 표시 — 아바타 + 점 3개 말풍선. */
export function AgentTypingIndicator() {
  const dot = (delay: string) => (
    <span className="h-1.5 w-1.5 rounded-full bg-[#5F0080] animate-bounce" style={{ animationDelay: delay }} />
  );
  return (
    <article style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', margin: '18px 0 3px' }}>
      <div style={{ width: '32px', flexShrink: 0, alignSelf: 'flex-start', marginBottom: '2px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5F0080', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#fff' }}>
          루시
        </div>
      </div>
      <div style={{ padding: '12px 14px', borderRadius: '16px', background: '#F5EDFC', display: 'flex', gap: '5px', alignItems: 'center' }}>
        {dot('0ms')}{dot('150ms')}{dot('300ms')}
      </div>
    </article>
  );
}
