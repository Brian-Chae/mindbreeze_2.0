// 상담사·기관 클래스 대시보드 API

import { apiClient } from './client';
import type { ParticipantMode, SessionStatus, SessionType } from './session';

export interface ClassSummary {
  id: string;
  title: string | null;
  type: SessionType;
  custom_type_name: string | null;
  status: SessionStatus;
  access_code: string | null;
  participant_mode: ParticipantMode;
  participant_count: number;
  guest_count: number;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string | null;
  has_record: boolean;
  record_status: string | null;
  has_summary: boolean;
  report_count: number;
}

export interface CounselorDashboardResponse {
  counselor_id: string;
  counselor_name: string | null;
  org_id: string | null;
  org_name: string | null;
  total_classes: number;
  in_progress_classes: number;
  completed_classes: number;
  total_participants: number;
  classes: ClassSummary[];
}

export interface OrgCounselorStat {
  id: string;
  name: string;
  email: string;
  class_count: number;
  participant_count: number;
  completed_count: number;
}

export interface OrgDashboardResponse {
  org_id: string;
  org_name: string;
  org_code: string | null;
  total_counselors: number;
  total_classes: number;
  total_participants: number;
  completed_classes: number;
  in_progress_classes: number;
  counselors: OrgCounselorStat[];
  classes: ClassSummary[];
}

export const getCounselorDashboard = (): Promise<CounselorDashboardResponse> =>
  apiClient.get<CounselorDashboardResponse>('/dashboard/counselor');

export const getOrgDashboard = (): Promise<OrgDashboardResponse> =>
  apiClient.get<OrgDashboardResponse>('/dashboard/org');
