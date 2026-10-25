import { NativeBootstrap } from './lib/native/use-push-registration';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import './mb-tokens.css'
import App from './App.tsx'
import { useAuthStore } from './stores/authStore'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { getPlatform } from './lib/native/platform'

// 플랫폼별 CSS 분기용(예: Android 하단 메뉴 여백).
document.documentElement.dataset.platform = getPlatform()

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// 라우터 청크 다운로드와 서버 세션 검증을 병렬로 시작한다. RoleGuard는 검증 완료까지 유지된다.
useAuthStore.getState().initialize()

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
