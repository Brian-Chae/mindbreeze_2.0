// 네이티브 앱(Capacitor) Google 로그인 — 시스템 계정 선택기 사용(웹 팝업 OAuth는 WebView에서 불가)
import { SocialLogin } from '@capgo/capacitor-social-login';
import { getPlatform } from './platform';

// Firebase 프로젝트(mind-breeze)의 웹 클라이언트 ID — 공개값. 서버는 id_token 의 aud 로 검증한다.
const NATIVE_WEB_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_NATIVE_WEB_CLIENT_ID ||
  '1087454235919-rn6a7tjc29g13ncjdijgv2uqmgku8ksm.apps.googleusercontent.com';

// iOS 전용 OAuth 클라이언트 ID(Firebase iOS 앱 com.looxidlabs.mindbreeze.ios, GoogleService-Info.plist 의 CLIENT_ID) — 공개값.
const NATIVE_IOS_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_NATIVE_IOS_CLIENT_ID ||
  '1087454235919-r2r01n0q2o4s1qmjcoirghvjc24jknn2.apps.googleusercontent.com';

let initialized = false;

/**
 * SocialLogin.initialize 는 공급자 설정을 한 번에 받으므로 Google/Apple 이 같은 호출을 공유한다.
 * 한쪽만 초기화하면 나중 호출이 앞 설정을 덮어쓰기 때문에, 항상 두 공급자를 함께 등록한다.
 */
export async function ensureSocialLoginInitialized(): Promise<void> {
  if (initialized) return;
  // iOS 는 iOSClientId 필수, 서버 검증용 id_token 의 aud 를 웹 클라이언트로 맞추려면 iOSServerClientId 필요.
  await SocialLogin.initialize({
    google: {
      webClientId: NATIVE_WEB_CLIENT_ID,
      iOSClientId: NATIVE_IOS_CLIENT_ID,
      iOSServerClientId: NATIVE_WEB_CLIENT_ID,
    },
    // Apple 공급자는 iOS 에서만 등록한다. Android 는 apple.android.clientId 가 없으면 initialize 전체가
    // 실패해 Google 로그인까지 막힌다("apple.android.clientId is null or empty").
    // iOS 네이티브는 redirectUrl 을 비워 둔다. authorization code 는 서버가 교환해 revoke 토큰을 확보한다.
    ...(getPlatform() === 'ios' ? { apple: { useProperTokenExchange: true, redirectUrl: '' } } : {}),
  });
  initialized = true;
}

/**
 * 네이티브 Google 로그인 후 id_token 반환. 사용자가 취소하면 예외.
 * forcePrompt: iOS GoogleSignIn 은 이전 로그인 기록이 있으면 계정 선택 없이 그 계정을 복원하므로,
 * 계정 전환(상담사 → 회원 등)이 막히지 않게 항상 계정 선택창을 띄운다.
 */
export async function nativeGoogleIdToken(): Promise<string> {
  await ensureSocialLoginInitialized();
  const res = await SocialLogin.login({ provider: 'google', options: { forcePrompt: true } });
  const result = res.result as { idToken?: string | null };
  if (!result.idToken) throw new Error('Google 인증 토큰을 받지 못했습니다.');
  return result.idToken;
}
