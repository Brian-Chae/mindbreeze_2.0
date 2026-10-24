import { isCounselingEnabled } from './feature-flags';
import type { UserRole } from './api/auth';

export interface MobileMenuTab { to: string; label: string; icon: 'home' | 'calendar' | 'users' | 'report' | 'message' }
export interface SwipeSample { x: number; time: number }

/** 실제 pill과 제스처가 공유하는 메뉴 순서. 더보기는 라우트가 아니다. */
export function getMobileMenuTabs(role: UserRole | null | undefined, counseling = isCounselingEnabled()): MobileMenuTab[] {
  if (role === 'client') return [
    { to: '/app', label: '홈', icon: 'home' },
    { to: '/app/classes', label: '내 클래스', icon: 'calendar' },
    counseling ? { to: '/app/counseling', label: '상담', icon: 'users' } : { to: '/app/chat', label: '대화', icon: 'message' },
    { to: '/app/reports', label: '리포트', icon: 'report' },
  ];
  if (role !== 'counselor' && role !== 'org_admin') return [];
  return [
    { to: role === 'org_admin' ? '/dashboard/org' : '/dashboard', label: '홈', icon: 'home' },
    { to: '/classes', label: '클래스', icon: 'calendar' },
    counseling ? { to: '/counseling', label: '상담', icon: 'users' } : { to: '/reports', label: '리포트', icon: 'report' },
    { to: '/chat', label: '대화', icon: 'message' },
  ];
}
export function getSwipeRootIndex(path: string, tabs: MobileMenuTab[]): number {
  return tabs.findIndex(tab => tab.to === (path.replace(/\/+$/, '') || '/'));
}
export function getSwipeAxis(dx: number, dy: number, elapsed: number): 'pending' | 'horizontal' | 'cancel' {
  if (elapsed > 500) return 'cancel';
  if (Math.hypot(dx, dy) < 12) return 'pending';
  return Math.abs(dx) >= Math.abs(dy) * 1.5 ? 'horizontal' : 'cancel';
}
export function shouldCommitSwipe(dx: number, width: number, samples: SwipeSample[]): boolean {
  if (Math.abs(dx) >= Math.max(64, width * 0.2)) return true;
  if (Math.abs(dx) < 40 || samples.length < 2) return false;
  const last = samples[samples.length - 1];
  const first = samples.find(sample => last.time - sample.time <= 80 && last.time - sample.time >= 16);
  if (!first) return false;
  const velocity = (last.x - first.x) / (last.time - first.time);
  return Math.sign(velocity) === Math.sign(dx) && Math.abs(velocity) >= 0.5;
}
export function resistSwipe(dx: number): number { return Math.sign(dx) * Math.min(32, Math.abs(dx) * 0.22); }
