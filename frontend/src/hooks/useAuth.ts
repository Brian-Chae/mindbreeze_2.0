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

// 미인증 시 로그인 페이지로 리다이렉트
export const useRequireAuth = (): void => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  useEffect(() => {
    if (isInitialized && !isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isInitialized, isAuthenticated, navigate]);
};

// 역할 불일치 시 루트로 리다이렉트
export const useRequireRole = (role: UserRole): void => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  useEffect(() => {
    if (!isInitialized) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    if (user.role !== role) {
      navigate('/', { replace: true });
    }
  }, [isInitialized, user, role, navigate]);
};
