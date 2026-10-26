import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.looxidlabs.mindbreeze2',
  appName: 'MIND BREEZE',
  webDir: 'dist',
  plugins: {
    // iOS 는 앱이 켜져 있을 때(포그라운드) 기본적으로 알림 배너를 띄우지 않는다 — 배너·소리·배지를 허용한다.
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // Google·Apple 로그인만 쓴다. Facebook 을 끄면 cap sync 훅이 Facebook SDK(Android facebook-core 의
    // 광고 ID·AdServices 권한, iOS facebook-ios-sdk)를 빌드에서 뺀다(D7, [MB261026][FIX]).
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: true,
      },
    },
  },
};
export default config;
