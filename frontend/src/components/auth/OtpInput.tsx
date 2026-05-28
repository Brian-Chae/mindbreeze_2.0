// 6자리 OTP 입력 컴포넌트

import { useRef, type ChangeEvent, type KeyboardEvent, type ClipboardEvent } from 'react';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  length?: number;
}

export function OtpInput({ value, onChange, disabled = false, error, length = 6 }: OtpInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const updateAt = (idx: number, char: string): void => {
    const next = digits.slice();
    next[idx] = char;
    onChange(next.join('').slice(0, length));
  };

  const handleChange = (idx: number) => (e: ChangeEvent<HTMLInputElement>): void => {
    const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (!raw) {
      updateAt(idx, '');
      return;
    }
    // 한 글자만 받고, 길면 다음 칸으로 분산
    const chars = raw.split('');
    let cursor = idx;
    const next = digits.slice();
    for (const c of chars) {
      if (cursor >= length) break;
      next[cursor] = c;
      cursor += 1;
    }
    onChange(next.join('').slice(0, length));
    const focusIdx = Math.min(cursor, length - 1);
    inputsRef.current[focusIdx]?.focus();
  };

  const handleKeyDown = (idx: number) => (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        updateAt(idx, '');
        return;
      }
      if (idx > 0) {
        inputsRef.current[idx - 1]?.focus();
        updateAt(idx - 1, '');
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < length - 1) {
      inputsRef.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, length);
    if (!pasted) return;
    onChange(pasted.padEnd(0, ''));
    const focusIdx = Math.min(pasted.length, length - 1);
    inputsRef.current[focusIdx]?.focus();
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 justify-center">
        {digits.map((d, idx) => (
          <input
            key={idx}
            ref={(el) => {
              inputsRef.current[idx] = el;
            }}
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            disabled={disabled}
            onChange={handleChange(idx)}
            onKeyDown={handleKeyDown(idx)}
            onPaste={handlePaste}
            className={`w-12 h-14 text-center text-2xl font-semibold rounded-lg border bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50 ${
              error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]'
            }`}
            aria-label={`OTP 자리 ${idx + 1}`}
          />
        ))}
      </div>
      {error && <p className="text-sm text-[var(--color-danger)] text-center">{error}</p>}
    </div>
  );
}
