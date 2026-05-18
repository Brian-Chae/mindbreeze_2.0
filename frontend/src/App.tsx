import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import CounselorOnboardingPage from './pages/onboarding/CounselorOnboardingPage';
import ClientOnboardingPage from './pages/onboarding/ClientOnboardingPage';
import { useAuthStore } from './stores/authStore';

function App() {
  const initialize = useAuthStore((s) => s.initialize);

  // 앱 시작 시 localStorage에서 인증 상태 복원
  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/onboarding/counselor" element={<CounselorOnboardingPage />} />
        <Route path="/onboarding/client" element={<ClientOnboardingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
