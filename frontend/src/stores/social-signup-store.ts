// 소셜 신규 가입 대기 상태 — 인증은 끝났지만 생년월일·동의가 필요한 사용자를 /signup/confirm 으로 넘긴다.
// 인증 자격(토큰)은 메모리에만 두고 localStorage·sessionStorage·URL 에는 남기지 않는다(새로고침 시 폐기).

import { create } from 'zustand';

export type SocialCredential =
  | { provider: 'google'; tokenKind: 'access_token' | 'id_token'; token: string }
  | { provider: 'apple'; idToken: string; nonce: string; authorizationCode?: string; name?: string };

export interface PendingSocialSignup {
  credential: SocialCredential;
  /** 로그인 의도 역할(회원 가입 흐름은 client) */
  role?: string;
  inviteToken?: string;
  rememberMe: boolean;
  /** 초대 링크로 들어온 경우 가입 후 연결 확인 단계로 보내기 위한 상담사 코드 */
  inviteCode?: string;
}

interface SocialSignupState {
  pending: PendingSocialSignup | null;
  begin: (pending: PendingSocialSignup) => void;
  clear: () => void;
}

export const useSocialSignupStore = create<SocialSignupState>((set) => ({
  pending: null,
  begin: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
}));
