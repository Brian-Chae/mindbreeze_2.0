// 온보딩 관련 API 호출

import { apiClient } from './client';

export interface OnboardingProgressResponse {
  role: 'counselor' | 'client';
  current_step: number;
  completed_steps: number[];
  data: Record<string, unknown>;
}

export interface CounselorCompleteResponse {
  counselor_code: string;
  verified_tier: string;
}

export interface ClientMatchResponse {
  counselor_id: string;
  counselor_name: string;
  matched_at: string;
}

// 상담사 온보딩
export const getOnboardingProgress = (): Promise<OnboardingProgressResponse> =>
  apiClient.get('/onboarding/progress');

export const saveCounselorStep1 = (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
  apiClient.post('/onboarding/counselor/step1', data);

export const saveCounselorStep2 = (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
  apiClient.post('/onboarding/counselor/step2', data);

export const saveCounselorStep3 = (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
  apiClient.post('/onboarding/counselor/step3', data);

export const saveCounselorStep4 = (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
  apiClient.post('/onboarding/counselor/step4', data);

export const completeCounselorOnboarding = (): Promise<CounselorCompleteResponse> =>
  apiClient.post('/onboarding/counselor/complete');

// 내담자 온보딩
export const saveClientStep1 = (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
  apiClient.post('/onboarding/client/step1', data);

export const saveClientStep2 = (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
  apiClient.post('/onboarding/client/step2', data);

export const saveClientStep3 = (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
  apiClient.post('/onboarding/client/step3', data);

export const matchClientWithCounselor = (counselorCode: string): Promise<ClientMatchResponse> =>
  apiClient.post('/onboarding/client/match', { counselor_code: counselorCode });

export const completeClientOnboarding = (): Promise<{ ok: boolean }> =>
  apiClient.post('/onboarding/client/complete');
