// SDD-097: 예약 클래스 사전 안내(리마인더) — 시점 옵션·표시·카운트다운 유틸

/**
 * 리마인더 시점(시작 N분 전). 상담사 생성 폼의 '끄기/하루 전/1시간 전' 옵션과 1:1 대응.
 */
export interface ReminderOption {
  value: number;
  label: string;
  hint: string;
}

export const REMINDER_OFF_OPTION: ReminderOption = {
  value: 0,
  label: '끄기',
  hint: '사전 안내를 보내지 않습니다',
};

export const REMINDER_ON_OPTIONS: ReminderOption[] = [
  { value: 1440, label: '하루 전', hint: '시작 24시간 전에 참여코드·준비물을 안내합니다' },
  { value: 60, label: '1시간 전', hint: '시작 1시간 전에 다시 안내합니다' },
];

/** 시작 N분 전 정수 → 사람이 읽는 라벨(예: 하루 전, 1시간 전, 30분 전). */
export function formatReminderOffset(offsetMin: number): string {
  if (offsetMin % 1440 === 0) {
    const days = offsetMin / 1440;
    return days === 1 ? '하루 전' : `${days}일 전`;
  }
  if (offsetMin % 60 === 0) return `${offsetMin / 60}시간 전`;
  return `${offsetMin}분 전`;
}

/** 리마인더 시점 목록 → 요약 문구. 비어 있으면 '끔'. */
export function describeReminderOffsets(offsets: number[] | null | undefined): string {
  if (!offsets || offsets.length === 0) return '끔';
  return [...offsets]
    .sort((a, b) => b - a)
    .map(formatReminderOffset)
    .join(' · ');
}

/**
 * 예정된 클래스의 '다음 리마인더 발송 시각' — 아직 지나지 않은 가장 빠른 시점.
 * 일정/시점이 없으면 null.
 */
export function nextReminderAt(
  scheduledAt: string | null | undefined,
  offsets: number[] | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (!scheduledAt || !offsets || offsets.length === 0) return null;
  const start = new Date(scheduledAt);
  if (Number.isNaN(start.getTime())) return null;
  const candidates = offsets
    .map((offset) => start.getTime() - offset * 60_000)
    .filter((ts) => ts > now.getTime())
    .sort((a, b) => a - b);
  return candidates.length > 0 ? new Date(candidates[0]) : null;
}

/** 시작 시각까지 남은 시간을 사람이 읽는 문구로(예: 3시간 12분 후, 곧 시작). */
export function formatCountdown(scheduledAt: string | null | undefined, now: Date = new Date()): string {
  if (!scheduledAt) return '';
  const start = new Date(scheduledAt);
  if (Number.isNaN(start.getTime())) return '';
  const diffMin = Math.floor((start.getTime() - now.getTime()) / 60_000);
  if (diffMin <= 0) return '곧 시작';
  const days = Math.floor(diffMin / 1440);
  const hours = Math.floor((diffMin % 1440) / 60);
  const minutes = diffMin % 60;
  if (days > 0) return `${days}일 ${hours}시간 후`;
  if (hours > 0) return `${hours}시간 ${minutes}분 후`;
  return `${minutes}분 후`;
}

/**
 * 회원 홈 '다가오는 클래스' 카드 대상 선정 — 아직 시작하지 않은 예약 클래스 중
 * 가장 임박한 1건. 없으면 null. 시작이 지난 예약은 제외한다.
 */
export function pickUpcomingClass<T extends { status: string; scheduled_at: string | null }>(
  sessions: T[],
  now: Date = new Date(),
): T | null {
  const upcoming = sessions
    .filter((s) => {
      if (s.status !== 'scheduled') return false;
      if (!s.scheduled_at) return false;
      const start = new Date(s.scheduled_at).getTime();
      return !Number.isNaN(start) && start > now.getTime();
    })
    .sort(
      (a, b) =>
        new Date(a.scheduled_at as string).getTime() - new Date(b.scheduled_at as string).getTime(),
    );
  return upcoming.length > 0 ? upcoming[0] : null;
}
