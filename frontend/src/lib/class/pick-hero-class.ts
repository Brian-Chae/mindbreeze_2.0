// SDD-209 SH1 — 회원 홈 히어로 대상 선정. 진행 중 > 입장 가능 > 가장 임박한 예약 > 일정 없는 준비 순.
// 시작 시각이 지났어도 아직 열리지 않은 예약은 버리지 않는다(현행 pickUpcomingClass 는 버림).
interface HeroCandidate {
  status: string;
  scheduled_at: string | null;
  started_at?: string | null;
}

function time(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function earliest<T extends HeroCandidate>(list: T[]): T | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => time(a.scheduled_at) - time(b.scheduled_at))[0];
}

export function pickHeroClass<T extends HeroCandidate>(sessions: T[], now: Date = new Date()): T | null {
  void now;
  const live = earliest(sessions.filter((s) => s.status === 'in_progress'));
  if (live) return live;
  const open = earliest(sessions.filter((s) => s.status === 'open'));
  if (open) return open;
  const scheduled = earliest(sessions.filter((s) => s.status === 'scheduled' && s.scheduled_at));
  if (scheduled) return scheduled;
  return earliest(sessions.filter((s) => s.status === 'ready' || s.status === 'scheduled'));
}
