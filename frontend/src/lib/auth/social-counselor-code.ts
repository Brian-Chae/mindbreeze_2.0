// SDD-309 — 소셜 신규 가입의 초대 코치 코드(6자리 숫자) 입력 규칙·오류 문구.
// 이메일 가입(RegisterClientPage)과 같은 규칙·문구를 쓴다.

export const SOCIAL_COUNSELOR_CODE_LENGTH = 6;

/** 숫자만 남기고 6자리로 자른다. */
export function sanitizeCounselorCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, SOCIAL_COUNSELOR_CODE_LENGTH);
}

/** 초대 링크(invite_token)로 들어왔으면 코드 입력을 면제한다. */
export function isCounselorCodeRequired(inviteToken: string | undefined): boolean {
  return !inviteToken;
}

/** 제출 가능 여부 — 코드가 필요한 경우 6자리가 채워져야 한다. */
export function isCounselorCodeReady(inviteToken: string | undefined, code: string): boolean {
  return !isCounselorCodeRequired(inviteToken) || code.length === SOCIAL_COUNSELOR_CODE_LENGTH;
}

/** 서버 오류 → 코드칸 아래 안내. 코드 문제가 아니면 null. */
export function counselorCodeErrorMessage(errorCode: string | null, status: number | null, serverMessage: string): string | null {
  if (errorCode === 'COUNSELOR_CODE_REQUIRED') return '코치 코드를 확인해주세요. 코드가 없다면 초대한 코치에게 요청해 주세요.';
  if (status === 404) return serverMessage || '코치 코드를 찾을 수 없습니다';
  if (status === 400 && /코치 코드/.test(serverMessage)) return serverMessage;
  if (status === 403 && /코치/.test(serverMessage)) return serverMessage;
  return null;
}
