import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useAuthStore } from '../../stores/authStore';
import { isNativeApp } from './platform';

/**
 * 네이티브 앱 상태바 색 동기화.
 * - 로그인 후(흰 헤더): 웹뷰를 상태바 아래에 두고 흰 배경 + 어두운 아이콘.
 * - 로그인 화면(/login): 웹뷰를 상태바 뒤까지 확장(overlay)해서 반투명 고정 헤더가 safe-area 만큼
 *   위로 이어지게 한다. 단색 상태바를 칠하면 헤더 위에 색 띠가 생긴다.
 * - 클래스 모드 화면(/class/:id/enter, /sessions/:id/player): 로그인 여부와 무관하게 웹뷰를 상태바 뒤까지 확장하고
 *   밝은 글자(Style.Dark)로 둔다. 배경(사진/그라데이션)이 상태바 뒤까지 차고, 내용은 각 화면이 env(safe-area-inset-*)로 비킨다.
 *   흰 단색 상태바를 칠하면 어두운 클래스 화면 위에 흰 띠가 생긴다.
 * - 그 밖의 로그인 전 화면: 어두운 상태바 + 밝은 아이콘(기존).
 */
/** 어두운 전체화면 배경이 상태바 뒤까지 이어져야 하는 클래스 모드 경로인지. */
export function isClassModePath(pathname: string): boolean {
  return /^\/class\/[^/]+\/enter\/?$/.test(pathname) || /^\/sessions\/[^/]+\/player\/?$/.test(pathname);
}

export function useStatusBar(): void {
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const pathname = useLocation().pathname;
  const onLogin = pathname.startsWith('/login');
  const onClass = isClassModePath(pathname);
  useEffect(() => {
    if (!isNativeApp()) return;
    const apply = async () => {
      try {
        if (onClass || (!authenticated && onLogin)) {
          await StatusBar.setOverlaysWebView({ overlay: true });
          await StatusBar.setStyle({ style: Style.Dark });
          return;
        }
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setBackgroundColor({ color: authenticated ? '#FFFFFF' : '#1F1B24' });
        await StatusBar.setStyle({ style: authenticated ? Style.Light : Style.Dark });
      } catch {
        // 상태바 제어를 지원하지 않는 환경은 무시한다.
      }
    };
    void apply();
  }, [authenticated, onLogin, onClass]);
}
