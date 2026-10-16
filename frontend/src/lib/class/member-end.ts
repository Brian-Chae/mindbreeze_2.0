// SDD-208 — 회원 종료 화면(M21) 보조 계산.

/** 종료 카드의 "함께한 시간" — 시작 시각부터 지금까지(분, 최소 1분). 시작 시각을 모르면 계획 시간 */
export function formatEndDuration({ startedAt, durationMin, nowMs }: { startedAt: string | null; durationMin: number; nowMs: number }): string {
  const startedMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (Number.isNaN(startedMs)) return `${Math.max(1, Math.round(durationMin))}분`;
  return `${Math.max(1, Math.round((nowMs - startedMs) / 60_000))}분`;
}
