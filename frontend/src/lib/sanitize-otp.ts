/** OTP 입력값에서 숫자만 남기고 길이를 자른다 */
export function sanitizeOtp(raw: string, length: number): string {
  return raw.replace(/\D/g, '').slice(0, length);
}
