// SDD-230 회원 개요 — 표시 라벨·그룹핑 순수 함수 (점수·종합점수·접속 상태 없음)

import type { ActivityType, ClientListItem } from '../api/clients';

export const UNASSIGNED_GROUP_ID = '__none__';

export type GroupMode = 'none' | 'class';

export interface ClientGroup {
  id: string;
  title: string;
  clients: ClientListItem[];
}

/** 클래스별 그룹핑. 복수 클래스 회원은 각 그룹에 표시한다. 미소속 그룹은 마지막. */
export function groupClients(clients: ClientListItem[], mode: GroupMode): ClientGroup[] {
  if (mode === 'none') return [{ id: 'all', title: '전체', clients }];
  const map = new Map<string, ClientGroup>();
  const none: ClientListItem[] = [];
  for (const c of clients) {
    const classes = c.classes ?? [];
    if (classes.length === 0) {
      none.push(c);
      continue;
    }
    for (const cls of classes) {
      const g = map.get(cls.id) ?? { id: cls.id, title: cls.title, clients: [] };
      g.clients.push(c);
      map.set(cls.id, g);
    }
  }
  const groups = Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  if (none.length > 0) groups.push({ id: UNASSIGNED_GROUP_ID, title: '미소속', clients: none });
  return groups;
}

/** 고유 회원 수 — 그룹 중복 표시와 별개로 ID 기준. */
export function uniqueClientCount(groups: ClientGroup[]): number {
  const ids = new Set<string>();
  groups.forEach((g) => g.clients.forEach((c) => ids.add(c.id)));
  return ids.size;
}

export function genderLabel(gender?: string | null): string {
  if (!gender) return '미입력';
  return ({ male: '남', female: '여', other: '기타' } as Record<string, string>)[gender] ?? gender;
}

export function ageLabel(age?: number | null): string {
  return age === null || age === undefined ? '미입력' : `만 ${age}세`;
}

const KST_FMT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** KST 기준 `MM.DD HH:mm` (연도가 다르면 연도 포함). */
export function formatKst(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return '기록 없음';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '기록 없음';
  const parts = Object.fromEntries(KST_FMT.formatToParts(d).map((p) => [p.type, p.value]));
  const nowYear = KST_FMT.formatToParts(now).find((p) => p.type === 'year')?.value;
  const date = `${parts.month}.${parts.day}`;
  const prefix = nowYear && nowYear !== parts.year ? `${parts.year}.` : '';
  return `${prefix}${date} ${parts.hour}:${parts.minute}`;
}

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  session: '수업·상담 참여',
  checkin: '수업 체크인',
  measurement: '밴드 측정',
  ai_checkin: 'AI 안부',
};

export const ACTIVE_WITHIN_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '전체' },
  { value: 7, label: '최근 7일' },
  { value: 30, label: '최근 30일' },
  { value: 90, label: '최근 90일' },
];

export type ViewMode = 'table' | 'cards';
export const VIEW_STORAGE_KEY = 'mb_clients_view';

export function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

export function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    /* 저장 실패는 무시 — 개인정보는 저장하지 않는다 */
  }
}
