// SDD-221 — 상담사 홈 요약 타일 이동 경로 (순수 함수)

import type { ClassSummary } from '../api/dashboard';

/** 진행 중 타일: 회차 1개면 입장 화면, 아니면 클래스 목록 */
export function liveTileTarget(live: readonly ClassSummary[]): string {
  return live.length === 1 ? `/sessions/${encodeURIComponent(live[0].id)}/player` : '/classes';
}

export function liveTileHint(liveCount: number): string {
  return liveCount > 0 ? '입장하기 →' : '클래스 목록 →';
}

export const REVIEW_TILE_TARGET = '/reports?status=pending';
export const TODAY_TILE_TARGET = '/classes';
export const PARTICIPANTS_TILE_TARGET = '/clients';
