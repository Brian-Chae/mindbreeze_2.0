// 기관 공개 페이지 API (인증 불필요)

import { apiClient } from './client';
import type { ParticipantMode, SessionStatus, SessionType } from './session';

export interface OrgPublicCounselor {
  id: string;
  name: string;
  specialties: string[];
}

export interface OrgPublicClass {
  id: string;
  title: string;
  type: SessionType;
  access_code: string;
  status: SessionStatus;
  participant_mode: ParticipantMode;
  started_at: string | null;
  participant_count: number;
  max_participants: number;
}

export interface OrgPublicResponse {
  org_id: string;
  org_name: string;
  org_code: string;
  intro: string | null;
  counselors: OrgPublicCounselor[];
  classes: OrgPublicClass[];
}

export const getOrgPublic = (code: string): Promise<OrgPublicResponse> =>
  apiClient.get<OrgPublicResponse>(`/o/${encodeURIComponent(code)}`, { skipAuth: true });
