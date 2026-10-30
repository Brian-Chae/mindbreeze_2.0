import { loginPathForRole } from '../../lib/auth-routing';
// 역할 + 인증 단계 기반 라우트 가드

import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { resolvePostLoginPath } from '../../lib/auth-routing';
import { useAuthStore } from '../../stores/authStore';
import type { UserRole } from '../../lib/api/auth';

interface RoleGuardProps {
  role?: UserRole | UserRole[];
  requireFullyVerified?: boolean;
  /** 'notice': 역할이 다르면 홈으로 튕기지 않고 "이 화면은 ○○용이에요" 안내와 내 홈 이동 버튼을 보여 준다(온보딩 화면용). */
  onMismatch?: 'redirect' | 'notice';
  children: ReactNode;
}

export function RoleGuard({ role, requireFullyVerified = false, onMismatch = 'redirect', children }: RoleGuardProps) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  // 초기화 전에는 잠깐 빈 화면 (깜빡임 방지)
  if (!isInitialized) {
    return null;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to={loginPathForRole(Array.isArray(role) ? role[0] : role)} replace />;
  }

  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    if (!roles.includes(user.role)) {
      if (onMismatch === 'notice') {
        const targetLabel = roles.includes('client') ? '회원' : roles.includes('counselor') ? '상담사' : '다른 계정';
        const currentLabel = user.role === 'client' ? '회원' : user.role === 'counselor' ? '상담사' : user.role === 'org_admin' ? '기관 관리자' : '관리자';
        return (
          <div className="grid min-h-screen place-items-center bg-[#F7F2FA] p-6">
            <main role="alert" className="w-full max-w-[420px] rounded-3xl bg-white p-6 text-center shadow-xl">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[#F3E9F8] text-xl font-bold text-[#5F0080]" aria-hidden="true">!</div>
              <h1 className="text-xl font-bold text-[#1F1F1F]">이 화면은 {targetLabel}용이에요</h1>
              <p className="mt-2 text-sm text-[#6F6F6F]">현재 로그인한 {currentLabel} 계정의 홈에서 계속해 주세요.</p>
              <Link to={resolvePostLoginPath(user)} className="mt-5 flex h-[52px] items-center justify-center rounded-full bg-[#5F0080] text-[15px] font-semibold text-white hover:bg-[#4B0066]">내 홈으로</Link>
            </main>
          </div>
        );
      }
      return <Navigate to="/" replace />;
    }
  }

  // 미인증 상담사는 온보딩으로 강제 이동
  if (requireFullyVerified && user.verified_tier !== 'verified') {
    const onboardingPath = user.role === 'counselor' ? '/onboarding/counselor' : '/onboarding/client';
    return <Navigate to={onboardingPath} replace />;
  }

  return <>{children}</>;
}
