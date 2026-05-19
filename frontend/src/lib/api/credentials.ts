// 상담사 자격 증명 API

import { apiClient, ApiError, tokenStorage } from './client';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api/v1';

export type CredentialType = 'id_card' | 'license' | 'diploma' | 'career';
export type CredentialStatus = 'pending' | 'approved' | 'rejected';
export type VerifiedTier = 'unverified' | 'email' | 'verified';

export interface CredentialItem {
  id: string;
  type: CredentialType;
  file_name: string;
  status: CredentialStatus;
  expires_at: string | null;
  created_at: string;
}

export interface CredentialListResponse {
  credentials: CredentialItem[];
  verified_tier: VerifiedTier;
  missing: CredentialType[];
}

// 업로드는 multipart/form-data 이므로 apiClient(JSON 전용)를 우회하여 직접 fetch 사용
export const uploadCredential = async (
  file: File,
  type: CredentialType,
  expiresAt?: string,
): Promise<CredentialItem> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
  if (expiresAt) formData.append('expires_at', expiresAt);

  const token = tokenStorage.getAccess();
  const res = await fetch(`${BASE_URL}/credentials/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    const message =
      (data && typeof data === 'object' && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string'
        ? (data as { detail: string }).detail
        : null) ?? `업로드 실패 (${res.status})`;
    throw new ApiError(res.status, message, data);
  }

  return (await res.json()) as CredentialItem;
};

export const listCredentials = (): Promise<CredentialListResponse> =>
  apiClient.get('/credentials');

export const deleteCredential = (id: string): Promise<void> =>
  apiClient.delete(`/credentials/${id}`);
