import type { User, UserRole } from './api/auth';

export function resolvePostLoginPath(user: User, next: string | null = null): string {
  if (user.role === 'platform_admin') {
    if (next && /^\/admin(?:\/|\?|#|$)/.test(next) && !/[\\\s]/.test(next)) {
      const url = new URL(next, 'https://mindbreeze.local');
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return next;
    }
    return '/admin/orgs';
  }
  if (user.role === 'org_admin') return '/dashboard/org';
  if (user.role === 'counselor') return user.onboarding_completed ? '/dashboard' : '/onboarding/counselor';
  if (user.role === 'client') {
    if (user.onboarding_completed) return '/app';
    // FUNC-03: Google OAuth 가입자는 4단계 온보딩 대신 필수 정보 1페이지로 보낸다.
    // 이메일 가입자는 Step 1~2에서 필수 정보를 수집하는 4단계 온보딩을 유지한다.
    return user.auth_provider === 'google'
      ? '/onboarding/client/essentials'
      : '/onboarding/client';
  }
  return '/';
}

export function loginPathForRole(role?: UserRole): string {
  return `/login?role=${role && role !== 'admin' ? role : 'client'}`;
}
