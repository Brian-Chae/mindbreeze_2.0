// 역할 + 인증 단계 기반 라우트 가드

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import type { UserRole } from '../../lib/api/auth';

interface RoleGuardProps {
  role?: UserRole;
  requireFullyVerified?: boolean;
  children: ReactNode;
}

export function RoleGuard({ role, requireFullyVerified = false, children }: RoleGuardProps) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  // 초기화 전에는 잠깐 빈 화면 (깜빡임 방지)
  if (!isInitialized) {
    return null;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (role && user.role !== role) {
    return <Navigate to="/" replace />;
  }

  // 미인증 상담사는 온보딩으로 강제 이동
  if (requireFullyVerified && user.verified_tier !== 'fully_verified') {
    const onboardingPath = user.role === 'counselor' ? '/onboarding/counselor' : '/onboarding/client';
    return <Navigate to={onboardingPath} replace />;
  }

  return <>{children}</>;
}
