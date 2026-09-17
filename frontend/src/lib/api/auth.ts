// 인증 관련 API 호출

import { apiClient } from './client';

export type UserRole = 'counselor' | 'client' | 'admin' | 'org_admin' | 'platform_admin';
export type VerifiedTier = 'unverified' | 'email_verified' | 'fully_verified';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  verified_tier: VerifiedTier;
  onboarding_completed: boolean;
  auth_provider: string;
  counselors: Array<{ id: string; name: string; profile_image: string | null }>;
  counselor_code?: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface LoginResponse extends TokenResponse {
  user: User;
}

export interface OtpVerifyResponse {
  email_verify_token: string;
}

export interface ClientRegisterPayload {
  email: string;
  password: string;
  name: string;
  email_verify_token: string;
  consents: { tos: boolean; privacy: boolean; sensitive: boolean };
  /** 초대 링크 토큰 — 있으면 가입 시 상담사 자동 연결 */
  invite_token?: string;
  /** SDD-073: 가입 시점 개인정보 (전화번호는 선택) */
  gender?: 'male' | 'female' | 'other';
  birth_date?: string;
  phone?: string;
  /** SDD-073: 초대한 상담사 코드 (invite_token 이 있으면 생략) */
  counselor_code?: string;
}

export const requestOtp = (email: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/email/request-otp', { email }, { skipAuth: true });

export const verifyOtp = (email: string, code: string): Promise<OtpVerifyResponse> =>
  apiClient.post('/auth/email/verify-otp', { email, code }, { skipAuth: true });

export const registerClient = (data: ClientRegisterPayload): Promise<LoginResponse> =>
  apiClient.post('/auth/register/client', data, { skipAuth: true });

export const login = (email: string, password: string, role?: UserRole): Promise<LoginResponse> =>
  apiClient.post('/auth/login', { email, password, role }, { skipAuth: true });

export const refreshToken = (token: string): Promise<TokenResponse> =>
  apiClient.post('/auth/refresh', { refresh_token: token }, { skipAuth: true });

export const logout = (accessToken: string, refreshToken: string): Promise<void> =>
  apiClient.post('/auth/logout', { access_token: accessToken, refresh_token: refreshToken });

export const forgotPassword = (email: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/password/forgot', { email }, { skipAuth: true });

export const resetPassword = (token: string, newPassword: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/password/reset', { token, new_password: newPassword }, { skipAuth: true });

export interface GoogleLoginPayload {
  access_token: string;
  invite_token?: string;
  role?: string;
}

export const loginGoogle = (payload: GoogleLoginPayload): Promise<LoginResponse> =>
  apiClient.post('/auth/google', payload, { skipAuth: true });

// SDD-080: 자기 기본정보 수정 — 이름/전화/성별/생년월일만 허용 (이메일·역할 불변)
export interface UpdateUserMePayload {
  name?: string;
  phone?: string;
  gender?: 'male' | 'female' | 'other';
  birth_date?: string;
}

export const updateUserMe = (data: UpdateUserMePayload): Promise<User> =>
  apiClient.patch<User>('/auth/users/me', data);
