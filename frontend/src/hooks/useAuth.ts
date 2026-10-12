import { loginPathForRole } from '../lib/auth-routing';
// 인증 관련 훅

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import type { UserRole } from '../lib/api/auth';

export const useAuth = () => {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  return { user, isAuthenticated, isInitialized, login, logout };
};

/**
 * 미인증 시 로그인 페이지로 리다이렉트한다.
 *
 * role 인자는 로그인 유도 경로(loginPathForRole)를 고르는 용도일 뿐,
 * "인증된 사용자의 역할 불일치" 검증·차단은 담당하지 않는다. 역할 차단이
 * 필요하면 useRequireRole을 함께 사용해야 한다(예: ClientProfilePage).
 */
export const useRequireAuth = (role?: UserRole): void => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      navigate(loginPathForRole(role), { replace: true });
    }
  }, [isInitialized, isAuthenticated, navigate, role]);
};

// 역할 불일치 시 루트로 리다이렉트. 복수 역할(예: counselor·org_admin)도 허용한다.
export const useRequireRole = (role: UserRole | UserRole[]): void => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const roles = Array.isArray(role) ? role : [role];

  useEffect(() => {
    if (!isInitialized) return;
    if (!user) {
      navigate(loginPathForRole(roles[0]), { replace: true });
      return;
    }
    if (!roles.includes(user.role)) {
      navigate('/', { replace: true });
    }
    // roles 는 렌더마다 새 배열이므로 직렬화한 키로 의존성을 안정화한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, user, roles.join(','), navigate]);
};
