// SDD-209 SH1 — 클래스 시각 문구(셸형 화면 공용). 시안의 `오늘 오후 3:00` 식 상대 표기를 만든다.
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** `오후 3:00` — 12시간제, 정오는 오후 12:00, 자정은 오전 12:00 */
export function formatClock(date: Date): string {
  const hour = date.getHours();
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour < 12 ? '오전' : '오후'} ${hour12}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 일정 없는 즉시 클래스는 시각 대신 안내 문구 */
export function formatClassWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '바로 입장할 수 있어요';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const clock = formatClock(date);
  if (dayDiff === 0) return `오늘 ${clock}`;
  if (dayDiff === 1) return `내일 ${clock}`;
  if (dayDiff === -1) return `어제 ${clock}`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]}) ${clock}`;
}

/** 시작까지 남은 분. 일정이 없으면 null */
export function minutesUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((time - now.getTime()) / 60_000);
}

/** `3일 2시간` · `19시간` · `30분`. 이미 지났거나 일정이 없으면 빈 문자열 */
export function formatStartsIn(iso: string | null | undefined, now: Date = new Date()): string {
  const diff = minutesUntil(iso, now);
  if (diff === null || diff <= 0) return '';
  const days = Math.floor(diff / 1440);
  const hours = Math.floor((diff % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return `${hours}시간`;
  return `${diff}분`;
}

/** 진행 경과 `12분째`. 시작 시각이 없으면 빈 문자열 */
export function formatElapsed(startedAt: string | null | undefined, now: Date = new Date()): string {
  if (!startedAt) return '';
  const time = new Date(startedAt).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - time) / 60_000));
  return `${minutes}분째`;
}

/** D-3 식 표기(같은 날이면 빈 문자열) */
export function formatDDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  return days > 0 ? `D-${days}` : '';
}
