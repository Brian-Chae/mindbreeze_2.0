// 6자리 숫자 OTP 입력 컴포넌트
// 서버 OTP는 숫자 6자리(backend otp_service: secrets.randbelow → 06d)이므로 숫자 키패드를 쓴다.
// 칸마다 input을 두면 포커스 이동 때 iOS 키패드가 문자로 바뀌고 SMS/메일 자동완성도 안 되므로
// 단일 input 하나로 입력받는다(포커스 이동 없음 → 키패드 유지).

import { type ChangeEvent, type ClipboardEvent } from 'react';
import { sanitizeOtp } from '../../lib/sanitize-otp';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  length?: number;
}

export function OtpInput({ value, onChange, disabled = false, error, length = 6 }: OtpInputProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    onChange(sanitizeOtp(e.target.value, length));
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    e.preventDefault();
    const pasted = sanitizeOtp(e.clipboardData.getData('text'), length);
    if (pasted) onChange(pasted);
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onPaste={handlePaste}
        placeholder={'0'.repeat(length)}
        className={`block mx-auto w-full max-w-[16rem] h-14 text-center text-2xl font-semibold tracking-[0.5em] rounded-lg border bg-[var(--mb-bg)] text-[var(--mb-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--mb-primary)] disabled:opacity-50 ${
          error ? 'border-[var(--mb-danger)]' : 'border-[var(--mb-border)]'
        }`}
        aria-label={`인증 코드 ${length}자리`}
      />
      {error && <p className="text-sm text-[var(--mb-danger)] text-center">{error}</p>}
    </div>
  );
}
