// SDD-077 상담사 정보 관리 API — 플랫폼/기관 관리자용 조회·수정 클라이언트

import { apiClient } from './client';
import type { QualificationItem, CareerItem } from './counselor';

export interface CounselorInfoDto {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  org_id: string | null;
  org_name: string | null;
  counselor_code: string | null;
  phone: string | null;
  profile_image: string | null;
  bio: string | null;
  gender: string | null;
  birth_date: string | null;
  postal_code: string | null;
  address_line1: string | null;
  address_line2: string | null;
  affiliation_type: string | null;
  years_of_experience: number | null;
  specialties: string[];
  qualifications: QualificationItem[];
  careers: CareerItem[];
  version: number;
}

export interface CounselorInfoUpdatePayload {
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
  // 관리자 수정 사유 (본인 수정에서는 미사용)
  reason?: string;
}

export interface AdminCounselorListItemDto {
  id: string;
  name: string;
  email: string;
  counselor_code: string | null;
  role: string;
  status: string;
  org_id: string | null;
  org_name: string | null;
}

export interface AdminCounselorListResponseDto {
  items: AdminCounselorListItemDto[];
  total: number;
}

export interface PrimaryAdminProfilePatchPayload {
  name?: string;
  phone?: string | null;
  reason: string;
  expected_user_id?: string;
}

export interface PrimaryAdminProfileDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
}

// --- 플랫폼 관리자 ---

export const listAdminCounselors = (
  params?: { org_id?: string; q?: string; status?: string },
): Promise<AdminCounselorListResponseDto> => {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) sp.set(key, value);
  }
  const qs = sp.toString();
  return apiClient.get<AdminCounselorListResponseDto>(`/admin/counselors${qs ? `?${qs}` : ''}`);
};

export const getAdminCounselorProfile = (userId: string): Promise<CounselorInfoDto> =>
  apiClient.get<CounselorInfoDto>(`/admin/counselors/${userId}/profile`);

export const patchAdminCounselorProfile = (
  userId: string,
  payload: CounselorInfoUpdatePayload,
): Promise<CounselorInfoDto> =>
  apiClient.patch<CounselorInfoDto>(`/admin/counselors/${userId}/profile`, payload);

export const patchPrimaryAdminProfile = (
  orgId: string,
  payload: PrimaryAdminProfilePatchPayload,
): Promise<PrimaryAdminProfileDto> =>
  apiClient.patch<PrimaryAdminProfileDto>(`/admin/orgs/${orgId}/primary-admin/profile`, payload);

// --- 기관 관리자 ---

export const getOrgCounselorProfile = (orgId: string, userId: string): Promise<CounselorInfoDto> =>
  apiClient.get<CounselorInfoDto>(`/org/${orgId}/counselors/${userId}/profile`);

export const patchOrgCounselorProfile = (
  orgId: string,
  userId: string,
  payload: CounselorInfoUpdatePayload,
): Promise<CounselorInfoDto> =>
  apiClient.patch<CounselorInfoDto>(`/org/${orgId}/counselors/${userId}/profile`, payload);
