// 채팅 입력창 — 줄이 넘어가면 높이가 자라 입력 전체가 한눈에 보인다(SDD-204).
// Enter=전송, Shift+Enter=줄바꿈, 한글 조합 중 Enter 는 무시한다.
import { useLayoutEffect, useRef, type Ref } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  ariaLabel?: string;
  disabled?: boolean;
  maxLength?: number;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

/** 최대 높이 — 화면의 40% 와 240px 중 작은 값. 넘치면 내부 스크롤. */
const MAX_HEIGHT = 'min(40vh, 240px)';

export function ChatTextarea({ value, onChange, onSend, placeholder, ariaLabel, disabled, maxLength, textareaRef }: Props) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  // 내용이 바뀔 때마다 높이를 내용에 맞춘다(비우면 한 줄로 복귀).
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const setRefs = (el: HTMLTextAreaElement | null): void => {
    innerRef.current = el;
    if (typeof textareaRef === 'function') textareaRef(el);
    else if (textareaRef) (textareaRef as { current: HTMLTextAreaElement | null }).current = el;
  };

  return (
    <textarea
      ref={setRefs}
      rows={1}
      name="chat-message"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      enterKeyHint="send"
      data-form-type="other"
      data-lpignore="true"
      data-1p-ignore
      aria-label={ariaLabel}
      placeholder={placeholder}
      maxLength={maxLength}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSend();
        }
      }}
      style={{ maxHeight: MAX_HEIGHT }}
      className="flex-1 min-w-0 min-h-11 mobile:min-h-12 resize-none overflow-y-auto px-4 py-[9px] mobile:py-2.5 leading-6 rounded-xl border border-[#DDDEE7] bg-white text-base mobile:text-mb-body text-[#1F1F1F] placeholder:text-[#9CA0AE] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-purple-900/15 transition"
    />
  );
}
