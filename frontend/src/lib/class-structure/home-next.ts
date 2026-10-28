// SDD-250: 홈 '다음 일정' 후보 선정 순수 규칙 (컴포넌트 파일과 분리해 react-refresh 규칙을 지킨다).

/** 열린 회차를 홈에 올리는 최대 경과 시간(D4, 서버 HOME_OPEN_WINDOW_HOURS 와 같은 값). */
export const HOME_OPEN_WINDOW_MS = 6 * 60 * 60 * 1000;

/** 열린 회차가 윈도우 안인지. 시각이 없거나 파싱 불가면 제외한다. */
export function withinOpenWindow(scheduledAt: string | null | undefined, now: number): boolean {
  if (!scheduledAt) return false;
  const at = Date.parse(scheduledAt);
  return Number.isFinite(at) && at >= now - HOME_OPEN_WINDOW_MS;
}

/** 우선순위 점수(작을수록 앞): 진행 중 즉석 0, 입장 중 즉석 1, 진행 중 일반 2, 입장 중 일반 3, 예정 4. */
export function homeRank(open: boolean, instant: boolean, status: string): number {
  if (!open) return 4;
  const live = status === 'in_progress';
  return instant ? (live ? 0 : 1) : (live ? 2 : 3);
}

/** '{n}분 전에 시작했어요' 문구. 미래(예정 전에 열림)면 null. */
export function startedAgoLabel(scheduledAt: string, now: number): string | null {
  const at = Date.parse(scheduledAt);
  if (!Number.isFinite(at) || at > now + 60_000) return null;
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return '방금 시작했어요';
  if (min < 60) return `${min}분 전에 시작했어요`;
  return `${Math.floor(min / 60)}시간 전에 시작했어요`;
}
