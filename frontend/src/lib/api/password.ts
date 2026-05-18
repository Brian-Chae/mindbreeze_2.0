/** 비밀번호 재설정 API */

import { apiClient } from "./client";

export interface PasswordForgotRequest {
  email: string;
}

export interface PasswordResetRequest {
  token: string;
  new_password: string;
}

/** 비밀번호 재설정 링크 발송 */
export async function forgotPassword(email: string): Promise<void> {
  await apiClient.post<null>("/auth/password/forgot", { email });
}

/** 재설정 토큰 검증 + 새 비밀번호 적용 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<void> {
  await apiClient.post<null>("/auth/password/reset", {
    token,
    new_password: newPassword,
  });
}
