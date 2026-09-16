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
  if (user.role === 'client') return user.onboarding_completed ? '/app' : '/onboarding/client';
  return '/';
}

export function loginPathForRole(role?: UserRole): string {
  return `/login?role=${role && role !== 'admin' ? role : 'client'}`;
}
