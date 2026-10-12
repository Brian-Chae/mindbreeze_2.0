import { useEffect } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useAuthStore } from '../../stores/authStore';
import { isNativeApp } from './platform';

/**
 * 네이티브 앱 상태바 색 동기화.
 * 로그인 후(흰 헤더) = 흰 배경 + 어두운 아이콘, 로그인 전(어두운 배경 화면) = 어두운 배경 + 밝은 아이콘.
 */
export function useStatusBar(): void {
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    if (!isNativeApp()) return;
    const apply = async () => {
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setBackgroundColor({ color: authenticated ? '#FFFFFF' : '#1F1B24' });
        await StatusBar.setStyle({ style: authenticated ? Style.Light : Style.Dark });
      } catch {
        // 상태바 제어를 지원하지 않는 환경은 무시한다.
      }
    };
    void apply();
  }, [authenticated]);
}
