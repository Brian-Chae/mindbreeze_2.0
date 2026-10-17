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

/** `약 5분 뒤에 시작해요` · `약 1시간 30분 뒤에 시작해요` · 시각이 지났으면 `곧 시작해요` · 시각을 모르면 null */
export function startsInLabel(iso: string | null, now: Date = new Date()): string | null {
  const minutes = minutesUntil(iso, now);
  if (minutes === null) return null;
  if (minutes <= 0) return '곧 시작해요';
  if (minutes < 60) return `약 ${minutes}분 뒤에 시작해요`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `약 ${hours}시간 뒤에 시작해요` : `약 ${hours}시간 ${rest}분 뒤에 시작해요`;
}

/** 앞 2글자만 보이는 이메일 마스킹: `se***@example.com`. 이메일 형식이 아니면 null */
export function maskEmail(email: string): string | null {
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/** 시작~종료 시각의 차이(분, 반올림). 시각이 없거나 종료가 먼저면 null */
export function durationMinutes(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}
