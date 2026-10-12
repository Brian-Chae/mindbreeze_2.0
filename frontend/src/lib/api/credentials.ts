// 상담사 자격 증명 API

import { apiClient } from './client';

// 인증 등급 — 백엔드 계약값('unverified' | 'email' | 'verified')의 단일 정의.
// auth.ts의 User.verified_tier 등 모든 소비처가 이 타입을 재사용한다.
export type VerifiedTier = 'unverified' | 'email' | 'verified';

export type CredentialType = 'id_card' | 'license' | 'diploma' | 'career';
export type CredentialStatus = 'pending' | 'approved' | 'rejected';

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

// SEC-06: multipart/form-data 업로드도 공통 apiClient를 사용한다.
// 토큰 첨부(Bearer)·401 refresh 재시도·에러 포맷이 apiClient.postForm에서 일괄 처리된다.
export const uploadCredential = (
  file: File,
  type: CredentialType,
  expiresAt?: string,
): Promise<CredentialItem> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
  if (expiresAt) formData.append('expires_at', expiresAt);
  return apiClient.postForm<CredentialItem>('/credentials/upload', formData);
};

export const listCredentials = (): Promise<CredentialListResponse> =>
  apiClient.get('/credentials');

export const deleteCredential = (id: string): Promise<void> =>
  apiClient.delete(`/credentials/${id}`);
