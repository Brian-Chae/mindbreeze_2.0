// 가입 정보 확인 폼의 값·제출 가능 여부 (컴포넌트와 분리해 fast-refresh 규칙을 지킨다)

import type { Consents } from '../../components/auth/ConsentCheckList';
import { checkBirthInput } from './birth-date';
import { hasRequiredConsents } from './consents';

export interface SignupInfoValue {
  /** YYYY-MM-DD(완성 전에는 빈 문자열) */
  birthDate: string;
  consents: Consents;
}

export const EMPTY_SIGNUP_INFO: SignupInfoValue = {
  birthDate: '',
  consents: { tos: false, privacy: false, sensitive: false, eeg: false, research: false },
};

/** 제출 가능 여부 — 만 14세 이상 유효한 생년월일 + 필수 동의 3종. */
export function isSignupInfoReady(value: SignupInfoValue): boolean {
  return checkBirthInput(value.birthDate.replace(/-/g, ''), 'signup') === 'ok' && hasRequiredConsents(value.consents);
}
