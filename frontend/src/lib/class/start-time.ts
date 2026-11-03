// SDD-279 — 시작 시각 값 변환(순수 함수). draft.timeMin(자정부터 분)과 {오전/오후, 12시간제 시, 분}을 오간다.
// 허용 범위는 class-wizard 의 MIN_TIME_MIN~MAX_TIME_MIN(오전 7시~오후 10시)을 그대로 따른다.
import { MAX_TIME_MIN, MIN_TIME_MIN } from './class-wizard';

export type Meridiem = 'am' | 'pm';

export interface TimeParts {
  meridiem: Meridiem;
  hour12: number;
  minute: number;
}

export interface MinuteOption {
  value: number;
  disabled: boolean;
}

const MINUTE_STEP = 5;

export interface TimeBounds {
  minMin?: number;
  maxMin?: number;
}

const clampTime = (min: number, b: TimeBounds = {}): number => Math.min(b.maxMin ?? MAX_TIME_MIN, Math.max(b.minMin ?? MIN_TIME_MIN, min));

/** "HH:MM" → 자정부터 분. 형식이 어긋나면 null (SDD-279 보정: /classes/new 는 문자열 시각을 쓴다) */
export function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh > 23 || mm > 59 ? null : hh * 60 + mm;
}

/** 자정부터 분 → "HH:MM" (2자리 패딩) */
export function formatClock(timeMin: number): string {
  return `${String(Math.floor(timeMin / 60)).padStart(2, '0')}:${String(timeMin % 60).padStart(2, '0')}`;
}

export function splitTime(timeMin: number): TimeParts {
  const hour = Math.floor(timeMin / 60);
  return { meridiem: hour < 12 ? 'am' : 'pm', hour12: hour % 12 === 0 ? 12 : hour % 12, minute: timeMin % 60 };
}

/** 오전/오후 + 12시간제 시 → 24시간제 시(오전 12시 = 0, 오후 12시 = 12) */
export function hour24Of(meridiem: Meridiem, hour12: number): number {
  const base = hour12 % 12;
  return meridiem === 'am' ? base : base + 12;
}

/** 해당 오전/오후에서 허용 범위 안의 12시간제 시 목록(오후는 12시부터) */
export function allowedHours(meridiem: Meridiem, b: TimeBounds = {}): number[] {
  const lo = b.minMin ?? MIN_TIME_MIN;
  const hi = b.maxMin ?? MAX_TIME_MIN;
  const hours: number[] = [];
  const start = meridiem === 'am' ? 0 : 12;
  for (let h = start; h < start + 12; h += 1) {
    if ((h + 1) * 60 > lo && h * 60 <= hi) hours.push(h % 12 === 0 ? 12 : h % 12);
  }
  return hours;
}

/** 분 목록(00~55, 5분 단위). 해당 시에서 최대 시각을 넘는 분은 비활성 */
export function minuteOptions(hour24: number, b: TimeBounds = {}): MinuteOption[] {
  const lo = b.minMin ?? MIN_TIME_MIN;
  const hi = b.maxMin ?? MAX_TIME_MIN;
  return Array.from({ length: 60 / MINUTE_STEP }, (_, i) => {
    const value = i * MINUTE_STEP;
    return { value, disabled: hour24 * 60 + value > hi || hour24 * 60 + value < lo };
  });
}

/** 5분 단위가 아닌 값(서버·복원 값)의 표시용 가장 가까운 칸. draft 는 바꾸지 않는다 */
export function snapMinute(minute: number): number {
  return Math.min(60 - MINUTE_STEP, Math.round(minute / MINUTE_STEP) * MINUTE_STEP);
}

export function setMeridiem(timeMin: number, meridiem: Meridiem, b: TimeBounds = {}): number {
  const { hour12, minute } = splitTime(timeMin);
  return clampTime(hour24Of(meridiem, hour12) * 60 + minute, b);
}

export function setHour(timeMin: number, meridiem: Meridiem, hour12: number, b: TimeBounds = {}): number {
  return clampTime(hour24Of(meridiem, hour12) * 60 + (timeMin % 60), b);
}

export function setMinute(timeMin: number, minute: number, b: TimeBounds = {}): number {
  return clampTime(Math.floor(timeMin / 60) * 60 + minute, b);
}
