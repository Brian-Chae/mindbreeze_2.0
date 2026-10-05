import type { SessionStatus } from './api/session';

/** 세션 상태 라벨 단일 소스 (SDD-129 ③-6) — 모든 화면 공통 표기 */
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  ready: '준비',
  scheduled: '예정',
  open: '입장 가능',
  in_progress: '진행 중',
  completed: '완료',
  cancelled: '취소',
};

/** 상태 라벨 조회 + 미지 값 폴백(빈칸 방지) */
export function sessionStatusLabel(status: string): string {
  return SESSION_STATUS_LABELS[status as SessionStatus] ?? status;
}
