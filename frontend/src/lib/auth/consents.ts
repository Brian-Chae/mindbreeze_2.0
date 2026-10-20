// 가입 동의 보조 — 필수 3종 확인, 서버 제출 payload 변환

import type { ConsentPayload } from '../api/auth';

export interface ConsentState {
  tos: boolean;
  privacy: boolean;
  sensitive: boolean;
  eeg?: boolean;
  research?: boolean;
}

/** 필수 동의 3종이 모두 체크됐는지. 선택 동의(eeg/research)는 가입을 막지 않는다. */
export function hasRequiredConsents(consents: ConsentState): boolean {
  return consents.tos && consents.privacy && consents.sensitive;
}

/** 선택 동의는 체크한 것만 true — 미체크를 true 로 추정하지 않는다. */
export function toConsentPayload(consents: ConsentState): ConsentPayload {
  return {
    tos: consents.tos,
    privacy: consents.privacy,
    sensitive: consents.sensitive,
    eeg: Boolean(consents.eeg),
    research: Boolean(consents.research),
  };
}
