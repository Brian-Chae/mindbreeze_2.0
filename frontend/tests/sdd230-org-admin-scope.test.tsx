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

describe('SDD-230 기관관리자 범위 (A10)', () => {
  it('기관관리자 목록에는 담당 상담사 열·필터가 보이고 점수·접속 문구는 없다', async () => {
    setRole('org_admin');
    await render(<ClientListPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('담당 코치');
    expect(text).toContain('가담당');
    expect(container.querySelectorAll('select').length).toBeGreaterThanOrEqual(4);
    expect(text).not.toMatch(/종합점수|순위|온라인|최근 접속/);
  });

  it('상담사 목록에는 담당 상담사 열·필터가 없다', async () => {
    setRole('counselor');
    await render(<ClientListPage />);
    expect(container.textContent).not.toContain('담당 코치');
  });

  it('관리자 필터 선택 시 counselor_id 로 서버 재조회', async () => {
    setRole('org_admin');
    await render(<ClientListPage />, '/clients?counselor=k1');
    expect(vi.mocked(api.listClients)).toHaveBeenCalledWith(expect.objectContaining({ counselor_id: 'k1' }));
  });

  it('비연결 기관 회원 상세는 메모 영역을 숨기고, 연결 회원이면 보인다', async () => {
    setRole('org_admin');
    const base = {
      id: 'a', name: '윤가온', email: 'a@x.com', phone: null, gender: null, birth_date: null,
      concerns: [], interests: [], bio: null, profile_image_url: null, memo: null, phone_masked: null, age: null,
    };
    vi.mocked(api.getClientActivity).mockResolvedValue({ items: [], next_cursor: null, ai_included: false });
    vi.mocked(api.getClientReports).mockResolvedValue({ reports: [], changes: [] });
    vi.mocked(api.getClientProfile).mockResolvedValue({ ...base, memo_editable: false });
    await render(<ClientProfilePage />, '/clients/a');
    expect(container.querySelector('[aria-label="코치 비공개 메모"]')).toBeNull();
    expect(container.querySelector('[data-testid="ai-panel"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    vi.mocked(api.getClientProfile).mockResolvedValue({ ...base, memo_editable: true });
    await render(<ClientProfilePage />, '/clients/a');
    expect(container.querySelector('[aria-label="코치 비공개 메모"]')).not.toBeNull();
  });
});
