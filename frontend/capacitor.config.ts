import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.looxidlabs.mindbreeze',
  appName: 'MIND BREEZE',
  webDir: 'dist',
  plugins: {
    // iOS 는 앱이 켜져 있을 때(포그라운드) 기본적으로 알림 배너를 띄우지 않는다 — 배너·소리·배지를 허용한다.
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};
export default config;
