// SDD-253 — 클래스 > 회차 > 회원 > 리포트 계층 조회 API
import { apiClient } from './client';

export type HierarchyTab = 'all' | 'needs_review' | 'failed';

export interface HierarchyDoc {
  report_id: string;
  type: 'client' | 'counselor';
  status: string | null;
  generation_status: string;
  generation_error?: string | null;
  approval_required: boolean;
  approved_at?: string | null;
  approved_by_name?: string | null;
  approved_by_role?: string | null;
  approval_source?: string | null;
  delivery_status?: string | null;
  delivery_attempted_at?: string | null;
  is_read: boolean;
}

export interface HierarchyMember {
  participant_id: string;
  name: string | null;
  gender: string | null;
  /** 만 나이(서비스 기준일 Asia/Seoul). 생년월일은 내려오지 않는다. */
  age: number | null;
  is_guest: boolean;
  client_report: HierarchyDoc | null;
}

export interface HierarchySession {
  session_id: string;
  title: string | null;
  type: string;
  scheduled_at: string | null;
  counselor_id: string;
  counselor_name: string | null;
  participant_count: number;
  matched_count: number;
  needs_review: number;
  delivery_failed: number;
  /** 상담사용 회차 공통 문서(클래스는 회차 단위 1건) */
  common_report: HierarchyDoc | null;
  members: HierarchyMember[];
}

export interface HierarchyGroup {
  key: string;
  kind: 'class' | 'solo';
  /** solo 는 실제 클래스 ID 를 합성하지 않는다 */
  class_id: string | null;
  title: string;
  continued?: boolean;
  needs_review: number;
  session_total: number;
  sessions: HierarchySession[];
}

export interface HierarchyResponse {
  summary: { needs_review: number; failed_delivery: number; generation_failed: number; total_sessions: number; total_members?: number };
  groups: HierarchyGroup[];
  total_sessions: number;
  page: number;
  limit: number;
}

export interface HierarchyQuery {
  q?: string;
  tab?: HierarchyTab;
  counselorId?: string;
  activity?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export function buildHierarchyQuery(query: HierarchyQuery): string {
  const sp = new URLSearchParams();
  if (query.q?.trim()) sp.set('q', query.q.trim());
  if (query.tab && query.tab !== 'all') sp.set('tab', query.tab);
  if (query.counselorId) sp.set('counselor_id', query.counselorId);
  if (query.activity) sp.set('activity', query.activity);
  if (query.dateFrom) sp.set('date_from', query.dateFrom);
  if (query.dateTo) sp.set('date_to', query.dateTo);
  sp.set('page', String(query.page ?? 1));
  sp.set('limit', String(query.limit ?? 10));
  return `?${sp.toString()}`;
}

export const getReportHierarchy = (query: HierarchyQuery = {}): Promise<HierarchyResponse> =>
  apiClient.get<HierarchyResponse>(`/reports/hierarchy${buildHierarchyQuery(query)}`);
