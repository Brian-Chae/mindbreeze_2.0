// 상담사 프로필 API 클라이언트

import { apiClient } from './client';

export interface QualificationItem {
  id?: string;
  name: string;
  issuer?: string | null;
  issued_at?: string | null;
}

export interface CareerItem {
  id?: string;
  organization: string;
  role?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  is_current: boolean;
}

export interface CounselorProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  status?: string;
  org_id?: string | null;
  org_name?: string | null;
  phone?: string | null;
  profile_image?: string | null;
  bio?: string | null;
  counselor_code?: string | null;
  // SDD-077: 개인정보(선택 입력) + 주소 + 낙관적 잠금 버전
  gender?: string | null;
  birth_date?: string | null;
  postal_code?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  affiliation_type?: string | null;
  years_of_experience?: number | null;
  specialties: string[];
  qualifications: QualificationItem[];
  careers: CareerItem[];
  version: number;
}

export interface CounselorProfileUpdate {
  name?: string;
  phone?: string | null;
  profile_image?: string | null;
  bio?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  postal_code?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  affiliation_type?: string | null;
  years_of_experience?: number | null;
  specialties?: string[];
  qualifications?: QualificationItem[];
  careers?: CareerItem[];
  version?: number;
}

export const getCounselorProfile = (): Promise<CounselorProfile> =>
  apiClient.get<CounselorProfile>('/auth/counselors/me/profile');

export const updateCounselorProfile = (
  data: CounselorProfileUpdate,
): Promise<CounselorProfile> =>
  apiClient.patch<CounselorProfile>('/auth/counselors/me/profile', data);
