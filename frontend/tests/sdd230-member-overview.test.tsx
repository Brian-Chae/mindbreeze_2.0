// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api/clients';
import { groupClients, uniqueClientCount, formatKst, genderLabel, ageLabel } from '../src/lib/clients/overview';
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
  default: ({ children, rightSlot }: { children: ReactNode; rightSlot?: ReactNode }) => (
    <main>{rightSlot}{children}</main>
  ),
}));
vi.mock('../src/components/clients/InviteModal', () => ({ default: () => null }));
vi.mock('../src/components/clients/agent-checkin-panel', () => ({
  default: () => <div data-testid="ai-panel">AI 안부</div>,
}));
vi.mock('../src/hooks/useAuth', () => ({ useRequireAuth: () => undefined, useRequireRole: () => undefined }));

const A: api.ClientListItem = {
  id: 'a', name: '윤가온', email: 'a@x.com', concerns: [], last_session_at: null,
  gender: 'female', age: 34, phone_masked: '010-****-1234',
  classes: [{ id: 'c1', title: '아침 명상' }, { id: 'c2', title: '수면 클래스' }],
  last_activity_at: '2026-10-21T01:10:00Z', last_activity_source: '수업·상담 참여',
};
const B: api.ClientListItem = {
  id: 'b', name: '박하늘', email: 'b@x.com', concerns: [], last_session_at: null,
  gender: null, age: null, phone_masked: null, classes: [],
  last_activity_at: null, last_activity_source: null,
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
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useAuthStore.setState({
    isAuthenticated: true,
    isInitialized: true,
    user: { id: 'u', role: 'counselor', name: '김상담', email: 'c@x.com' } as never,
  });
  vi.mocked(api.listClients).mockResolvedValue({ clients: [A, B], total: 2, page: 1, class_options: [{ id: 'c1', title: '아침 명상' }] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

const btn = (label: string) => {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(el, label).toBeDefined();
  return el as HTMLButtonElement;
};

describe('순수 함수', () => {
  it('V15 복수 클래스 회원은 각 그룹에 표시하고 고유 수는 ID 기준, 미소속 마지막', () => {
    const groups = groupClients([A, B], 'class');
    expect(groups.map((g) => g.title)).toEqual(['수면 클래스', '아침 명상', '미소속']);
    expect(groups.reduce((n, g) => n + g.clients.length, 0)).toBe(3);
    expect(uniqueClientCount(groups)).toBe(2);
    expect(groupClients([A, B], 'none')).toHaveLength(1);
  });
  it('라벨·KST 표기', () => {
    expect(genderLabel(null)).toBe('미입력');
    expect(genderLabel('female')).toBe('여');
    expect(ageLabel(0)).toBe('만 0세');
    expect(ageLabel(null)).toBe('미입력');
    expect(formatKst('2026-10-21T15:30:00Z', new Date('2026-10-22T00:00:00Z'))).toBe('10.22 00:30');
    expect(formatKst(null)).toBe('기록 없음');
  });
});

describe('목록 화면', () => {
  it('V14 최초 표, 카드 전환 시 검색어 유지, 이름은 링크, 접속 열 없음, 점수 없음', async () => {
    await render(<ClientListPage />, '/clients?q=%EC%9C%A4');
    expect(container.querySelector('table')).not.toBeNull();
    expect(btn('표').getAttribute('aria-pressed')).toBe('true');
    expect(vi.mocked(api.listClients).mock.calls[0][0]).toMatchObject({ q: '윤' });
    const input = container.querySelector('input[aria-label="회원 검색"]') as HTMLInputElement;
    expect(input.value).toBe('윤');
    const link = container.querySelector('a[href="/clients/a"]');
    expect(link?.textContent).toContain('윤가온');
    expect(container.textContent).toContain('010-****-1234');
    expect(container.textContent).toContain('만 34세');
    // V17
    expect(container.textContent).not.toMatch(/온라인|최근 접속|점수|종합|순위|등급/);

    await act(async () => btn('카드').click());
    expect(container.querySelector('table')).toBeNull();
    expect(btn('카드').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('mb_clients_view')).toBe('cards');
    expect((container.querySelector('input[aria-label="회원 검색"]') as HTMLInputElement).value).toBe('윤');
    expect(container.textContent).toContain('윤가온');
  });

  it('필터는 서버 파라미터로 전달되고 초기화가 동작한다', async () => {
    await render(<ClientListPage />, '/clients?class=c1&days=30&group=class');
    const call = vi.mocked(api.listClients).mock.calls[0][0]!;
    expect(call).toMatchObject({ class_id: 'c1', active_within_days: 30, size: 100 });
    expect(container.textContent).toContain('고유 2명');
    expect(container.textContent).toContain('미소속');
    await act(async () => btn('필터 초기화').click());
    const last = vi.mocked(api.listClients).mock.calls.at(-1)![0]!;
    expect(last.class_id).toBeUndefined();
    expect(last.active_within_days).toBeUndefined();
  });

  it('빈 결과·오류 재시도 상태', async () => {
    vi.mocked(api.listClients).mockResolvedValueOnce({ clients: [], total: 0, page: 1, class_options: [] });
    await render(<ClientListPage />, '/clients?q=zzz');
    expect(container.textContent).toContain('조건에 맞는 회원이 없습니다');
    await act(async () => root.unmount());
    root = createRoot(container);
    vi.mocked(api.listClients).mockRejectedValueOnce(new Error('x')).mockResolvedValue({ clients: [A], total: 1, page: 1 });
    await render(<ClientListPage />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => btn('다시 시도').click());
    expect(container.textContent).toContain('윤가온');
  });
});

describe('상세 화면', () => {
  const profile: api.ClientProfile = {
    id: 'a', name: '윤가온', email: 'a@x.com', phone: null, phone_masked: '010-****-1234',
    gender: 'female', birth_date: null, age: 34, concerns: ['수면'], interests: [], bio: null,
    profile_image_url: null, memo: '메모',
  };
  beforeEach(() => {
    vi.mocked(api.getClientProfile).mockResolvedValue(profile);
    vi.mocked(api.getClientActivity).mockResolvedValue({
      items: [{ id: 'e1', type: 'session', occurred_at: '2026-10-20T01:00:00Z', title: '아침 명상', class_title: '아침 명상', session_id: 's', note: null }],
      next_cursor: null, ai_included: false,
    });
    vi.mocked(api.getClientReports).mockResolvedValue({
      reports: [{ id: 'r1', session_id: 's', title: '1회차', type: 'client', type_label: '회원용', status: 'completed', status_label: '승인됨', occurred_at: '2026-10-20T01:00:00Z', created_at: null }],
      changes: [{ report_id: 'r1', title: '1회차', occurred_at: '2026-10-20T01:00:00Z', state: 'computed', summary: '이완 편안한 쪽으로 이동 · 전반 대비 +8', metrics: [] }],
    });
  });

  it('V16 마스킹 기본 → 열람 버튼 후 원문, 점수 없음, AI 비공개면 패널 미마운트', async () => {
    vi.mocked(api.revealClientContact).mockResolvedValue({ phone: '010-1234-5678', birth_date: '1992-03-04' });
    await render(<ClientProfilePage />, '/clients/a');
    expect(container.querySelector('[data-testid="contact-phone"]')?.textContent).toBe('010-****-1234');
    expect(container.textContent).not.toContain('1992-03-04');
    expect(container.querySelector('[data-testid="ai-panel"]')).toBeNull(); // VITE_AI_ENABLED 미설정
    await act(async () => btn('개인정보 열람').click());
    expect(api.revealClientContact).toHaveBeenCalledWith('a');
    expect(container.querySelector('[data-testid="contact-phone"]')?.textContent).toBe('010-1234-5678');
    expect(container.querySelector('[data-testid="contact-birth"]')?.textContent).toBe('1992-03-04');
    await act(async () => btn('다시 가리기').click());
    expect(container.querySelector('[data-testid="contact-phone"]')?.textContent).toBe('010-****-1234');
    // V17
    expect(container.textContent).toContain('이완 편안한 쪽으로 이동');
    expect(container.textContent).not.toMatch(/종합|점수:|순위|등급|온라인|최근 접속/);
  });

  it('열람 거부(403) 시 원문을 노출하지 않고 오류 표시', async () => {
    const { ApiError } = await import('../src/lib/api/client');
    vi.mocked(api.revealClientContact).mockRejectedValue(new ApiError(403, '접근 권한이 없습니다', null));
    await render(<ClientProfilePage />, '/clients/a');
    await act(async () => btn('개인정보 열람').click());
    expect(container.textContent).toContain('접근 권한이 없습니다');
    expect(container.querySelector('[data-testid="contact-phone"]')?.textContent).toBe('010-****-1234');
  });

  it('활동 조회 실패는 활동 없음이 아니라 재시도로 표시한다', async () => {
    vi.mocked(api.getClientActivity).mockRejectedValueOnce(new Error('x')).mockResolvedValue({ items: [], next_cursor: null, ai_included: false });
    await render(<ClientProfilePage />, '/clients/a');
    expect(container.textContent).not.toContain('확인된 활동이 없습니다');
    expect(container.querySelector('section[aria-label="활동 타임라인"] [role="alert"]')).not.toBeNull();
    await act(async () => btn('다시 시도').click());
    expect(container.textContent).toContain('확인된 활동이 없습니다');
  });

  it('기간·유형 필터는 서버 파라미터로 전달된다', async () => {
    await render(<ClientProfilePage />, '/clients/a');
    await act(async () => btn('90일').click());
    expect(vi.mocked(api.getClientActivity).mock.calls.at(-1)![1]).toMatchObject({ days: 90 });
    await act(async () => btn('수업 체크인').click());
    expect(vi.mocked(api.getClientActivity).mock.calls.at(-1)![1]).toMatchObject({ days: 90, types: ['checkin'] });
  });
});
