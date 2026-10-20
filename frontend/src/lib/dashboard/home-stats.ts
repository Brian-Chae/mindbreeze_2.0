// SDD-221 — 상담사 홈 요약 수치 계산 (순수 함수). 같은 화면 목록과 동일한 기준을 쓴다.

import type { ClassSummary } from '../api/dashboard';
import { isCounselingEnabled } from '../feature-flags';
import { dashboardSessionArea } from '../class-structure/dashboard-navigation';

/** SDD-219: 상담 비공개 시 상담 영역 행을 제외한 "화면에 보이는" 행. */
export function visibleDashboardRows(rows: readonly ClassSummary[]): ClassSummary[] {
  return rows.filter((c) => isCounselingEnabled() || dashboardSessionArea(c) !== '상담');
}

/** 진행 중 = in_progress + open (목록·상단 카드와 같은 집합) */
export function liveClasses(rows: readonly ClassSummary[]): ClassSummary[] {
  return rows.filter((c) => c.status === 'in_progress' || c.status === 'open');
}

/** 검토 대기 = 입력 행의 pending_review_count 합 (상담 제외된 rows 를 넣는다) */
export function pendingReviewTotal(rows: readonly ClassSummary[]): number {
  return rows.reduce((sum, c) => sum + (Number.isFinite(c.pending_review_count) ? c.pending_review_count : 0), 0);
}

/** 오늘(로컬 날짜) 일정 중 취소·완료가 아닌 회차, 시간순 */
export function todayRemaining(rows: readonly ClassSummary[], now: Date): ClassSummary[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return rows
    .filter((c) => {
      if (!c.scheduled_at || c.status === 'cancelled' || c.status === 'completed') return false;
      const t = new Date(c.scheduled_at).getTime();
      return t >= start && t < end;
    })
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
}
