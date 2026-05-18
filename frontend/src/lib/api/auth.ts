// 인증 관련 API 호출

import { apiClient } from './client';

export type UserRole = 'counselor' | 'client' | 'admin';
export type VerifiedTier = 'unverified' | 'email_verified' | 'fully_verified';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  verified_tier: VerifiedTier;
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

export interface CounselorRegisterPayload {
  email: string;
  password: string;
  name: string;
  email_verify_token: string;
  consents: { tos: boolean; privacy: boolean; sensitive: boolean };
}

export interface ClientRegisterPayload {
  email: string;
  password: string;
  name: string;
  email_verify_token: string;
  consents: { tos: boolean; privacy: boolean; sensitive: boolean };
}

export const requestOtp = (email: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/otp/request', { email }, { skipAuth: true });

export const verifyOtp = (email: string, code: string): Promise<OtpVerifyResponse> =>
  apiClient.post('/auth/otp/verify', { email, code }, { skipAuth: true });

export const registerCounselor = (data: CounselorRegisterPayload): Promise<LoginResponse> =>
  apiClient.post('/auth/register/counselor', data, { skipAuth: true });

export const registerClient = (data: ClientRegisterPayload): Promise<LoginResponse> =>
  apiClient.post('/auth/register/client', data, { skipAuth: true });

export const login = (email: string, password: string): Promise<LoginResponse> =>
  apiClient.post('/auth/login', { email, password }, { skipAuth: true });

export const refreshToken = (token: string): Promise<TokenResponse> =>
  apiClient.post('/auth/refresh', { refresh_token: token }, { skipAuth: true });

export const logout = (accessToken: string, refreshToken: string): Promise<void> =>
  apiClient.post('/auth/logout', { access_token: accessToken, refresh_token: refreshToken });

export const forgotPassword = (email: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/password/forgot', { email }, { skipAuth: true });

export const resetPassword = (token: string, newPassword: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/password/reset', { token, new_password: newPassword }, { skipAuth: true });
