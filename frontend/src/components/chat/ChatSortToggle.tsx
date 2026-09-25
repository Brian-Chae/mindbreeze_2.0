import type { ChatSortMode } from '../../lib/chat-sort';

interface Props {
  mode: ChatSortMode;
  unreadFirst: boolean;
  onModeChange: (mode: ChatSortMode) => void;
  onUnreadFirstChange: (value: boolean) => void;
}

export function ChatSortToggle({ mode, unreadFirst, onModeChange, onUnreadFirstChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#EFEFEF] px-4 py-3 shrink-0">
      <div role="radiogroup" aria-label="채팅방 정렬" className="flex rounded-lg bg-[#F8F8FB] p-0.5">
        {(['recent_message', 'recent_session'] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value}
            tabIndex={mode === value ? 0 : -1}
            onClick={() => onModeChange(value)}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 'recent_message' : event.key === 'End' ? 'recent_session' : value === 'recent_message' ? 'recent_session' : 'recent_message';
                onModeChange(next);
                const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                buttons?.[next === 'recent_message' ? 0 : 1].focus();
              }
            }}
            className={`rounded-md px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5F0080] ${mode === value ? 'bg-[#5F0080] text-white' : 'text-[#6F6F6F] hover:bg-[#F5EDFC]'}`}>
            {value === 'recent_message' ? '대화순' : '세션순'}
          </button>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[#6F6F6F]">
        <input type="checkbox" checked={unreadFirst} onChange={(event) => onUnreadFirstChange(event.target.checked)} className="h-4 w-4 accent-[#5F0080]" />
        안읽음 우선
      </label>
    </div>
  );
}
