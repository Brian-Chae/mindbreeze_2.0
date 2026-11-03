// SDD-281 — 시작 날짜 캘린더용 순수 날짜 유틸. 값 형식은 "YYYY-MM-DD" 그대로(KST 달력 날짜, 시간대 변환 없음).
export const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
const LONG_DOW = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;

export interface YearMonth { year: number; month: number }

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}
export function toIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}
export function weekdayOf(value: string): number {
  const p = parseIsoDate(value); if (!p) return 0;
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 12)).getUTCDay();
}
/** "11/3(화)" — 잘못된 값은 "날짜 선택" */
export function formatDisplay(value: string): string {
  const p = parseIsoDate(value); if (!p) return '날짜 선택';
  return `${p.month}/${p.day}(${DOW_LABELS[weekdayOf(value)]})`;
}
export function addDays(value: string, delta: number): string {
  const p = parseIsoDate(value); if (!p) return value;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + delta, 12));
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
/** 달 단위 이동. 말일을 넘으면 그 달 말일로 맞춘다(1/31 +1달 → 2/28). */
export function addMonths(value: string, delta: number): string {
  const p = parseIsoDate(value); if (!p) return value;
  const idx = p.year * 12 + (p.month - 1) + delta;
  const year = Math.floor(idx / 12); const month = (idx % 12 + 12) % 12 + 1;
  return toIso(year, month, Math.min(p.day, daysInMonth(year, month)));
}
export function monthOf(value: string): YearMonth {
  const p = parseIsoDate(value); const now = p ?? { year: 1970, month: 1 };
  return { year: now.year, month: now.month };
}
export const monthKey = (ym: YearMonth): number => ym.year * 12 + ym.month - 1;
export const shiftMonth = (ym: YearMonth, delta: number): YearMonth => {
  const idx = monthKey(ym) + delta; return { year: Math.floor(idx / 12), month: (idx % 12 + 12) % 12 + 1 };
};
export function isSelectable(value: string, min?: string, max?: string): boolean {
  if (!parseIsoDate(value)) return false;
  if (min && value < min) return false;
  if (max && value > max) return false;
  return true;
}
/** 그 달로 이동 가능한가(해당 달에 선택 가능한 날짜가 하나라도 있는가) */
export function monthReachable(ym: YearMonth, min?: string, max?: string): boolean {
  const first = toIso(ym.year, ym.month, 1); const last = toIso(ym.year, ym.month, daysInMonth(ym.year, ym.month));
  if (min && last < min) return false;
  if (max && first > max) return false;
  return true;
}
/** 일요일 시작 월 격자. 빈 칸은 null, 행 수는 5 또는 6(항상 7의 배수). */
export function monthGrid(ym: YearMonth): (string | null)[][] {
  const lead = weekdayOf(toIso(ym.year, ym.month, 1)); const total = daysInMonth(ym.year, ym.month);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= total; d += 1) cells.push(toIso(ym.year, ym.month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
/** 스크린리더용: "2026년 11월 3일 화요일, 오늘" / "…, 선택 불가" / "…, 선택됨" */
export function cellLabel(value: string, opts: { today?: string; selected?: string; min?: string; max?: string }): string {
  const p = parseIsoDate(value); if (!p) return value;
  const parts = [`${p.year}년 ${p.month}월 ${p.day}일 ${LONG_DOW[weekdayOf(value)]}`];
  if (opts.today === value) parts.push('오늘');
  if (opts.selected === value) parts.push('선택됨');
  if (!isSelectable(value, opts.min, opts.max)) parts.push('선택 불가');
  return parts.join(', ');
}
export const monthTitle = (ym: YearMonth): string => `${ym.year}년 ${ym.month}월`;
