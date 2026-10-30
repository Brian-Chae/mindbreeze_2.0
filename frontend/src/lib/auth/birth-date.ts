// 생년월일 숫자 직접 입력 보조 — 표시는 YYYY.MM.DD, 서버 전송은 기존대로 YYYY-MM-DD.

import { checkBirthDate, isValidDateString, todayKst, type BirthDateCheck } from './age';

/** 입력 문자열에서 숫자만 최대 8자리 추출한다(구분점·공백·문자 무시). */
export function extractBirthDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 8);
}

/** 숫자열(≤8자리)을 YYYY.MM.DD 표시로 바꾼다. 4자리·6자리가 채워지면 구분점이 자동으로 붙는다. */
export function formatBirthDigits(digits: string): string {
  const d = extractBirthDigits(digits);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`;
}

/** 숫자 8자리가 모두 채워졌을 때만 YYYY-MM-DD, 아니면 빈 문자열. */
export function toIsoBirthDate(display: string): string {
  const d = extractBirthDigits(display);
  if (d.length !== 8) return '';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** 서버 형식(YYYY-MM-DD)을 표시 문자열(YYYY.MM.DD)로. 형식이 맞지 않으면 빈 문자열. */
export function fromIsoBirthDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
}

export type BirthAgeRule = 'signup' | 'none';
export type BirthInputState = BirthDateCheck | 'incomplete';

/**
 * 표시 문자열 검증.
 * - signup: 만 14세 이상(기존 규칙 `checkBirthDate`)
 * - none: 실제 날짜·미래 금지·1900 이후만 확인(프로필 수정용, 나이 제한 없음)
 */
export function checkBirthInput(display: string, ageRule: BirthAgeRule = 'signup', today: string = todayKst()): BirthInputState {
  const digits = extractBirthDigits(display);
  if (digits.length === 0) return 'required';
  if (digits.length < 8) return 'incomplete';
  const iso = toIsoBirthDate(display);
  if (ageRule === 'signup') return checkBirthDate(iso, today);
  if (!isValidDateString(iso) || iso > today || iso < '1900-01-01') return 'invalid';
  return 'ok';
}
