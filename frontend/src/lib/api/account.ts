// 계정 탈퇴·재인증·공개 삭제 요청 API (SDD-220)

import { apiClient } from './client';

export interface ReauthRequest {
  password?: string;
  provider?: 'google' | 'apple';
  access_token?: string;
  id_token?: string;
  nonce?: string;
  purpose?: 'account_deletion' | 'data_export';
}

export interface ReauthResponse {
  reauth_proof: string;
  expires_in: number;
}

/** 탈퇴용 재인증 proof(5분, 1회용)를 받는다. */
export const reauthForDeletion = (payload: ReauthRequest): Promise<ReauthResponse> =>
  apiClient.post('/users/me/reauth', payload);

/** 데이터 센터 반출 본인 확인용 소셜 재인증 proof(5분, 1회용, purpose=data_export). */
export const reauthForDataExport = (payload: Pick<ReauthRequest, 'provider' | 'access_token' | 'id_token' | 'nonce'>): Promise<ReauthResponse> =>
  apiClient.post('/users/me/reauth', { ...payload, purpose: 'data_export' });

/** 본인 계정 즉시 탈퇴. 비밀번호 또는 재인증 proof 중 하나를 보낸다. 성공 시 204. */
export const deleteMyAccount = (body: { password?: string; reauth_proof?: string }): Promise<void> =>
  apiClient.delete<void>('/users/me', { body });

/** 비로그인 공개 삭제 요청 접수 — 계정 존재 여부와 무관하게 같은 응답. */
export const submitAccountDeletionRequest = (email: string): Promise<{ accepted: boolean }> =>
  apiClient.post('/account-deletion/requests', { email }, { skipAuth: true });

export interface ConsentStateItem {
  agreed: boolean;
  version: string | null;
  agreed_at: string | null;
  withdrawn_at: string | null;
}

export type AccountConsentState = Record<'tos' | 'privacy' | 'sensitive' | 'eeg' | 'research', ConsentStateItem>;

/** 설정 > 개인정보: 필수·선택 동의 현재 상태 */
export const getMyConsents = (): Promise<AccountConsentState> => apiClient.get('/users/me/consents');

/** 선택 동의(뇌파 수집·연구 활용) 변경/철회. 보낸 항목만 바뀐다. 실패하면 던진다(성공으로 표시하지 않는다). */
export const updateMyConsents = (body: { eeg?: boolean; research?: boolean }): Promise<AccountConsentState> =>
  apiClient.put('/users/me/consents', body);
