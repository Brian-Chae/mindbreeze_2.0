// 로그아웃 시 소셜 공급자 쪽 세션을 정리한다 — 정리하지 않으면 다음 Google 로그인이 이전 계정을 그대로 재사용해
// 상담사 → 회원처럼 다른 유형의 계정으로 전환할 때 로그인이 막힌다.
import { SocialLogin } from '@capgo/capacitor-social-login';
import { googleLogout } from '@react-oauth/google';
import { isNativeApp } from './platform';
import { ensureSocialLoginInitialized } from './google';

/** 네이티브 Google/Apple 로그인 상태와 웹 GIS 자동 선택을 해제한다. 실패해도 로그아웃을 막지 않는다. */
export async function clearSocialSessions(): Promise<void> {
  try {
    // 웹 GIS 의 자동 선택(One Tap·이전 계정 재사용) 해제 — 네이티브 WebView 에서도 무해하다.
    googleLogout();
  } catch {
    // GIS 스크립트가 로드되지 않은 화면에서는 무시한다.
  }
  if (!isNativeApp()) return;
  try {
    await ensureSocialLoginInitialized();
  } catch {
    return;
  }
  for (const provider of ['google', 'apple'] as const) {
    try {
      await SocialLogin.logout({ provider });
    } catch {
      // 해당 공급자로 로그인한 적이 없으면 거부된다 — 정상.
    }
  }
}
