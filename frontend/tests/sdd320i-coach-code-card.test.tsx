// @vitest-environment jsdom
// 11/9 대표 지시: 코치 코드는 홈·클래스 최상단에 전체 숫자로 노출한다(가림 금지).
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UiV2CoachCodeCard } from '../src/components/ui-v2/ui-v2-coach-code-card';
import { useAuthStore } from '../src/stores/authStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
type AuthUser = NonNullable<ReturnType<typeof useAuthStore.getState>['user']>;
const setUser = (u: Partial<AuthUser> | null) => useAuthStore.setState({ user: u as AuthUser | null });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); setUser(null); });

describe('코치 코드 카드', () => {
  it('코치에게 전체 숫자를 가림 없이 보여 준다', () => {
    setUser({ role: 'counselor', counselor_code: '482913' });
    act(() => root.render(createElement(UiV2CoachCodeCard)));
    const card = host.querySelector('[data-testid="coach-code-card"]');
    expect(card?.textContent).toContain('482913');
    expect(card?.textContent).not.toContain('•');
  });
  it('코치가 아니거나 코드가 없으면 숨긴다', () => {
    setUser({ role: 'client', counselor_code: '482913' });
    act(() => root.render(createElement(UiV2CoachCodeCard)));
    expect(host.innerHTML).toBe('');
    setUser({ role: 'counselor', counselor_code: null });
    act(() => root.render(createElement(UiV2CoachCodeCard)));
    expect(host.innerHTML).toBe('');
  });
  it('홈·클래스 두 화면 최상단에 배치, 가림 문자 없음', () => {
    const home = read('src/pages/coach/ui-v2/ui-v2-coach-home-page.tsx');
    const cls = read('src/pages/coach/ui-v2/ui-v2-coach-classes-page.tsx');
    expect(home).toMatch(/<OrgRemovedNoticeDialog \/>\n\s*<UiV2CoachCodeCard \/>/);
    // 11/9: 클래스 화면은 '지금 함께할 시간'(열린 회차) 카드가 최상단, 코치 코드 카드는 그 바로 다음
    expect(cls).toMatch(/u2f-classes">\n[\s\S]*?<section aria-label="열려 있는 회차"[\s\S]*?<\/section>}\n\s*<UiV2CoachCodeCard \/>/);
    expect(home).not.toContain('••••');
  });
});
