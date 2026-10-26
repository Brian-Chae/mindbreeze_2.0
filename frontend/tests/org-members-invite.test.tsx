// @vitest-environment jsdom
// 기관 구성원 페이지 상담사 초대 + 대시보드 공용 컴포넌트 회귀
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  inviteCounselor: vi.fn(),
  resendCounselorInvite: vi.fn(),
  listCounselors: vi.fn(),
}));

vi.mock('../src/components/layout/AppShell', () => ({
  default: ({ rightSlot, children }: { rightSlot?: ReactNode; children?: ReactNode }) =>
    createElement('div', null, rightSlot, children),
}));
vi.mock('../src/lib/api/dashboard', () => ({
  getOrgDashboard: vi.fn().mockResolvedValue({
    org_id: 'org-1', org_name: '기관', org_code: 'ABC', counselors: [], classes: [],
  }),
}));
vi.mock('../src/lib/api/org', async (orig) => ({
  ...(await orig<object>()),
  inviteCounselor: api.inviteCounselor,
  resendCounselorInvite: api.resendCounselorInvite,
  listCounselors: api.listCounselors,
  getCounselorActivity: vi.fn(),
  suspendCounselor: vi.fn(),
  unsuspendCounselor: vi.fn(),
}));

import OrgCounselorsPage from '../src/pages/org/OrgCounselorsPage';
import OrgDashboardPage from '../src/pages/OrgDashboardPage';

let root: Root;
let container: HTMLDivElement;
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const text = (): string => container.textContent ?? '';
const byText = (sel: string, t: string): HTMLElement | null =>
  [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.trim() === t) ?? null;
const typeInto = async (el: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const pendingItem = {
  id: 'u2', name: '대기상담사', email: 'p@x.com', role: 'counselor', status: 'pending',
  invited_at: '2026-10-20T00:00:00Z', invite_expires_at: '2999-01-01T00:00:00Z', invite_type: 'new_account',
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  api.inviteCounselor.mockReset().mockResolvedValue({});
  api.resendCounselorInvite.mockReset().mockResolvedValue({});
  api.listCounselors.mockReset().mockResolvedValue([]);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const mountMembers = async (): Promise<void> => {
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(OrgCounselorsPage))));
  await flush();
};

describe('기관 구성원 페이지 상담사 초대', () => {
  it('상단 액션에 상담사 초대 주 버튼이 있고 누르면 폼이 열린다', async () => {
    await mountMembers();
    const btn = byText('button[data-header-action="primary"]', '상담사 초대');
    expect(btn).not.toBeNull();
    expect(container.querySelector('input[type="email"]')).toBeNull();
    await act(async () => { btn!.click(); });
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('초대 발송 시 API 호출 후 구성원 목록을 다시 불러온다', async () => {
    await mountMembers();
    await act(async () => { byText('button', '상담사 초대')!.click(); });
    const before = api.listCounselors.mock.calls.length;
    api.listCounselors.mockResolvedValue([pendingItem]);
    await typeInto(container.querySelector<HTMLInputElement>('input[type="text"][placeholder="홍길동"]')!, ' 홍길동 ');
    await typeInto(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'hong@example.com');
    await act(async () => { byText('button', '초대 발송')!.click(); });
    await flush();
    expect(api.inviteCounselor).toHaveBeenCalledWith('org-1', { name: '홍길동', email: 'hong@example.com' });
    expect(api.listCounselors.mock.calls.length).toBeGreaterThan(before);
    expect(text()).toContain('대기상담사');
    expect(text()).toContain('대기');
  });

  it('잘못된 이메일은 API 호출 없이 오류를 보인다', async () => {
    await mountMembers();
    await act(async () => { byText('button', '상담사 초대')!.click(); });
    await typeInto(container.querySelector<HTMLInputElement>('input[type="text"][placeholder="홍길동"]')!, '홍길동');
    await typeInto(container.querySelector<HTMLInputElement>('input[type="email"]')!, 'bad');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.inviteCounselor).not.toHaveBeenCalled();
    expect(text()).toContain('올바른 이메일을 입력해주세요.');
  });
});

describe('대시보드 상담사 초대(공용 컴포넌트) 회귀', () => {
  it('초대 폼·현황·재발송이 기존대로 동작한다', async () => {
    api.listCounselors.mockResolvedValue([pendingItem]);
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(OrgDashboardPage))));
    await flush();
    expect(text()).toContain('초대·가입 현황');
    expect(text()).toContain('대기상담사');
    await act(async () => { byText('button', '재발송')!.click(); });
    await flush();
    expect(api.resendCounselorInvite).toHaveBeenCalledWith('org-1', 'u2');
    expect(text()).toContain('초대 메일을 다시 발송했습니다.');
  });
});
