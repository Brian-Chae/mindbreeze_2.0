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

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  suspended: boolean;
  created_at: string;
}

export interface UserListResponse {
  users: UserDto[];
  total: number;
  page: number;
  size: number;
}

export interface ActionResponse {
  success: boolean;
  message: string;
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
