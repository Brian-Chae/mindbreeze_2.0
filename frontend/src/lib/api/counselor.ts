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
  phone?: string | null;
  profile_image?: string | null;
  bio?: string | null;
  counselor_code?: string | null;
  affiliation_type?: string | null;
  years_of_experience?: number | null;
  specialties: string[];
  qualifications: QualificationItem[];
  careers: CareerItem[];
}

export interface CounselorProfileUpdate {
  name?: string;
  phone?: string;
  profile_image?: string;
  bio?: string;
  affiliation_type?: string;
  years_of_experience?: number;
  specialties?: string[];
  qualifications?: QualificationItem[];
  careers?: CareerItem[];
}

export const getCounselorProfile = (): Promise<CounselorProfile> =>
  apiClient.get<CounselorProfile>('/counselors/me/profile');

export const updateCounselorProfile = (
  data: CounselorProfileUpdate,
): Promise<CounselorProfile> =>
  apiClient.patch<CounselorProfile>('/counselors/me/profile', data);
