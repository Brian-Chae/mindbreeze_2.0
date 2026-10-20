// 계정 탈퇴·재인증·공개 삭제 요청 API (SDD-220)

import { apiClient } from './client';

export interface ReauthRequest {
  password?: string;
  provider?: 'google' | 'apple';
  access_token?: string;
  id_token?: string;
  nonce?: string;
}

export interface ReauthResponse {
  reauth_proof: string;
  expires_in: number;
}

/** 탈퇴용 재인증 proof(5분, 1회용)를 받는다. */
export const reauthForDeletion = (payload: ReauthRequest): Promise<ReauthResponse> =>
  apiClient.post('/users/me/reauth', payload);

/** 본인 계정 즉시 탈퇴. 비밀번호 또는 재인증 proof 중 하나를 보낸다. 성공 시 204. */
export const deleteMyAccount = (body: { password?: string; reauth_proof?: string }): Promise<void> =>
  apiClient.delete<void>('/users/me', { body });

/** 비로그인 공개 삭제 요청 접수 — 계정 존재 여부와 무관하게 같은 응답. */
export const submitAccountDeletionRequest = (email: string): Promise<{ accepted: boolean }> =>
  apiClient.post('/account-deletion/requests', { email }, { skipAuth: true });
