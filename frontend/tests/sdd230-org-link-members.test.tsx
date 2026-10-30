// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api/clients';
import ClientListPage from '../src/pages/clients/ClientListPage';
import ClientProfilePage from '../src/pages/clients/ClientProfilePage';
import { useAuthStore } from '../src/stores/authStore';

vi.mock('../src/lib/api/clients', async (orig) => {
  const actual = await orig<typeof import('../src/lib/api/clients')>();
  return {
    ...actual,
    listClients: vi.fn(),
    getClientProfile: vi.fn(),
    getClientActivity: vi.fn(),
    getClientReports: vi.fn(),
    revealClientContact: vi.fn(),
    updateMemo: vi.fn(),
  };
});
vi.mock('../src/components/layout/AppShell', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('../src/components/clients/InviteModal', () => ({ default: () => null }));
vi.mock('../src/components/clients/agent-checkin-panel', () => ({ default: () => <div data-testid="ai-panel" /> }));
vi.mock('../src/hooks/useAuth', () => ({ useRequireAuth: () => undefined, useRequireRole: () => undefined }));

const A: api.ClientListItem = {
  id: 'a', name: '윤가온', email: 'a@x.com', concerns: [], last_session_at: null,
  gender: 'female', age: 34, phone_masked: '010-****-1234', classes: [],
  counselors: [{ id: 'k1', name: '가담당' }], last_activity_at: null, last_activity_source: null,
};

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode, path = '/clients') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/clients" element={node} />
          <Route path="/clients/:id" element={node} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

function setRole(role: 'counselor' | 'org_admin') {
  useAuthStore.setState({
    user: { id: 'u1', role, name: 'n', email: 'e@x.com' } as never,
    isAuthenticated: true,
    isInitialized: true,
  } as never);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
  vi.mocked(api.listClients).mockResolvedValue({
    clients: [A], total: 1, page: 1, class_options: [], counselor_options: [{ id: 'k1', name: '가담당' }],
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const B: api.ClientListItem = { ...A, id: 'b', name: '나비회원', member_type: 'non_member' };

describe('SDD-230 회원/비회원 구분 (L8)', () => {
  it('관리자 목록에 회원/비회원 배지·필터·설명이 보이고 점수·접속 문구는 없다', async () => {
    setRole('org_admin');
    vi.mocked(api.listClients).mockResolvedValue({
      clients: [{ ...A, member_type: 'member' }, B], total: 2, page: 1, class_options: [], counselor_options: [],
    });
    await render(<ClientListPage />);
    const text = container.textContent ?? '';
    const badges = [...container.querySelectorAll('[data-testid="member-type-badge"]')].map((e) => e.textContent);
    expect(badges).toContain('회원');
    expect(badges).toContain('비회원');
    expect(text).toContain('회원 구분');
    expect(container.querySelector('[data-testid="member-type-help"]')).not.toBeNull();
    expect(text).not.toMatch(/종합점수|순위|온라인|최근 접속/);
  });

  it('회원 구분 필터는 member_type 으로 서버 재조회한다', async () => {
    setRole('org_admin');
    await render(<ClientListPage />, '/clients?member_type=non_member');
    expect(vi.mocked(api.listClients)).toHaveBeenCalledWith(expect.objectContaining({ member_type: 'non_member' }));
  });

  it('상담사 목록에는 배지·필터·설명이 없다', async () => {
    setRole('counselor');
    await render(<ClientListPage />);
    expect(container.querySelector('[data-testid="member-type-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="member-type-help"]')).toBeNull();
    expect(container.textContent).not.toContain('회원 구분');
  });

  it('상세 헤더에 비회원 배지와 설명이 보인다', async () => {
    setRole('org_admin');
    vi.mocked(api.getClientActivity).mockResolvedValue({ items: [], next_cursor: null, ai_included: false });
    vi.mocked(api.getClientReports).mockResolvedValue({ reports: [], changes: [] });
    vi.mocked(api.getClientProfile).mockResolvedValue({
      id: 'b', name: '나비회원', email: 'b@x.com', phone: null, gender: null, birth_date: null, concerns: [],
      interests: [], bio: null, profile_image_url: null, memo: null, phone_masked: null, age: null,
      memo_editable: false, member_type: 'non_member',
    });
    await render(<ClientProfilePage />, '/clients/b');
    expect(container.querySelector('[data-testid="member-type-badge"]')?.textContent).toBe('비회원');
    expect(container.querySelector('[data-testid="member-type-desc"]')?.textContent).toContain('기관 코치와 연결만');
  });
});
