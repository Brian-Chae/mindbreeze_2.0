// dev 전용 역할 시뮬레이션 인증 API

import { apiClient } from './client';
import type { LoginResponse } from './auth';

export type DevUserRole = 'platform_admin' | 'org_admin' | 'counselor' | 'client';

export interface DevUserItem {
  id: string;
  email: string;
  name: string;
  role: DevUserRole;
  status: string;
  org_id: string | null;
  org_name: string | null;
  onboarding_completed: boolean;
}

export interface DevUserListResponse {
  users: DevUserItem[];
}

export interface DevUserCreatePayload {
  name: string;
  email: string;
  role: DevUserRole;
}

export interface ListDevUsersParams {
  role?: DevUserRole;
  q?: string;
}

/** 시뮬레이션 유저 목록 조회 */
export function listDevUsers(params: ListDevUsersParams = {}): Promise<DevUserListResponse> {
  const search = new URLSearchParams();
  if (params.role) search.set('role', params.role);
  if (params.q) search.set('q', params.q);
  const qs = search.toString();
  const path = qs ? `/dev/auth/users?${qs}` : '/dev/auth/users';
  return apiClient.get<DevUserListResponse>(path, { skipAuth: true });
}

/** 시뮬레이션 유저 즉석 생성 */
export function createDevUser(payload: DevUserCreatePayload): Promise<DevUserItem> {
  return apiClient.post<DevUserItem>('/dev/auth/users', payload, { skipAuth: true });
}

/** user_id로 비밀번호 없이 로그인 */
export function loginDevUser(userId: string): Promise<LoginResponse> {
  return apiClient.post<LoginResponse>('/dev/auth/login', { user_id: userId }, { skipAuth: true });
}
