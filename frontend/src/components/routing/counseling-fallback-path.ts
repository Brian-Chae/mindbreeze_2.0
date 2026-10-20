// SDD-219 — 상담 비공개 시 대체 이동 경로
export function counselingFallbackPath(area: 'host' | 'member'): string {
  return area === 'member' ? '/app/classes' : '/classes';
}
