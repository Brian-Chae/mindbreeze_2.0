// @vitest-environment jsdom
// SDD-321 — 기관 D안 기능 보존(verify C1~C6, D3). 기존 기관 화면과 같은 API 호출·문구·분기를 단언한다.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getOrgDashboard: vi.fn(),
  listCounselors: vi.fn(),
  getCounselorActivity: vi.fn(),
  suspendCounselor: vi.fn(),
  unsuspendCounselor: vi.fn(),
  inviteCounselor: vi.fn(),
  resendCounselorInvite: vi.fn(),
  getOrg: vi.fn(),
  updateCounselor: vi.fn(),
  removeCounselor: vi.fn(),
  searchOrgs: vi.fn(),
  joinOrg: vi.fn(),
  getMyRequests: vi.fn(),
  getOrgCounselorProfile: vi.fn(),
  patchOrgCounselorProfile: vi.fn(),
  listNotifications: vi.fn(),
}));

vi.mock('../src/components/ui-v2/ui-v2-org-shell', () => ({
  UiV2OrgShell: ({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) =>
    createElement('div', { className: 'ui-v2' }, createElement('h1', null, title), actions, children),
}));
vi.mock('../src/lib/api/dashboard', () => ({ getOrgDashboard: api.getOrgDashboard }));
vi.mock('../src/lib/api/org', async (orig) => ({
  ...(await orig<object>()),
  listCounselors: api.listCounselors,
  getCounselorActivity: api.getCounselorActivity,
  suspendCounselor: api.suspendCounselor,
  unsuspendCounselor: api.unsuspendCounselor,
  inviteCounselor: api.inviteCounselor,
  resendCounselorInvite: api.resendCounselorInvite,
  getOrg: api.getOrg,
  updateCounselor: api.updateCounselor,
  removeCounselor: api.removeCounselor,
  searchOrgs: api.searchOrgs,
  joinOrg: api.joinOrg,
  getMyRequests: api.getMyRequests,
}));
vi.mock('../src/lib/api/counselor-info', async (orig) => ({
  ...(await orig<object>()),
  getOrgCounselorProfile: api.getOrgCounselorProfile,
  patchOrgCounselorProfile: api.patchOrgCounselorProfile,
}));
vi.mock('../src/lib/api/notifications', async (orig) => ({ ...(await orig<object>()), listNotifications: api.listNotifications, markRead: vi.fn() }));

import { UiV2OrgDashboardPage } from '../src/pages/org/ui-v2/ui-v2-org-dashboard-page';
import { UiV2OrgCounselorsPage } from '../src/pages/org/ui-v2/ui-v2-org-counselors-page';
import { UiV2OrgManagementPage } from '../src/pages/org/ui-v2/ui-v2-org-management-page';
import { UiV2OrgSearchPage } from '../src/pages/org/ui-v2/ui-v2-org-search-page';
import { UiV2OrgRequestsPage } from '../src/pages/org/ui-v2/ui-v2-org-requests-page';
import { useAuthStore } from '../src/stores/authStore';

let root: Root;
let container: HTMLDivElement;
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const text = (): string => container.textContent ?? '';
const byText = (sel: string, t: string): HTMLElement | null => [...container.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.trim() === t) ?? null;
const byLabel = (label: string): HTMLElement | null => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const setValue = async (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};
const mount = async (node: ReactNode, path = '/x', pattern = '/x'): Promise<void> => {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: pattern, element: node }), createElement(Route, { path: '*', element: createElement('div', null, 'NAV') })))));
  await flush();
};
const setAuth = (role: string, authed = true): void => {
  useAuthStore.setState({ user: { id: 'u1', role, name: 'n', email: 'e@x.com' } as never, isAuthenticated: authed, isInitialized: true } as never);
};

const cls = (over: Record<string, unknown> = {}) => ({
  id: 'c1', title: '저녁의 호흡', type: 'meditation', custom_type_name: null, status: 'completed', access_code: 'ABC123',
  participant_mode: 'open', participant_count: 5, guest_count: 2, started_at: '2026-11-01T10:00:00Z', ended_at: '2026-11-01T11:00:00Z',
  has_record: true, has_summary: false, report_count: 0, pending_review_count: 0, ...over,
});
const dashboard = (over: Record<string, unknown> = {}) => ({
  org_id: 'org-1', org_name: '마음기관', org_code: 'ORG777', total_counselors: 2, total_classes: 3, total_participants: 9, total_members: 11,
  completed_classes: 1, in_progress_classes: 1,
  counselors: [
    { id: 'k1', name: '가코치', email: 'k1@x.com', class_count: 2, participant_count: 6, completed_count: 1 },
    { id: 'k2', name: '대기코치', email: 'k2@x.com', class_count: 0, participant_count: 0, completed_count: 0 },
  ],
  classes: [cls(), cls({ id: 'c2', title: '조용한 아침', status: 'in_progress', has_record: false, guest_count: 0, access_code: null })], ...over,
});
const item = (over: Record<string, unknown> = {}) => ({ id: 'k1', name: '가코치', email: 'k1@x.com', role: 'counselor', status: 'active', counselor_code: 'CODE01', has_personal_office: false, ...over });
const profile = {
  id: 'k1', email: 'k1@x.com', name: '가코치', role: 'counselor', status: 'active', org_id: 'org-1', org_name: '마음기관', counselor_code: 'CODE01',
  phone: '010-1111-2222', profile_image: null, bio: null, gender: 'female', birth_date: '1990-01-02', postal_code: '12345', address_line1: '서울', address_line2: '101호',
  affiliation_type: null, years_of_experience: null, specialties: [], qualifications: [], careers: [], version: 1,
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of Object.values(api)) fn.mockReset();
  api.getOrgDashboard.mockResolvedValue(dashboard());
  api.listCounselors.mockResolvedValue([item(), item({ id: 'k2', name: '대기코치', email: 'k2@x.com', status: 'pending', invite_type: 'new_account', counselor_code: null }), item({ id: 'a1', name: '관리자', email: 'a@x.com', role: 'org_admin', counselor_code: null })]);
  api.listNotifications.mockResolvedValue({ notifications: [], total: 0, unread: 0 });
  api.getOrgCounselorProfile.mockResolvedValue(profile);
  api.getCounselorActivity.mockResolvedValue({ sessions: [{ id: 's1', title: '아침 명상', type: 'meditation', status: 'scheduled', scheduled_at: '2026-11-08T01:00:00Z', started_at: null, participant_count: 4 }], reports: [{ id: 'r1', session_id: 's1', title: '리포트 1', type: 'counselor', status: 'pending_review', created_at: '2026-11-02T00:00:00Z' }] });
  setAuth('org_admin');
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('C1 대시보드', () => {
  it('데이터 현황 링크·기관 코드·통계 5종·활성 코치만·클래스 링크를 보존한다', async () => {
    await mount(createElement(UiV2OrgDashboardPage));
    const shortcut = container.querySelector<HTMLAnchorElement>('a[data-upload-status-shortcut]');
    expect(shortcut?.getAttribute('href')).toBe('/upload-status');
    expect(text()).toContain('ORG777');
    for (const l of ['활성 코치', '총 클래스', '총 회원', '종료한 클래스', '진행중']) expect(text()).toContain(l);
    expect(container.querySelector('.u2-org-stats')?.textContent).toContain('11'); // total_members 우선
    // 초대 목록(listCounselors)에 pending 인 k2 는 실적 표에서 제외된다.
    const coachRows = [...container.querySelectorAll('table')].find((t) => t.querySelector('th')?.textContent === '이름' && t.textContent?.includes('참여자'))!;
    expect(coachRows.textContent).toContain('가코치');
    expect(coachRows.textContent).not.toContain('대기코치');
    expect(container.querySelector('a[href="/sessions/c1"]')?.textContent).toBe('저녁의 호흡');
    expect(container.querySelector('a[href="/sessions/c1/record"]')?.textContent).toBe('기록 보기');
    expect(container.querySelector('a[href="/sessions/c2/record"]')).toBeNull(); // 기록·요약 없음
    expect(text()).toContain('(게스트 2)');
    expect(text()).toContain('초대·가입 현황'); // 기존 CounselorInviteSection 재사용
  });
  it('코드 복사 성공/실패 메시지', async () => {
    await mount(createElement(UiV2OrgDashboardPage));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    await act(async () => { byText('button', '코드 복사')!.click(); });
    expect(text()).toContain('기관 코드를 복사했습니다.');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('x')) }, configurable: true });
    await act(async () => { byText('button', '코드 복사')!.click(); });
    expect(text()).toContain('기관 코드를 복사하지 못했습니다.');
  });
  it('빈·오류·로딩 상태, 클래스 필터', async () => {
    api.getOrgDashboard.mockResolvedValue(dashboard({ counselors: [], classes: [] }));
    await mount(createElement(UiV2OrgDashboardPage));
    expect(text()).toContain('활성 코치 실적이 없습니다. 초대가 완료된 코치만 표시됩니다.');
    expect(text()).toContain('진행된 클래스가 없습니다.');
    act(() => root.unmount()); container.remove();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    api.getOrgDashboard.mockResolvedValue(dashboard());
    await mount(createElement(UiV2OrgDashboardPage));
    await setValue(byLabel('클래스 검색') as HTMLInputElement, '조용한');
    expect(text()).toContain('조용한 아침');
    expect(container.querySelector('a[href="/sessions/c1"]')).toBeNull();
    await setValue(byLabel('클래스 검색') as HTMLInputElement, '없는검색어');
    expect(text()).toContain('조건에 맞는 클래스가 없습니다.');
    act(() => root.unmount()); container.remove();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    api.getOrgDashboard.mockRejectedValue(new Error('대시보드 오류'));
    await mount(createElement(UiV2OrgDashboardPage));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('대시보드 오류');
  });
  it('퇴직 안내 팝업이 마운트된다(미읽음 org_removed 알림이 있을 때)', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [{ id: 'n1', type: 'org_removed', is_read: false, title: 't', body: 'b', extra: { org_name: '옛기관' }, created_at: '2026-11-01T00:00:00Z' }], total: 1, unread: 1 });
    await mount(createElement(UiV2OrgDashboardPage));
    expect(api.listNotifications).toHaveBeenCalledWith(true);
    expect(container.querySelector('[role="dialog"], [role="alertdialog"]')).not.toBeNull();
  });
});

describe('C2 코치 관리', () => {
  it('헤더 액션으로 역할별 초대 대화상자를 연다', async () => {
    await mount(createElement(UiV2OrgCounselorsPage));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { byText('button', '기관관리자 초대')!.click(); });
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('기관관리자 초대');
    await act(async () => { byText('button', '닫기')!.click(); });
    await act(async () => { container.querySelector<HTMLElement>('button[data-header-action="primary"]')!.click(); });
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('코치 초대');
  });
  it('검색·역할·상태 필터', async () => {
    await mount(createElement(UiV2OrgCounselorsPage));
    expect(text()).toContain('대기코치');
    await setValue(byLabel('코치 검색') as HTMLInputElement, 'code01');
    expect(text()).toContain('가코치');
    expect(text()).not.toContain('대기코치');
    await setValue(byLabel('코치 검색') as HTMLInputElement, '');
    await setValue(byLabel('역할 필터') as HTMLSelectElement, 'org_admin');
    expect(container.querySelector('tbody')?.textContent).toContain('관리자');
    expect(container.querySelector('tbody')?.textContent).not.toContain('가코치');
    await setValue(byLabel('역할 필터') as HTMLSelectElement, '');
    await setValue(byLabel('상태 필터') as HTMLSelectElement, 'pending');
    expect(container.querySelector('tbody')?.textContent).toContain('대기코치');
    expect(container.querySelector('tbody')?.textContent).not.toContain('가코치');
  });
  it('정보 수정은 코치만 가능하고, 기관 관리자 행은 비활성+안내 title, 대기 행에는 정지 버튼이 없다', async () => {
    await mount(createElement(UiV2OrgCounselorsPage));
    const rows = [...container.querySelectorAll('tbody tr')];
    const rowOf = (name: string) => rows.find((r) => r.textContent?.includes(name))!;
    const adminEdit = [...rowOf('관리자').querySelectorAll('button')].find((b) => b.textContent === '정보 수정')!;
    expect(adminEdit.disabled).toBe(true);
    expect(adminEdit.title).toBe('기관 관리자 계정은 본인 설정 또는 플랫폼 관리자를 통해 수정합니다');
    const coachEdit = [...rowOf('가코치').querySelectorAll('button')].find((b) => b.textContent === '정보 수정')!;
    expect(coachEdit.disabled).toBe(false);
    expect([...rowOf('대기코치').querySelectorAll('button')].some((b) => /비활성화|활성화/.test(b.textContent ?? ''))).toBe(false);
    expect([...rowOf('가코치').querySelectorAll('button')].some((b) => b.textContent === '비활성화')).toBe(true);
  });
  it('정지 대화상자: 사유가 비면 확인 비활성, 사유 입력 후 suspendCounselor(orgId,id,reason) 호출, ESC 로 닫힘', async () => {
    api.suspendCounselor.mockResolvedValue({ status: 'suspended' });
    await mount(createElement(UiV2OrgCounselorsPage));
    const row = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('가코치'))!;
    await act(async () => { [...row.querySelectorAll('button')].find((b) => b.textContent === '비활성화')!.click(); });
    const dialog = container.querySelector('[role="dialog"]')!;
    const confirmBtn = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '비활성화') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    await setValue(dialog.querySelector('textarea')!, '  휴직  ');
    await act(async () => { confirmBtn.click(); });
    await flush();
    expect(api.suspendCounselor).toHaveBeenCalledWith('org-1', 'k1', '휴직');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('tbody')?.textContent).toContain('정지');
    // 해제 대화상자 + ESC
    api.unsuspendCounselor.mockResolvedValue({ status: 'active' });
    const row2 = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('가코치'))!;
    await act(async () => { [...row2.querySelectorAll('button')].find((b) => b.textContent === '활성화')!.click(); });
    expect(container.querySelector('#status-change-title')?.textContent).toBe('코치 활성화');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it('이력 패널: 프로필 4항목, 탭 방향키 이동·aria-selected, 세션/리포트 표, 닫기', async () => {
    await mount(createElement(UiV2OrgCounselorsPage));
    const row = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('가코치'))!;
    await act(async () => { [...row.querySelectorAll('button')].find((b) => b.textContent === '이력')!.click(); });
    await flush();
    expect(api.getCounselorActivity).toHaveBeenCalledWith('org-1', 'k1');
    for (const l of ['코치 코드', '역할', '전화번호', '활동 형태']) expect(text()).toContain(l);
    expect(text()).toContain('010-1111-2222');
    expect(text()).toContain('아침 명상');
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs[0].textContent).toBe('최근 세션 (1)');
    await act(async () => { tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    const after = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(after.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(text()).toContain('리포트 1');
    expect(text()).toContain('검토 대기');
    await act(async () => { byText('button', '닫기')!.click(); });
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
  it('로딩 role=status, 오류 role=alert, 빈 목록 문구', async () => {
    api.getOrgDashboard.mockRejectedValue(new Error('실패'));
    await mount(createElement(UiV2OrgCounselorsPage));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('코치 목록을 불러오지 못했습니다');
    act(() => root.unmount()); container.remove();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    api.getOrgDashboard.mockResolvedValue(dashboard());
    api.listCounselors.mockResolvedValue([]);
    await mount(createElement(UiV2OrgCounselorsPage));
    expect(text()).toContain("아직 소속된 코치가 없습니다. 상단의 '코치 초대' 버튼으로 초대해 보세요.");
  });
});

describe('C3 정보 수정 정책', () => {
  it('성별·생년월일·전화·주소 입력이 있고 이메일 입력은 없다, getOrgCounselorProfile 로 불러온다', async () => {
    await mount(createElement(UiV2OrgCounselorsPage));
    const row = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('가코치'))!;
    await act(async () => { [...row.querySelectorAll('button')].find((b) => b.textContent === '정보 수정')!.click(); });
    await flush();
    expect(api.getOrgCounselorProfile).toHaveBeenCalledWith('org-1', 'k1');
    const form = container.querySelector('form[aria-label="가코치 정보 수정"]')!;
    expect(form).not.toBeNull();
    for (const l of ['성별', '전화번호', '우편번호', '주소', '상세 주소']) expect(form.textContent).toContain(l);
    expect(form.textContent).toContain('이메일 (아이디 — 변경 불가)');
    expect(form.querySelector('input[type="email"]')).toBeNull();
    expect(form.querySelector('input[type="date"], [aria-label*="생년월일"], input[placeholder*="YYYY"]') ?? form.textContent?.includes('생년월일')).toBeTruthy();
  });
});

describe('C4 센터 관리', () => {
  beforeEach(() => {
    api.getOrg.mockResolvedValue({ id: 'org-1', name: '마음기관', ceo_name: '대표', biz_number: '123-45-67890', address: '대전', phone: '042', verified: true, verified_at: '2026-01-01', created_at: '2025-12-01' });
  });
  const open = () => mount(createElement(UiV2OrgManagementPage), '/org/org-1', '/org/:org_id');
  it('가입 요청 준비 중 안내, 센터 정보 7항목, 소속 코치 N명', async () => {
    await open();
    expect(text()).toContain('가입 요청 관리');
    expect(text()).toContain('준비 중');
    expect(text()).toContain('가입 요청 관리 기능은 준비 중입니다.');
    for (const l of ['센터명', '대표자명', '사업자등록번호', '주소', '전화번호', '인증 여부', '등록일']) expect(text()).toContain(l);
    expect(text()).toContain('인증 완료 (2026-01-01)');
    expect(text()).toContain('소속 코치 (3명)');
  });
  it('비관리자 안내', async () => {
    setAuth('counselor');
    await open();
    expect(text()).toContain('관리자 권한이 없습니다. 일부 기능이 제한될 수 있습니다.');
  });
  it('역할 변경은 confirm 문구 후 updateCounselor, 취소하면 호출 없음', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    api.updateCounselor.mockResolvedValue(item({ role: 'org_admin' }));
    await open();
    const select = byLabel('가코치 역할') as HTMLSelectElement;
    await setValue(select, 'org_admin');
    expect(confirmSpy).toHaveBeenCalledWith("역할을 '관리자'(으)로 변경하시겠습니까?");
    expect(api.updateCounselor).not.toHaveBeenCalled();
    await setValue(byLabel('가코치 역할') as HTMLSelectElement, 'org_admin');
    await flush();
    expect(api.updateCounselor).toHaveBeenCalledWith('org-1', 'k1', { role: 'org_admin' });
  });
  it('소속 해제는 confirm 후 removeCounselor, 행 제거', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.removeCounselor.mockResolvedValue(undefined);
    await open();
    const row = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('가코치'))!;
    await act(async () => { [...row.querySelectorAll('button')].find((b) => b.textContent === '소속 해제')!.click(); });
    await flush();
    expect(window.confirm).toHaveBeenCalledWith('소속을 해제하시겠습니까?');
    expect(api.removeCounselor).toHaveBeenCalledWith('org-1', 'k1');
    expect(text()).toContain('소속 코치 (2명)');
  });
  it('검색·상태 필터, 정보 수정 편집기 연결', async () => {
    await open();
    await setValue(byLabel('코치 검색') as HTMLInputElement, '대기');
    expect(container.querySelector('tbody')?.textContent).toContain('대기코치');
    expect(container.querySelector('tbody')?.textContent).not.toContain('가코치');
    await setValue(byLabel('코치 검색') as HTMLInputElement, '');
    const row = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('가코치'))!;
    await act(async () => { [...row.querySelectorAll('button')].find((b) => b.textContent === '정보 수정')!.click(); });
    await flush();
    expect(api.getOrgCounselorProfile).toHaveBeenCalledWith('org-1', 'k1');
  });
});

describe('C5 센터 검색', () => {
  const orgItem = { id: 'o1', name: '새기관', address: '서울', verified: true };
  it('searchOrgs(q, region) 호출·결과·신청 버튼 상태·메시지', async () => {
    setAuth('counselor');
    api.getMyRequests.mockResolvedValue([{ id: 'r0', org_id: 'o2', org_name: '이미', status: 'pending', reason: null, created_at: '2026-11-01' }]);
    api.searchOrgs.mockResolvedValue([orgItem, { id: 'o2', name: '이미기관', address: '부산', verified: false }]);
    api.joinOrg.mockResolvedValue({ id: 'r1', org_id: 'o1', org_name: '새기관', status: 'pending', reason: null, created_at: '2026-11-07' });
    await mount(createElement(UiV2OrgSearchPage));
    await setValue(byLabel('센터명 검색') as HTMLInputElement, ' 새 ');
    await setValue(container.querySelector<HTMLInputElement>('input[placeholder="지역 (예: 서울)"]')!, '서울');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(api.searchOrgs).toHaveBeenCalledWith('새', '서울');
    expect(container.querySelector('a[href="/org/o1"]')?.textContent).toBe('새기관');
    expect(text()).toContain('인증');
    const joinBtn = byText('button', '가입 신청') as HTMLButtonElement;
    expect(joinBtn.disabled).toBe(false);
    expect((byText('button', '신청 완료') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { joinBtn.click(); });
    await flush();
    expect(api.joinOrg).toHaveBeenCalledWith('o1');
    expect(text()).toContain('가입 신청이 접수되었습니다');
    expect(container.querySelector('a[href="/register/organization"]')?.textContent).toContain('기관 가입 상담 신청');
  });
  it('결과 없음 문구, 코치 외 역할 안내, 가입 버튼 비활성', async () => {
    api.searchOrgs.mockResolvedValue([]);
    await mount(createElement(UiV2OrgSearchPage));
    expect(text()).toContain('코치 계정으로만 가입 신청이 가능합니다 (현재 역할: 센터 관리자)');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(text()).toContain('검색 결과가 없습니다');
  });
  it('검색 오류 role=alert', async () => {
    api.searchOrgs.mockRejectedValue(new Error('x'));
    await mount(createElement(UiV2OrgSearchPage));
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('검색에 실패했습니다');
  });
});

describe('C6 내 신청 내역', () => {
  it('미인증이면 /login?role=counselor 로 이동한다', async () => {
    setAuth('counselor', false);
    await mount(createElement(UiV2OrgRequestsPage));
    expect(api.getMyRequests).not.toHaveBeenCalled();
    expect(text()).toContain('NAV');
  });
  it('빈 문구, 상태 배지 3종, 거절 사유', async () => {
    api.getMyRequests.mockResolvedValue([]);
    await mount(createElement(UiV2OrgRequestsPage));
    expect(text()).toContain('신청 내역이 없습니다.');
    act(() => root.unmount()); container.remove();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    api.getMyRequests.mockResolvedValue([
      { id: '1', org_id: 'a', org_name: 'A기관', status: 'pending', reason: null, created_at: '2026-11-01T00:00:00Z' },
      { id: '2', org_id: 'b', org_name: 'B기관', status: 'approved', reason: null, created_at: '2026-11-02T00:00:00Z' },
      { id: '3', org_id: 'c', org_name: 'C기관', status: 'rejected', reason: '서류 미비', created_at: 'invalid' },
    ]);
    await mount(createElement(UiV2OrgRequestsPage));
    for (const l of ['대기 중', '승인됨', '거절됨']) expect(text()).toContain(l);
    expect(text()).toContain('거절 사유: 서류 미비');
    expect(text()).toContain('신청일: -');
  });
});

describe('D3 루트 클래스', () => {
  it('D안 페이지는 .ui-v2 스코프 안에서 그려진다', async () => {
    api.getMyRequests.mockResolvedValue([]);
    await mount(createElement(UiV2OrgRequestsPage));
    expect(container.querySelector('.ui-v2')).not.toBeNull();
    api.getOrg.mockResolvedValue({ id: 'org-1', name: 'x', ceo_name: '', biz_number: '', address: '', phone: '', verified: false, verified_at: null, created_at: '' });
    act(() => root.unmount()); container.remove();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await mount(createElement(UiV2OrgManagementPage), '/org/org-1', '/org/:org_id');
    expect(container.querySelector('.ui-v2')).not.toBeNull();
  });
});
