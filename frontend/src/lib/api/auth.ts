// 인증 관련 API 호출

import { apiClient, getNativeRefreshBody } from './client';
import type { VerifiedTier } from './credentials';

export type UserRole = 'counselor' | 'client' | 'admin' | 'org_admin' | 'platform_admin';
// 인증 등급은 credentials.ts(백엔드 계약)의 단일 정의를 재사용한다.
export type { VerifiedTier };

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
  refresh_token?: string | null;
  token_type: string;
}

export interface LoginResponse extends TokenResponse {
  user: User;
}

export interface OtpVerifyResponse {
  email_verify_token: string;
}

/** 필수 3종 + 선택 2종(eeg/research). 선택은 미전달 시 서버가 거부로 기록한다. */
export interface ConsentPayload {
  tos: boolean;
  privacy: boolean;
  sensitive: boolean;
  eeg?: boolean;
  research?: boolean;
}

/** 서버 오류 detail.code (예: AGE_RESTRICTED, ACCOUNT_DELETION_PENDING). 없으면 null. */
export function apiErrorCode(err: unknown): string | null {
  const data = (err as { data?: { detail?: { code?: unknown } } } | null)?.data;
  const code = data?.detail?.code;
  return typeof code === 'string' ? code : null;
}

export interface ClientRegisterPayload {
  email: string;
  password: string;
  name: string;
  email_verify_token: string;
  consents: ConsentPayload;
  /** 초대 링크 토큰 — 있으면 가입 시 상담사 자동 연결 */
  invite_token?: string;
  /** SDD-073: 가입 시점 개인정보 (전화번호는 선택) */
  gender?: 'male' | 'female' | 'other';
  birth_date?: string;
  phone?: string;
  /** SDD-073: 초대한 상담사 코드 (invite_token 이 있으면 생략) */
  counselor_code?: string;
  /** 로그인 상태 유지 — true면 14일 영속 세션, false면 브라우저 종료 시 소멸 */
  remember_me?: boolean;
}

export const requestOtp = (email: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/email/request-otp', { email }, { skipAuth: true });

export const verifyOtp = (email: string, code: string): Promise<OtpVerifyResponse> =>
  apiClient.post('/auth/email/verify-otp', { email, code }, { skipAuth: true });

export const registerClient = (
  data: ClientRegisterPayload,
  rememberMe: boolean = true,
): Promise<LoginResponse> =>
  apiClient.post('/auth/register/client', { ...data, remember_me: rememberMe }, { skipAuth: true });

export const login = (
  email: string,
  password: string,
  role?: UserRole,
  rememberMe: boolean = true,
): Promise<LoginResponse> =>
  apiClient.post('/auth/login', { email, password, role, remember_me: rememberMe }, { skipAuth: true });

export const refreshToken = (): Promise<TokenResponse> =>
  apiClient.post('/auth/refresh', undefined, { skipAuth: true });

export const logout = (): Promise<void> => apiClient.post('/auth/logout', getNativeRefreshBody());

export const forgotPassword = (email: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/password/forgot', { email }, { skipAuth: true });

export const resetPassword = (token: string, newPassword: string): Promise<{ ok: boolean }> =>
  apiClient.post('/auth/password/reset', { token, new_password: newPassword }, { skipAuth: true });

export interface GoogleLoginPayload {
  /** 웹: access_token / 네이티브 앱: id_token (둘 중 하나) */
  access_token?: string;
  id_token?: string;
  invite_token?: string;
  role?: string;
  /** SEC-04: 신규 가입 시 약관·민감정보 동의 (기존 사용자 로그인은 불필요) */
  consents?: ConsentPayload;
  /** SDD-220: 신규 가입 시 생년월일(만 14세 확인). 기존 사용자 로그인에는 불필요 */
  birth_date?: string;
  /** 로그인 상태 유지 — true면 14일 영속 세션, false면 브라우저 종료 시 소멸 */
  remember_me?: boolean;
}

export const loginGoogle = (payload: GoogleLoginPayload, rememberMe: boolean = true): Promise<LoginResponse> =>
  apiClient.post('/auth/google', { ...payload, remember_me: rememberMe }, { skipAuth: true });

export interface AppleLoginPayload {
  id_token: string;
  nonce: string;
  authorization_code?: string;
  name?: string;
  invite_token?: string;
  role?: string;
  consents?: ConsentPayload;
  birth_date?: string;
  remember_me?: boolean;
}

/** 서버가 발급하는 일회용 nonce — Apple 로그인 요청에 묶인다. */
export const requestAppleChallenge = (): Promise<{ nonce: string; expires_in: number }> =>
  apiClient.post('/auth/apple/challenge', undefined, { skipAuth: true });

export const loginApple = (payload: AppleLoginPayload, rememberMe: boolean = true): Promise<LoginResponse> =>
  apiClient.post('/auth/apple', { ...payload, remember_me: rememberMe }, { skipAuth: true });

// SDD-080: 자기 기본정보 수정 — 이름/전화/성별/생년월일만 허용 (이메일·역할 불변)
export interface UpdateUserMePayload {
  name?: string;
  phone?: string;
  gender?: 'male' | 'female' | 'other';
  birth_date?: string;
}

export const updateUserMe = (data: UpdateUserMePayload): Promise<User> =>
  apiClient.patch<User>('/auth/users/me', data);
