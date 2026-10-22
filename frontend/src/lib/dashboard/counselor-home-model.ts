// SDD-232 — 상담사 홈 표시 모델(순수 함수). API 호출 없이 대시보드 행·클래스 목록을 정렬·선택한다.
import type { ClassSummary } from '../api/dashboard';
import type { ClassReadModel } from '../class-structure/adapters';
import { liveClasses } from './home-stats';

export const HOME_CLASS_LIMIT = 8;
export const HOME_SCHEDULE_LIMIT = 5;

/** 히어로: 진행 중(in_progress/open) 우선, 없으면 가장 가까운 미래 예정(취소·완료 제외). */
export function pickHeroSession(rows: readonly ClassSummary[], now: Date): { session: ClassSummary; live: boolean } | null {
  const live = liveClasses(rows);
  if (live.length > 0) return { session: live[0], live: true };
  const upcoming = rows
    .filter((c) => c.scheduled_at && new Date(c.scheduled_at).getTime() >= now.getTime() && c.status !== 'cancelled' && c.status !== 'completed')
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  return upcoming[0] ? { session: upcoming[0], live: false } : null;
}

/** 일정 목록: 진행 중 회차 → 다가오는 회차(시간순), 중복 없이 최대 5건. */
export function pickScheduleRows(rows: readonly ClassSummary[], now: Date): ClassSummary[] {
  const live = liveClasses(rows);
  const liveIds = new Set(live.map((c) => c.id));
  const upcoming = rows
    .filter((c) => !liveIds.has(c.id) && c.scheduled_at && new Date(c.scheduled_at).getTime() >= now.getTime() && c.status !== 'cancelled' && c.status !== 'completed')
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  return [...live, ...upcoming].slice(0, HOME_SCHEDULE_LIMIT);
}

/** 지난 회차(완료·취소), 최근 순. */
export function pickPastRows(rows: readonly ClassSummary[], limit = 4): ClassSummary[] {
  const time = (c: ClassSummary): number => new Date(c.ended_at ?? c.scheduled_at ?? c.created_at ?? 0).getTime();
  return rows.filter((c) => c.status === 'completed' || c.status === 'cancelled').sort((a, b) => time(b) - time(a)).slice(0, limit);
}

const ENDED = new Set(['completed', 'closed', 'cancelled']);
function nextTime(model: ClassReadModel): number {
  const next = model.nextSession.kind === 'value' ? model.nextSession.value : null;
  const at = next && next.scheduledAt.kind === 'value' ? Date.parse(next.scheduledAt.value) : NaN;
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}
function rank(model: ClassReadModel): number {
  const status = model.status.kind === 'value' ? model.status.value : '';
  if (ENDED.has(status)) return 2;
  return status === 'active' || status === 'ready' ? 0 : 1;
}

/** 클래스 정렬: 활성/준비 → 열린 회차 → 다음 시각 → 안정 ID, 종료 항목은 뒤. 입력은 변경하지 않는다. */
export function sortHomeClasses(models: readonly ClassReadModel[]): ClassReadModel[] {
  return [...models].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank) return byRank;
    const openA = a.hasOpenSession.kind === 'value' && a.hasOpenSession.value ? 0 : 1;
    const openB = b.hasOpenSession.kind === 'value' && b.hasOpenSession.value ? 0 : 1;
    if (openA !== openB) return openA - openB;
    const ta = nextTime(a);
    const tb = nextTime(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
