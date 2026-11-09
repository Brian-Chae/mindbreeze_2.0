// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { syncCoachSidebarCode } from '../src/components/ui-v2/ui-v2-coach-sidebar-code';
import { useAuthStore } from '../src/stores/authStore';

describe('SDD-321 C 기관 코드 사이드바', () => {
  beforeEach(() => { document.body.innerHTML = '<div data-sidebar-profile></div>'; });
  it('기관관리자는 "기관 코드 XXXXXX" 줄이 붙는다', () => {
    useAuthStore.setState({ user: { id: 'u', role: 'org_admin', org_code: 'ABC123' } as never });
    const root = document.documentElement; root.classList.add('u2-coach');
    syncCoachSidebarCode(root);
    expect(document.querySelector('.u2-coach-sidebar-code')?.textContent).toBe('기관 코드 ABC123');
  });
  it('코치는 코치 코드 줄', () => {
    useAuthStore.setState({ user: { id: 'u', role: 'counselor', counselor_code: 'K9' } as never });
    const root = document.documentElement; root.classList.add('u2-coach');
    syncCoachSidebarCode(root);
    expect(document.querySelector('.u2-coach-sidebar-code')?.textContent).toBe('코치 코드 K9');
  });
});
