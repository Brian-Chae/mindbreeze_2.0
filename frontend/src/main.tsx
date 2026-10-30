import { NativeBootstrap } from './lib/native/use-push-registration';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import './mb-tokens.css'
import App from './App.tsx'
import { MemberStructureHomePage, MemberClassesPage } from './route-pages'
import { useAuthStore } from './stores/authStore'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { getPlatform } from './lib/native/platform'

// 플랫폼별 CSS 분기용(예: Android 하단 메뉴 여백).
document.documentElement.dataset.platform = getPlatform()

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// 라우터 청크 다운로드와 서버 세션 검증을 병렬로 시작한다. RoleGuard는 검증 완료까지 유지된다.
useAuthStore.getState().initialize()

// 첫 화면 청크를 렌더 전에 받아 둔다. 세션 검증(refresh)과 병렬이라 추가 대기가 거의 없고,
// lazy 청크가 늦게 풀리며 생기는 Suspense 폴백 노출·재공개 지연(React 약 300ms)을 피한다.
const firstScreen: Record<string, () => Promise<unknown>> = {
  '/app': () => MemberStructureHomePage.preload(),
  '/app/classes': () => MemberClassesPage.preload(),
  '/dashboard': () => import('./pages/DashboardPage'),
  '/classes': () => import('./pages/classes/host-classes-page'),
}
const preload = firstScreen[window.location.pathname.replace(/\/+$/, '') || '/']
const preloaded = preload
  ? Promise.race([preload().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1500))])
  : Promise.resolve()

void preloaded.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <GoogleOAuthProvider clientId={googleClientId || ' '}>
          <NativeBootstrap />
          <App />
        </GoogleOAuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
})
