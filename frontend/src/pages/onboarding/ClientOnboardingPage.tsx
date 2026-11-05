// 이전 일반 회원 온보딩 주소를 필수정보 보완 또는 홈으로 연결한다.
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { resolvePostLoginPath } from '../../lib/auth-routing';
export default function ClientOnboardingPage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  const target = resolvePostLoginPath(user);
  return <Navigate to={target === '/onboarding/client' ? '/onboarding/client/essentials' : target} replace />;
}
