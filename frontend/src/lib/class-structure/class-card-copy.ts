// SDD-232 — 클래스 카드 빈 값 문구 규칙(순수 함수). 회원·상담사 공통 카드가 사용한다.
// 전역 ReadField 는 건드리지 않고, 카드에서 필요한 한 줄 안내만 남기고 선택 메타는 생략한다.
import type { ClassReadModel } from './adapters';
import type { DisplayField } from './read-model';

function value<T>(field: DisplayField<T>): T | undefined {
  return field.kind === 'value' ? field.value : undefined;
}

const ENDED_STATUSES = new Set(['completed', 'closed', 'cancelled']);

export interface ClassCardCopy {
  title: string;
  /** 전체 회차가 1 이상일 때만 진행 막대를 표시한다. */
  progress: { completed: number; total: number } | null;
  /** 전체 회차를 모르지만 완료 수가 확실할 때만 사용한다. */
  completedOnly: number | null;
  nextHeadline: string;
  nextDetail: string | null;
  host: string | null;
  hasNext: boolean;
}

export function classCardCopy(model: ClassReadModel, formatDate: (iso: string) => string | undefined): ClassCardCopy {
  const title = value(model.title)?.trim() || '이름 없는 클래스';
  const rawProgress = value(model.progress);
  const progress = rawProgress && rawProgress.total > 0 ? { completed: rawProgress.completed, total: rawProgress.total } : null;
  const completedOnly = !progress && rawProgress && rawProgress.completed > 0 ? rawProgress.completed : null;
  const next = value(model.nextSession);
  if (!next) {
    const status = value(model.status);
    const finished = (status !== undefined && ENDED_STATUSES.has(status)) || (progress !== null && progress.completed >= progress.total);
    const headline = value(model.hasOpenSession) === true ? '열린 회차가 있어요'
      : finished ? '모든 회차를 마쳤어요' : '다음 일정이 아직 없어요';
    return { title, progress, completedOnly, nextHeadline: headline, nextDetail: null, host: null, hasNext: false };
  }
  const seq = value(next.seq);
  const at = value(next.scheduledAt);
  return {
    title, progress, completedOnly,
    nextHeadline: seq != null ? `다음 회차 · ${seq}회차` : '다음 회차',
    nextDetail: (at && formatDate(at)) || '다음 일정 확인 중',
    host: value(next.hostName) ?? null,
    hasNext: true,
  };
}
