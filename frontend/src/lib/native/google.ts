// 네이티브 앱(Capacitor) Google 로그인 — 시스템 계정 선택기 사용(웹 팝업 OAuth는 WebView에서 불가)
import { SocialLogin } from '@capgo/capacitor-social-login';

// Firebase 프로젝트(mind-breeze)의 웹 클라이언트 ID — 공개값. 서버는 id_token 의 aud 로 검증한다.
const NATIVE_WEB_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_NATIVE_WEB_CLIENT_ID ||
  '1087454235919-rn6a7tjc29g13ncjdijgv2uqmgku8ksm.apps.googleusercontent.com';

let initialized = false;

/** 네이티브 Google 로그인 후 id_token 반환. 사용자가 취소하면 예외. */
export async function nativeGoogleIdToken(): Promise<string> {
  if (!initialized) {
    await SocialLogin.initialize({ google: { webClientId: NATIVE_WEB_CLIENT_ID } });
    initialized = true;
  }
  const res = await SocialLogin.login({ provider: 'google', options: {} });
  const result = res.result as { idToken?: string | null };
  if (!result.idToken) throw new Error('Google 인증 토큰을 받지 못했습니다.');
  return result.idToken;
}
