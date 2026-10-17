// SDD-209 SH1 — 클래스 용어·배지 키 상수(셸형 화면 공용). 용어는 기획.md §4 를 따른다(세션→클래스, 1:N→그룹, LB→LINK BAND).
import type { LinkbandMode, LocationType, ParticipantMode, SessionStatus, SessionType } from '../api/session';

/** 셸형 상태 배지 키(회원·상담사 공용). 서버 상태와 1:1 이 아니라 화면에서 읽히는 상태다 */
export const CLASS_CHIP_KEYS = ['ready', 'scheduled', 'soon', 'open', 'live', 'done', 'cancelled', 'invited'] as const;
export type ClassChipKey = (typeof CLASS_CHIP_KEYS)[number];

export const CLASS_CHIP_LABELS: Readonly<Record<ClassChipKey, string>> = {
  ready: '준비',
  scheduled: '예정',
  soon: '곧 열림',
  open: '입장 가능',
  live: '진행 중',
  done: '완료',
  cancelled: '취소',
  invited: '초대',
};

/** 예약 시각까지 이 시간(분) 이하면 `곧 열림` (결정 D13 기본값) */
export const SOON_WINDOW_MIN = 60;

const CLASS_TYPE_LABELS: Readonly<Record<SessionType, string>> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상 클래스',
  custom: '기타',
};

export function classTypeLabel(type: SessionType, customName: string | null | undefined): string {
  if (type === 'custom' && customName && customName.trim()) return customName.trim();
  return CLASS_TYPE_LABELS[type] ?? '클래스';
}

export function placeLabel(place: LocationType): string {
  return place === 'online' ? '온라인' : '오프라인';
}

export function sizeLabel(mode: ParticipantMode): string {
  return mode === 'one_on_one' ? '1:1' : '그룹';
}

export function bandLabel(mode: LinkbandMode): string {
  if (mode === 'required') return 'LINK BAND 필수';
  if (mode === 'optional') return 'LINK BAND 선택';
  return 'LINK BAND 사용 안 함';
}

/** 회원이 보는 배지. ready/scheduled 는 예약이 60분 안이면 곧 열림 */
export function memberChipKey(status: SessionStatus, scheduledAt: string | null, now: Date = new Date()): ClassChipKey {
  switch (status) {
    case 'open': return 'open';
    case 'in_progress': return 'live';
    case 'completed': return 'done';
    case 'cancelled': return 'cancelled';
    case 'ready':
    case 'scheduled': {
      if (!scheduledAt) return 'scheduled';
      const diffMin = (new Date(scheduledAt).getTime() - now.getTime()) / 60_000;
      return Number.isFinite(diffMin) && diffMin <= SOON_WINDOW_MIN ? 'soon' : 'scheduled';
    }
    default: return 'scheduled';
  }
}

/** 상담사가 보는 배지. 준비(일정 없음)와 예정을 구분한다 */
export function hostChipKey(status: SessionStatus): ClassChipKey {
  switch (status) {
    case 'ready': return 'ready';
    case 'scheduled': return 'scheduled';
    case 'open': return 'open';
    case 'in_progress': return 'live';
    case 'completed': return 'done';
    case 'cancelled': return 'cancelled';
    default: return 'scheduled';
  }
}
