// 어드민 API 클라이언트

import { apiClient } from './client';

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}

export interface ReviewItemDto {
  target_type: 'credential' | 'org_document';
  id: string;
  document_type: string;
  status: string;
  submitter_name: string | null;
  submitter_email: string | null;
  risk_score: number;
  ai_verdict: Record<string, unknown> | null;
  file_name: string | null;
  created_at: string | null;
}

export interface ReviewListResponse {
  items: ReviewItemDto[];
  total: number;
  page: number;
  size: number;
}

export interface ReviewDetailResponse {
  target_type: string;
  id: string;
  document_type: string;
  status: string;
  submitter_name: string | null;
  submitter_email: string | null;
  risk_score: number;
  ai_verdict: Record<string, unknown> | null;
  file_name: string | null;
  s3_key: string | null;
  created_at: string | null;
  audits: AuditDto[];
  extra?: Record<string, unknown>;
}

export interface AuditDto {
  id: string;
  action: string;
  reason: string | null;
  extra: Record<string, unknown> | null;
  created_at: string;
  admin_name?: string | null;
}

export interface PrimaryCounselorDto {
  id: string;
  name: string;
  email: string;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  suspended: boolean;
  created_at: string;
  primary_counselor?: PrimaryCounselorDto | null;
  status?: string;
}

export interface CreateAdminClientPayload {
  name: string;
  email: string;
  counselor_id: string;
  send_invite: boolean;
}

export interface CreateAdminClientResponse {
  client: UserDto;
  invite_sent: boolean;
}

export interface UserListResponse {
  items: UserDto[];
  total: number;
  page: number;
  size: number;
}

export interface ActionResponse {
  success: boolean;
  message: string;
}

export interface AdminOrganizationDto {
  id: string;
  name: string;
  org_code: string | null;
  phone: string | null;
  verified: boolean;
  kind: string;
  has_primary_admin: boolean;
  version: number;
  deactivated_at: string | null;
  created_at: string;
}

export interface AdminOrganizationCreatePayload {
  name: string;
  phone?: string;
}

export const listReviews = (
  params?: { document_type?: string; risk_level?: string; page?: number; size?: number },
): Promise<ReviewListResponse> => {
  const qs = buildQuery(params);
  return apiClient.get<ReviewListResponse>(`/admin/reviews${qs}`);
};

export const getCredentialReview = (id: string): Promise<ReviewDetailResponse> =>
  apiClient.get<ReviewDetailResponse>(`/admin/reviews/credentials/${id}`);

export const getOrgDocumentReview = (id: string): Promise<ReviewDetailResponse> =>
  apiClient.get<ReviewDetailResponse>(`/admin/reviews/org-documents/${id}`);

export const processReview = (
  targetType: string,
  targetId: string,
  action: string,
  reason?: string,
): Promise<ActionResponse> =>
  apiClient.post<ActionResponse>(`/admin/reviews/${targetType}/${targetId}/action`, {
    action,
    reason,
  });

export const batchProcessReview = (
  items: { target_type: string; target_id: string; action: string; reason?: string }[],
): Promise<ActionResponse> =>
  apiClient.post<ActionResponse>('/admin/reviews/batch', { items });

export const listUsers = (
  params?: { role?: string; q?: string; page?: number; size?: number },
): Promise<UserListResponse> => {
  const qs = buildQuery(params);
  return apiClient.get<UserListResponse>(`/admin/users${qs}`);
};

export const suspendUser = (userId: string, reason: string): Promise<ActionResponse> =>
  apiClient.post<ActionResponse>(`/admin/users/${userId}/suspend`, { reason });

export const unsuspendUser = (userId: string): Promise<ActionResponse> =>
  apiClient.post<ActionResponse>(`/admin/users/${userId}/unsuspend`);

export const deleteUser = (userId: string): Promise<void> =>
  apiClient.delete<void>(`/admin/users/${userId}`);

export const createAdminClient = (
  payload: CreateAdminClientPayload,
): Promise<CreateAdminClientResponse> =>
  apiClient.post<CreateAdminClientResponse>('/admin/clients', payload);

export const listAdminOrganizations = (status: 'active' | 'inactive' = 'active'): Promise<AdminOrganizationDto[]> =>
  apiClient.get<AdminOrganizationDto[]>(`/admin/orgs?status=${status}`);

export const createAdminOrganization = (
  payload: AdminOrganizationCreatePayload,
): Promise<AdminOrganizationDto> =>
  apiClient.post<AdminOrganizationDto>('/admin/orgs', payload);

// ---------------------------------------------------------------------------
// SDD-073: 가입 신청(기관 상담 / 개인 상담사) 관리
// ---------------------------------------------------------------------------

export interface SignupApplicationDto {
  id: string;
  application_type: 'organization' | 'individual_counselor';
  organization_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  status: 'submitted' | 'reviewing' | 'approved' | 'rejected' | 'withdrawn';
  notify_status: 'pending' | 'queued' | 'sent' | 'failed';
  created_at: string | null;
}

export interface SignupApplicationDetailDto extends SignupApplicationDto {
  inquiry: string | null;
  specialties: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  organization_id: string | null;
  user_id: string | null;
  notified_at: string | null;
}

export interface SignupApplicationListResponse {
  items: SignupApplicationDto[];
  total: number;
  page: number;
  size: number;
}

export interface SignupApplicationActionResponse {
  application: SignupApplicationDetailDto;
  invite_sent: boolean;
}

export const listSignupApplications = (
  params?: { application_type?: string; status?: string; page?: number; size?: number },
): Promise<SignupApplicationListResponse> => {
  const qs = buildQuery(params);
  return apiClient.get<SignupApplicationListResponse>(`/admin/signup-applications${qs}`);
};

export const getSignupApplication = (id: string): Promise<SignupApplicationDetailDto> =>
  apiClient.get<SignupApplicationDetailDto>(`/admin/signup-applications/${id}`);

export const approveSignupApplication = (id: string): Promise<SignupApplicationActionResponse> =>
  apiClient.post<SignupApplicationActionResponse>(`/admin/signup-applications/${id}/approve`);

export const rejectSignupApplication = (
  id: string,
  reason?: string,
): Promise<SignupApplicationActionResponse> =>
  apiClient.post<SignupApplicationActionResponse>(`/admin/signup-applications/${id}/reject`, {
    reason,
  });

export const resendSignupApplicationNotice = (
  id: string,
): Promise<SignupApplicationActionResponse> =>
  apiClient.post<SignupApplicationActionResponse>(`/admin/signup-applications/${id}/resend-notice`);


export interface OrganizationUserSummaryDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
}

export interface AdminOrganizationDetailDto extends AdminOrganizationDto {
  address: string | null;
  verified_at: string | null;
  version: number;
  primary_admin: OrganizationUserSummaryDto | null;
  owner: OrganizationUserSummaryDto | null;
}

export interface AdminOrganizationCounselorDto {
  id: string;
  name: string;
  email: string;
  counselor_code: string | null;
  role: string;
  status: string;
  is_primary_admin: boolean;
  is_owner: boolean;
}

export const getAdminOrganization = (id: string): Promise<AdminOrganizationDetailDto> =>
  apiClient.get<AdminOrganizationDetailDto>(`/admin/orgs/${id}`);

export const listAdminOrganizationCounselors = (id: string): Promise<AdminOrganizationCounselorDto[]> =>
  apiClient.get<AdminOrganizationCounselorDto[]>(`/admin/orgs/${id}/counselors`);


export interface OrganizationPatchPayload {
  name?: string;
  phone?: string | null;
  address?: string | null;
  verified?: boolean;
  reason?: string;
}
export interface OrganizationImpactDto {
  account_count: number;
  active_link_count: number;
  scheduled_session_count: number;
  ongoing_session_count: number;
  unknown_attribution_count: number;
  preserved_session_count: number;
  attribution_note: string;
  blockers: string[];
  can_deactivate: boolean;
  version: number;
}
const versionHeaders = (version: number) => ({ headers: { 'If-Match': `"${version}"` } });
export const patchAdminOrganization = (id: string, payload: OrganizationPatchPayload, version: number): Promise<AdminOrganizationDetailDto> =>
  apiClient.patch(`/admin/orgs/${id}`, payload, versionHeaders(version));
export const getOrganizationDeactivationImpact = (id: string): Promise<OrganizationImpactDto> =>
  apiClient.get(`/admin/orgs/${id}/deactivation-impact`);
export const deactivateAdminOrganization = (id: string, payload: { reason: string; confirmation_value: string }, version: number): Promise<AdminOrganizationDetailDto> =>
  apiClient.post(`/admin/orgs/${id}/deactivate`, payload, versionHeaders(version));
export const reactivateAdminOrganization = (id: string, reason: string, version: number): Promise<AdminOrganizationDetailDto> =>
  apiClient.post(`/admin/orgs/${id}/reactivate`, { reason }, versionHeaders(version));


export const patchAdminOrganizationCounselor = (
  orgId: string, userId: string, payload: { role: 'counselor' | 'org_admin'; reason: string },
): Promise<AdminOrganizationCounselorDto> =>
  apiClient.patch<AdminOrganizationCounselorDto>(`/admin/orgs/${orgId}/counselors/${userId}`, payload);

export const removeAdminOrganizationCounselor = (orgId: string, userId: string, reason: string): Promise<void> =>
  apiClient.delete<void>(`/admin/orgs/${orgId}/counselors/${userId}`, { body: { reason } });
