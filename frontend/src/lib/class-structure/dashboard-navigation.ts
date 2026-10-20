import { isCounselingEnabled } from '../feature-flags';

interface ParentSession { id: string; class_id?: string | null; counseling_relationship_id?: string | null; area?: string | null }
export function dashboardSessionArea(row: ParentSession): '명상' | '상담' | null {
  if (row.area === 'meditation' && row.class_id && !row.counseling_relationship_id) return '명상';
  if (row.area === 'counseling' && row.counseling_relationship_id && !row.class_id) return '상담';
  return null;
}
export function dashboardSessionPath(row: ParentSession): string {
  const area = dashboardSessionArea(row);
  if (area === '명상') return `/classes/${encodeURIComponent(row.class_id!)}/sessions/${encodeURIComponent(row.id)}`;
  if (area === '상담' && isCounselingEnabled()) return `/counseling/${encodeURIComponent(row.counseling_relationship_id!)}/sessions/${encodeURIComponent(row.id)}`;
  // SDD-219: 상담 비공개 시 상담 행은 클래스 홈으로 보낸다.
  if (area === '상담') return '/classes';
  return `/sessions/${encodeURIComponent(row.id)}`;
}
