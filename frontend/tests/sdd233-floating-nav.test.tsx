// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Tabs from '../src/components/layout/BottomTabBar';
import MemberTabs from '../src/components/client/BottomTabBar';
import type { UserRole } from '../src/lib/api/auth';
const flags = vi.hoisted(() => ({ counseling: false }));
vi.mock('../src/lib/feature-flags', () => ({ isCounselingEnabled: () => flags.counseling, isAiEnabled: () => false }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: () => void;
afterEach(() => cleanup?.());
it.each([
  ['client', false, ['홈', '내 클래스', '대화', '리포트', '더보기']],
  ['client', true, ['홈', '내 클래스', '상담', '리포트', '더보기']],
  ['counselor', false, ['홈', '클래스', '리포트', '대화', '더보기']],
  ['counselor', true, ['홈', '클래스', '상담', '대화', '더보기']],
  ['org_admin', false, ['홈', '클래스', '리포트', '대화', '더보기']],
  ['platform_admin', true, ['홈', '가입 신청', '사용자', '대화', '더보기']],
  ['org_admin', true, ['홈', '클래스', '상담', '대화', '더보기']],
  ['platform_admin', false, ['홈', '가입 신청', '사용자', '대화', '더보기']],
] as [UserRole, boolean, string[]][])('%s 상담 %s 확정 다섯 탭', async (role, counseling, labels) => {
 flags.counseling = counseling;
 const el = document.createElement('div'); const root = createRoot(el);
 cleanup = () => act(() => root.unmount());
 await act(async () => root.render(<MemoryRouter initialEntries={['/app']}>
 {role === 'client' ? <MemberTabs onMoreClick={() => {}} /> : <Tabs role={role} onMoreClick={() => {}} />}
 </MemoryRouter>));
 expect([...el.querySelectorAll('nav a, nav button')].map(e => e.textContent)).toEqual(labels);
 expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('하단 메뉴');
 expect(el.querySelector('nav')?.classList.contains('floating-bottom-nav')).toBe(true);
});
it.each([
 ['/dashboard/org/team', 'org_admin', true, '홈'],
 ['/reports?status=pending', 'counselor', false, '리포트'],
 ['/reports/one', 'counselor', true, '더보기'],
 ['/app/chat/one', 'client', false, '대화'],
 ['/app/chat/one', 'client', true, '더보기'],
] as [string, UserRole, boolean, string][])('%s 활성 탭은 하나다', async (path, role, counseling, label) => {
 flags.counseling = counseling;
 const el = document.createElement('div'); const root = createRoot(el);
 cleanup = () => act(() => root.unmount());
 await act(async () => root.render(<MemoryRouter initialEntries={[path]}>{role === 'client' ? <MemberTabs onMoreClick={() => {}} /> : <Tabs role={role} onMoreClick={() => {}} />}</MemoryRouter>));
 const active = el.querySelectorAll('[aria-current="page"]');
 expect(active).toHaveLength(1);
 expect(active[0].textContent).toBe(label);
 expect(active[0].querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
 expect([...el.querySelectorAll('svg')].every(svg => svg.getAttribute('aria-hidden') === 'true')).toBe(true);
});
