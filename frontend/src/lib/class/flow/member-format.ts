// SDD-209 M — 참가자 화면 시각 표기(상대 날짜 + 12시간제). 시안: `오늘 오후 3:00`.
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'] as const;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function clockText(date: Date): string {
  const hour = date.getHours();
  const meridiem = hour < 12 ? '오전' : '오후';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${meridiem} ${hour12}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** `오늘 오후 3:00` · `내일 오전 10:00` · `10월 22일 (목) 오후 7:00` */
export function formatWhen(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const day =
    diffDays === 0 ? '오늘' : diffDays === 1 ? '내일' : `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY[date.getDay()]})`;
  return `${day} ${clockText(date)}`;
}

/** `오늘 오후 3:00 시작` */
export function formatStartLabel(iso: string | null, now: Date = new Date()): string | null {
  const when = formatWhen(iso, now);
  return when ? `${when} 시작` : null;
}

/** 시작 시각까지 남은 분(지났으면 0). 시각이 없으면 null */
export function minutesUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now.getTime()) / 60_000));
}
