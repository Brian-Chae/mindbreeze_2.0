import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import { useAuthStore } from './stores/authStore';

// 추후 구현 예정인 페이지 자리표시자
function Placeholder({ title }: { title: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">이 페이지는 추후 구현됩니다.</p>
      </div>
    </div>
  );
}

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
        <Route path="/register" element={<Placeholder title="회원가입" />} />
        <Route path="/forgot-password" element={<Placeholder title="비밀번호 찾기" />} />
        <Route path="/reset-password" element={<Placeholder title="비밀번호 재설정" />} />
        <Route path="/onboarding/counselor" element={<Placeholder title="상담사 온보딩" />} />
        <Route path="/onboarding/client" element={<Placeholder title="내담자 온보딩" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
