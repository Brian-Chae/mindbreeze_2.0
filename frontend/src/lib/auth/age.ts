// 만 14세 이상 가입 확인 보조 — 서버(Asia/Seoul 기준)가 최종 판정하며 이 함수는 입력 안내용이다.

export const MIN_SIGNUP_AGE = 14;

/** 한국 표준시(UTC+9) 기준 오늘 날짜(YYYY-MM-DD). */
export function todayKst(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** YYYY-MM-DD 문자열이 실제 존재하는 날짜인지. */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export type BirthDateCheck = 'ok' | 'required' | 'invalid' | 'underage';

/** 생일 당일부터 만 14세 허용. 2월 29일생은 평년 3월 1일에 생일이 지난 것으로 본다. */
export function checkBirthDate(value: string, today: string = todayKst()): BirthDateCheck {
  if (!value.trim()) return 'required';
  if (!isValidDateString(value) || value > today || value < '1900-01-01') return 'invalid';
  const [by, bm, bd] = value.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let years = ty - by;
  if (tm < bm || (tm === bm && td < bd)) years -= 1;
  return years >= MIN_SIGNUP_AGE ? 'ok' : 'underage';
}

export const BIRTH_DATE_MESSAGES: Record<Exclude<BirthDateCheck, 'ok'>, string> = {
  required: '생년월일을 입력해 주세요.',
  invalid: '생년월일을 올바르게 입력해 주세요.',
  underage: '만 14세 이상만 가입할 수 있어요.',
};
