// 생년월일 숫자 직접 입력 — YYYY.MM.DD 표시, 서버 값은 YYYY-MM-DD.
// 달력(type=date)은 모바일에서 연도 이동이 어려워 숫자 키패드 입력으로 통일한다.

import { useEffect, useId, useState } from 'react';
import { BIRTH_DATE_MESSAGES } from '../../lib/auth/age';
import {
  checkBirthInput,
  extractBirthDigits,
  formatBirthDigits,
  fromIsoBirthDate,
  toIsoBirthDate,
  type BirthAgeRule,
} from '../../lib/auth/birth-date';

export interface BirthDateInputProps {
  /** 서버 형식 YYYY-MM-DD(미완성이면 빈 문자열) */
  value: string;
  /** 완성되면 YYYY-MM-DD, 미완성이면 빈 문자열. 두 번째 인자는 검증 결과 */
  onChange: (iso: string, state: ReturnType<typeof checkBirthInput>) => void;
  /** signup=만 14세 이상 규칙 포함, none=실제 날짜·미래 금지만(프로필 수정) */
  ageRule?: BirthAgeRule;
  label?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  /** 입력칸 스타일 덮어쓰기 */
  inputClassName?: string;
  labelClassName?: string;
  /** 바깥에서 지정한 오류 문구(서버 응답 등) */
  externalError?: string | null;
  'data-testid'?: string;
}

const DEFAULT_INPUT =
  'h-[52px] w-full rounded-full border border-[#DDDEE7] bg-white px-5 text-[15px] text-[#1F1F1F] outline-none focus:ring-2 focus:ring-[#5F0080] disabled:opacity-50';

export function BirthDateInput({
  value,
  onChange,
  ageRule = 'signup',
  label = '생년월일',
  id,
  disabled,
  required,
  inputClassName,
  labelClassName,
  externalError,
  'data-testid': testId,
}: BirthDateInputProps) {
  const autoId = useId();
  const inputId = id ?? `birth-${autoId}`;
  const [display, setDisplay] = useState(() => fromIsoBirthDate(value));
  const [touched, setTouched] = useState(false);

  // 바깥에서 값이 바뀌면(초기값 로드·초기화) 표시를 맞춘다. 사용자가 입력 중인 미완성 값은 건드리지 않는다.
  useEffect(() => {
    if (value && toIsoBirthDate(display) !== value) setDisplay(fromIsoBirthDate(value));
    if (!value && toIsoBirthDate(display)) setDisplay('');
    // display 는 사용자가 입력하는 값이므로 의존성에서 제외한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const state = checkBirthInput(display, ageRule);
  const showError = state !== 'ok' && state !== 'required' && (touched || state === 'invalid' || state === 'underage');
  const message = externalError
    ?? (showError ? (state === 'incomplete' ? BIRTH_DATE_MESSAGES.invalid : BIRTH_DATE_MESSAGES[state as 'invalid' | 'underage' | 'required']) : null);

  const handleChange = (raw: string) => {
    const next = formatBirthDigits(extractBirthDigits(raw));
    setDisplay(next);
    onChange(toIsoBirthDate(next), checkBirthInput(next, ageRule));
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className={labelClassName ?? 'text-sm'}>
        {label}
      </label>
      <input
        id={inputId}
        data-testid={testId}
        type="text"
        inputMode="numeric"
        autoComplete="bday"
        placeholder="YYYY.MM.DD"
        maxLength={10}
        value={display}
        required={required}
        disabled={disabled}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? `${inputId}-error` : undefined}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => setTouched(true)}
        className={inputClassName ?? DEFAULT_INPUT}
      />
      {message && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-red-500">
          {message}
        </p>
      )}
    </div>
  );
}

export default BirthDateInput;
