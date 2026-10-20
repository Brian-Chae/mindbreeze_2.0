// 네이티브 앱(iOS) Sign in with Apple — @capgo/capacitor-social-login 의 Apple 공급자 사용
import { SocialLogin } from '@capgo/capacitor-social-login';
import { getPlatform } from './platform';
import { ensureSocialLoginInitialized } from './google';

export interface AppleCredential {
  idToken: string;
  /** 서버가 발급한 nonce 원문 — 서버가 id_token claim 과 대조한다. */
  nonce: string;
  authorizationCode?: string;
  /** Apple 은 이름을 최초 인증 때만 주므로 있으면 그대로 서버에 넘긴다. */
  name?: string;
}

/** iOS 네이티브에서만 Apple 로그인을 제공한다(웹 플로우는 서비스 ID 등록 후 별도 연결). */
export function isAppleLoginAvailable(): boolean {
  return getPlatform() === 'ios';
}

/** 서버 발급 nonce 로 Apple 로그인 시트를 띄우고 자격 증명을 반환한다. 취소하면 예외. */
export async function nativeAppleCredential(nonce: string): Promise<AppleCredential> {
  await ensureSocialLoginInitialized();
  const res = await SocialLogin.login({
    provider: 'apple',
    options: { scopes: ['name', 'email'], nonce },
  });
  const result = res.result as {
    idToken?: string | null;
    authorizationCode?: string;
    profile?: { givenName?: string | null; familyName?: string | null };
  };
  if (!result.idToken) throw new Error('Apple 인증 토큰을 받지 못했습니다.');
  const given = result.profile?.givenName ?? '';
  const family = result.profile?.familyName ?? '';
  const name = `${family}${given}`.trim() || undefined;
  return { idToken: result.idToken, nonce, authorizationCode: result.authorizationCode, name };
}
