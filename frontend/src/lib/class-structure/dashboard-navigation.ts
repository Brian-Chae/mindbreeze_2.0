interface ParentSession { id: string; class_id?: string | null; counseling_relationship_id?: string | null; area?: string | null }
export function dashboardSessionArea(row: ParentSession): '명상' | '상담' | null {
  if (row.area === 'meditation' && row.class_id && !row.counseling_relationship_id) return '명상';
  if (row.area === 'counseling' && row.counseling_relationship_id && !row.class_id) return '상담';
  return null;
}
export function dashboardSessionPath(row: ParentSession): string {
  const area = dashboardSessionArea(row);
  if (area === '명상') return `/classes/${encodeURIComponent(row.class_id!)}/sessions/${encodeURIComponent(row.id)}`;
  if (area === '상담') return `/counseling/${encodeURIComponent(row.counseling_relationship_id!)}/sessions/${encodeURIComponent(row.id)}`;
  return `/sessions/${encodeURIComponent(row.id)}`;
}
