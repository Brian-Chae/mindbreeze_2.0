// 코치 홈 달력 ↔ 내 클래스 연동용 순수 함수. 색은 class_id 해시로 정해 정렬 순서가 바뀌어도 변하지 않는다.
import type { ClassSummary } from '../api/dashboard';

/** 보라 톤 안에서 구분되는 5색(6개 이상이면 재사용 — 이름·선택 표시를 항상 함께 쓴다). */
export const CLASS_COLORS = ['#5F0080', '#9B51E0', '#C2409F', '#4B5BD6', '#7A4A9E'] as const;

/** class_id → 안정 색(FNV-1a 해시). */
export function classColor(classId: string | null | undefined): string {
  const text = classId ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return CLASS_COLORS[h % CLASS_COLORS.length];
}

const isEnded = (c: ClassSummary): boolean => c.status === 'completed' || c.status === 'cancelled';

/** 해당 클래스의 다음 예정 회차(오늘 포함, 끝난 회차 제외). 날짜 키는 호출 쪽이 KST 로 계산한다. */
export function nextSessionOf(sessions: readonly ClassSummary[], classId: string, todayKey: string, keyOf: (iso: string) => string | null): ClassSummary | null {
  const upcoming = sessions
    .filter((c) => c.class_id === classId && !isEnded(c) && c.scheduled_at)
    .filter((c) => { const k = keyOf(c.scheduled_at!); return k !== null && k >= todayKey; })
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
  return upcoming[0] ?? null;
}
