// 온보딩 관련 API 호출

import { apiClient } from './client';

export interface OnboardingProgressResponse {
  current_step: number;
  step_data: Record<string, unknown>;
  completed: boolean;
}

export interface CounselorCompleteResponse {
  counselor_code: string;
  verified_tier: string;
}

export interface MatchedCounselor {
  name: string;
  counselor_code: string;
  specialties: string[];
}

export interface ClientMatchResponse {
  matched_counselor: MatchedCounselor;
}

// 상담사 온보딩
export const getOnboardingProgress = (): Promise<OnboardingProgressResponse> =>
  apiClient.get('/onboarding/me');

export const saveCounselorStep1 = (data: Record<string, unknown>): Promise<OnboardingProgressResponse> =>
  apiClient.put('/onboarding/counselor/step1', data);

export const saveCounselorStep2 = (data: Record<string, unknown>): Promise<OnboardingProgressResponse> =>
  apiClient.put('/onboarding/counselor/step2', data);

export const saveCounselorStep3 = (data: Record<string, unknown>): Promise<OnboardingProgressResponse> =>
  apiClient.put('/onboarding/counselor/step3', data);

export const saveCounselorStep4 = (data: Record<string, unknown>): Promise<OnboardingProgressResponse> =>
  apiClient.put('/onboarding/counselor/step4', data);

export const completeCounselorOnboarding = (): Promise<CounselorCompleteResponse> =>
  apiClient.post('/onboarding/counselor/complete');

// 내담자 온보딩
export const saveClientStep1 = (data: Record<string, unknown>): Promise<OnboardingProgressResponse> =>
  apiClient.put('/onboarding/client/step1', data);

export const saveClientStep2 = (data: Record<string, unknown>): Promise<OnboardingProgressResponse> =>
  apiClient.put('/onboarding/client/step2', data);

export const saveClientStep3 = (data: Record<string, unknown>): Promise<OnboardingProgressResponse> =>
  apiClient.put('/onboarding/client/step3', data);

export const matchClientWithCounselor = (counselorCode: string): Promise<ClientMatchResponse> =>
  apiClient.post('/onboarding/client/step4-match', { counselor_code: counselorCode });

export const completeClientOnboarding = (): Promise<OnboardingProgressResponse> =>
  apiClient.post('/onboarding/client/complete');
