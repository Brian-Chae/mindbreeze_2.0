// @vitest-environment jsdom
// SDD-323 — 기관 구성원 화면(verify U2~U13, U20). 버튼 노출은 allowed_actions 만 본다.
import { act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getOrgDashboard: vi.fn(),
  listCounselors: vi.fn(),
  listOrgJoinRequests: vi.fn(),
  getCounselorActivity: vi.fn(),
  updateCounselor: vi.fn(),
  removeCounselor: vi.fn(),
  transferPrimaryAdmin: vi.fn(),
  getCounselorsEtag: vi.fn(),
  resendCounselorInvite: vi.fn(),
  inviteCounselor: vi.fn(),
  handleRequest: vi.fn(),
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
  listOrgJoinRequests: api.listOrgJoinRequests,
  getCounselorActivity: api.getCounselorActivity,
  updateCounselor: api.updateCounselor,
  removeCounselor: api.removeCounselor,
  transferPrimaryAdmin: api.transferPrimaryAdmin,
  getCounselorsEtag: api.getCounselorsEtag,
  resendCounselorInvite: api.resendCounselorInvite,
  inviteCounselor: api.inviteCounselor,
  handleRequest: api.handleRequest,
}));
vi.mock('../src/lib/api/notifications', async (orig) => ({ ...(await orig<object>()), listNotifications: api.listNotifications, markRead: vi.fn() }));

import { UiV2OrgMembersPage } from '../src/pages/org/ui-v2/ui-v2-org-members-page';
import { UiV2OrgDashboardPage } from '../src/pages/org/ui-v2/ui-v2-org-dashboard-page';
import { ApiError } from '../src/lib/api/client';
import { apiErrorCode, orgErrorMessage } from '../src/lib/api/org';
import { inviteStateOf, summaryOf } from '../src/pages/org/ui-v2/members/members-model';

let root: Root;
let container: HTMLDivElement;
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const text = (): string => container.textContent ?? '';
const byText = (sel: string, t: string, scope: ParentNode = container): HTMLElement | null =>
  [...scope.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.trim() === t) ?? null;
const byLabel = (label: string, scope: ParentNode = container): HTMLElement | null => scope.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const setValue = async (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};
const click = async (el: HTMLElement | null): Promise<void> => { expect(el).not.toBeNull(); await act(async () => { el!.click(); }); await flush(); };
let lastSearch = '';
const Probe = () => { const { search } = useLocation(); useEffect(() => { lastSearch = search; }, [search]); return null; };
const mount = async (node: ReactNode, path = '/counselors'): Promise<void> => {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Probe), createElement(Routes, null, createElement(Route, { path: '/counselors', element: node }), createElement(Route, { path: '*', element: createElement('div', null, 'NAV') })))));
  await flush();
};

const ALL_MUTATING = ['promote', 'revoke_admin', 'remove', 'transfer_primary'] as const;
const mem = (over: Record<string, unknown> = {}) => ({
  id: 'k1', name: '김하늘', email: 'haneul@x.com', role: 'counselor', status: 'active', membership_status: 'active', account_status: 'active',
  is_primary_admin: false, is_self: false, class_count: 3, last_activity_at: '2026-11-09T00:20:00Z', has_personal_office: true, counselor_code: 'C1',
  allowed_actions: ['detail', 'edit_profile', 'remove', 'promote'], blocked_reasons: {}, ...over,
});
const primaryRows = () => [
  mem(),
  mem({ id: 'k2', name: '이도윤', email: 'doyun@x.com', has_personal_office: false, class_count: 2, last_activity_at: null }),
  mem({ id: 'a1', name: '윤서윤', email: 'seoyun@x.com', role: 'org_admin', is_primary_admin: true, is_self: true, allowed_actions: ['detail'], has_personal_office: false }),
  mem({ id: 'a2', name: '정민서', email: 'minseo@x.com', role: 'org_admin', allowed_actions: ['detail', 'revoke_admin', 'transfer_primary', 'remove'], has_personal_office: false }),
  mem({ id: 'i1', name: '한서아', email: 'seoa@x.com', status: 'pending', membership_status: 'invited', account_status: 'pending', invite_type: 'new_account', invited_at: '2026-11-01T00:00:00Z', invite_expires_at: '2099-11-16T00:00:00Z', allowed_actions: ['resend_invite'], has_personal_office: false }),
  mem({ id: 'i2', name: '오지호', email: 'jiho@x.com', role: 'org_admin', status: 'pending', membership_status: 'invited', account_status: 'pending', invite_type: 'org_membership', invited_at: '2026-10-01T00:00:00Z', invite_expires_at: '2026-10-08T00:00:00Z', allowed_actions: ['resend_invite'], has_personal_office: false }),
  mem({ id: 'i3', name: '박지안', email: 'jian@x.com', invite_type: 'new_account', invited_at: '2026-10-20T00:00:00Z', allowed_actions: ['detail'], has_personal_office: false }),
];
// 일반 관리자 시점: 승격·회수·관리자 해지·대표 넘기기가 allowed_actions 에 없다
const plainAdminRows = () => primaryRows().map((r) => ({
  ...r,
  is_self: r.id === 'a2',
  allowed_actions: (r.allowed_actions as string[]).filter((a) => !['promote', 'revoke_admin', 'transfer_primary'].includes(a) && !(r.role === 'org_admin' && a === 'remove')),
}));

const reqs = () => [
  { id: 'q1', org_id: 'org-1', org_name: '마음기관', status: 'pending', reason: null, created_at: '2026-11-09T01:30:00Z', applicant_name: '문유진', applicant_email: 'yujin@x.com' },
  { id: 'q2', org_id: 'org-1', org_name: '마음기관', status: 'rejected', reason: '서류 미비', created_at: '2026-11-01T01:30:00Z', applicant_name: '송민', applicant_email: 'min@x.com', handled_at: '2026-11-02T00:00:00Z' },
];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of Object.values(api)) fn.mockReset();
  api.getOrgDashboard.mockResolvedValue({ org_id: 'org-1', org_name: '마음기관', org_code: 'ORG777', total_counselors: 2, total_classes: 3, total_participants: 9, completed_classes: 1, in_progress_classes: 1, counselors: [], classes: [] });
  api.listCounselors.mockResolvedValue(primaryRows());
  api.listOrgJoinRequests.mockResolvedValue(reqs());
  api.listNotifications.mockResolvedValue({ notifications: [], total: 0, unread: 0 });
  api.getCounselorActivity.mockResolvedValue({ sessions: [{ id: 's1', title: '아침 마음챙김', type: 'meditation', status: 'in_progress', scheduled_at: null, started_at: '2026-11-09T00:20:00Z', participant_count: 4 }], reports: [], classes: [{ id: 'c1', name: '아침 마음챙김', status: 'open', member_count: 5 }], client_count: 12 });
  api.getCounselorsEtag.mockResolvedValue('"7"');
  lastSearch = '';
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const rowText = (name: string): string => container.querySelector(`[data-testid="member-table"] tr[data-member-id]:has(strong)`) ? ([...container.querySelectorAll('[data-testid="member-table"] tr[data-member-id]')].find((r) => r.textContent?.includes(name))?.textContent ?? '') : '';
const rowButtons = (name: string): string[] =>
  [...([...container.querySelectorAll('[data-testid="member-table"] tr[data-member-id]')].find((r) => r.textContent?.includes(name))?.querySelectorAll('button') ?? [])].map((b) => b.textContent ?? '');

describe('U2 탭·URL 보존', () => {
  it('기본은 코치 탭이며 4개 탭과 건수를 보여 준다', async () => {
    await mount(createElement(UiV2OrgMembersPage));
    const labels = [...container.querySelectorAll('.u2m-tabs button')].map((b) => b.textContent);
    expect(labels).toEqual(['코치 3', '기관 관리자 2', '초대·가입 현황 2', '가입 요청 1']);
    expect(container.querySelector('.u2m-tabs button[aria-current="page"]')?.textContent).toContain('코치');
  });
  it('?tab= 직접 진입, 탭 전환이 URL 에 반영되고 검색·필터가 보존된다', async () => {
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins&q=정민');
    expect(container.querySelector('.u2m-tabs button[aria-current="page"]')?.textContent).toContain('기관 관리자');
    expect((byLabel('이름 또는 이메일 검색') as HTMLInputElement).value).toBe('정민');
    expect(text()).toContain('정민서');
    expect(text()).not.toContain('윤서윤');
    await click(byText('button', '가입 요청 1') ?? [...container.querySelectorAll<HTMLElement>('.u2m-tabs button')][3]);
    expect(lastSearch).toBe('?tab=requests');
    await setValue(byLabel('이름 또는 이메일 검색') as HTMLInputElement, '문유');
    expect(lastSearch).toContain('q=');
    expect(text()).toContain('문유진');
  });
  it('알 수 없는 tab 값은 코치 탭으로 돌아간다', async () => {
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=nope');
    expect(container.querySelector('.u2m-tabs button[aria-current="page"]')?.textContent).toContain('코치');
  });
  it('상세는 ?member= 로 열리고 닫으면 지워진다', async () => {
    await mount(createElement(UiV2OrgMembersPage));
    await click(byLabel('김하늘 상세', container.querySelector('[data-testid="member-table"]')!));
    expect(lastSearch).toBe('?member=k1');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click(byText('button', '닫기', container.querySelector('[role="dialog"]')!));
    expect(lastSearch).toBe('');
  });
});

describe('U3~U5 allowed_actions 기반 버튼 노출', () => {
  it('대표: 관리자 탭에 권한 회수·대표 지정·소속 해지가 보이고 본인·대표 행에는 없다', async () => {
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins');
    expect(rowButtons('정민서')).toEqual(expect.arrayContaining(['상세 →', '권한 회수', '대표 지정', '소속 해지']));
    expect(rowButtons('윤서윤')).toEqual(['상세 →']);
    expect(rowText('윤서윤')).toContain('대표 관리자 · 본인');
    expect(byText('button', '기존 코치 지정')).not.toBeNull();
  });
  it('일반 관리자: 승격·회수·관리자 해지·대표 지정 버튼이 DOM 에 없다(숨김)', async () => {
    api.listCounselors.mockResolvedValue(plainAdminRows());
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins');
    for (const label of ['권한 회수', '대표 지정', '소속 해지']) expect(container.innerHTML).not.toContain(`>${label}<`);
    expect(byText('button', '기존 코치 지정')).toBeNull();
    // 코치 탭의 코치 해지는 보인다
    await click([...container.querySelectorAll<HTMLElement>('.u2m-tabs button')][0]);
    expect(container.querySelector('[data-testid="member-table"]')?.innerHTML).toContain('상세');
  });
  it('allowed_actions 가 없으면(서버 미배포) 변경 버튼이 하나도 렌더되지 않는다', async () => {
    api.listCounselors.mockResolvedValue(primaryRows().map((r) => ({ ...r, allowed_actions: undefined })));
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins');
    for (const label of ['권한 회수', '대표 지정', '소속 해지', '상세 →']) expect(container.innerHTML).not.toContain(`>${label}<`);
  });
  it('정지·재활성·비활성화 문구가 구성원 화면 어디에도 없다', async () => {
    for (const tab of ['coaches', 'admins', 'invites', 'requests']) {
      await mount(createElement(UiV2OrgMembersPage), `/counselors?tab=${tab}`);
      expect(text(), tab).not.toMatch(/정지|재활성|비활성화/);
    }
  });
});

describe('U6 권한 변경 확인 모달', () => {
  const openRevoke = async (): Promise<HTMLElement> => {
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins');
    await click(byLabel('정민서 권한 회수'));
    return container.querySelector('[role="dialog"]') as HTMLElement;
  };
  it('영향 설명 + 사유 필수(비면 확인 비활성) + updateCounselor(role, reason) 호출', async () => {
    api.updateCounselor.mockResolvedValue(mem({ id: 'a2', role: 'counselor' }));
    const dialog = await openRevoke();
    expect(dialog.textContent).toContain('기관 운영 권한이 해제되며');
    const confirm = byText('button', '권한 회수', dialog) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await setValue(dialog.querySelector('textarea')!, '  역할 조정  ');
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(api.updateCounselor).toHaveBeenCalledWith('org-1', 'a2', { role: 'counselor', reason: '역할 조정' });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(api.listCounselors).toHaveBeenCalledTimes(2); // U13 성공 후 재조회
  });
  it('중복 제출이 한 번만 전달된다', async () => {
    let release: () => void = () => undefined;
    api.updateCounselor.mockImplementation(() => new Promise<void>((res) => { release = res; }));
    const dialog = await openRevoke();
    await setValue(dialog.querySelector('textarea')!, '사유');
    const confirm = byText('button', '권한 회수', dialog) as HTMLButtonElement;
    await act(async () => { confirm.click(); confirm.click(); });
    expect(api.updateCounselor).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await flush();
  });
  it.each([
    ['LAST_ADMIN', '활성 관리자가 한 명 이상'],
    ['PRIMARY_CHANGED', '대표 관리자가 바뀌었습니다'],
    ['MEMBER_HAS_ACTIVE_WORK', '진행·예정·대기 중인 세션'],
  ])('실패 시 에러코드 %s 별 문구를 보여 주고 모달이 유지된다', async (code, snippet) => {
    api.updateCounselor.mockRejectedValue(new ApiError(409, '서버 문구', { detail: '서버 문구', code }));
    const dialog = await openRevoke();
    await setValue(dialog.querySelector('textarea')!, '사유');
    await click(byText('button', '권한 회수', dialog));
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(snippet);
    expect((byText('button', '권한 회수', container.querySelector('[role="dialog"]')!) as HTMLButtonElement).disabled).toBe(false);
  });
  it('ESC 로 닫히고 포커스가 트리거 버튼으로 돌아온다', async () => {
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins');
    const trigger = byLabel('정민서 권한 회수') as HTMLButtonElement;
    trigger.focus();
    await click(trigger);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('blocked_reasons 가 있는 행동은 확인 모달 대신 차단 사유를 안내한다', async () => {
    api.listCounselors.mockResolvedValue(primaryRows().map((r) => (r.id === 'a2' ? { ...r, blocked_reasons: { revoke_admin: 'LAST_ADMIN' } } : r)));
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins');
    await click(byLabel('정민서 권한 회수'));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('권한을 회수할 수 없습니다');
    expect(dialog.textContent).toContain('활성 관리자가 한 명 이상');
    expect(dialog.querySelector('textarea')).toBeNull();
    expect(api.updateCounselor).not.toHaveBeenCalled();
  });
  it('대표 넘기기는 If-Match 용 기관 version 과 expected_primary_admin_id 를 함께 보낸다', async () => {
    api.transferPrimaryAdmin.mockResolvedValue({ org_id: 'org-1', primary_admin_id: 'a2', version: 8 });
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins');
    await click(byLabel('정민서 대표 지정'));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('현재 대표는 일반 관리자로 남고');
    await setValue(dialog.querySelector('textarea')!, '대표 교체');
    await click(byText('button', '대표 넘기기', dialog));
    expect(api.transferPrimaryAdmin).toHaveBeenCalledWith('org-1', { target_user_id: 'a2', expected_primary_admin_id: 'a1', reason: '대표 교체' }, '"7"');
  });
  it('소속 해지는 사유를 removeCounselor 에 전달한다', async () => {
    api.removeCounselor.mockResolvedValue(undefined);
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=admins');
    await click(byLabel('정민서 소속 해지'));
    const dialog = container.querySelector('[role="dialog"]')!;
    await setValue(dialog.querySelector('textarea')!, '퇴직');
    await click(byText('button', '소속 해지', dialog));
    expect(api.removeCounselor).toHaveBeenCalledWith('org-1', 'a2', '퇴직');
  });
});

describe('U7 초대 폼', () => {
  it('역할 선택(코치/기관 관리자) → 해당 역할로 초대 요청', async () => {
    api.inviteCounselor.mockResolvedValue({});
    await mount(createElement(UiV2OrgMembersPage));
    await click(container.querySelector<HTMLElement>('button[data-header-action="primary"]'));
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe('u2m-invite-title');
    await setValue(byLabel('초대 역할', dialog) as HTMLSelectElement, 'org_admin');
    expect(dialog.textContent).toContain('기관관리자 초대');
    await setValue(dialog.querySelector('input[type="text"]')!, '신규관리자');
    await setValue(dialog.querySelector('input[type="email"]')!, 'new@x.com');
    await act(async () => { dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(api.inviteCounselor).toHaveBeenCalledWith('org-1', { name: '신규관리자', email: 'new@x.com', role: 'org_admin' });
    expect(dialog.textContent).not.toMatch(/이미 가입|기존 계정이 있/);
  });
});

describe('U8 초대·가입 현황', () => {
  it('대기/만료/가입됨 상태와 필터, 만료 시각 없는 건은 "만료 정보 없음"', async () => {
    api.listCounselors.mockResolvedValue([...primaryRows(), mem({ id: 'i4', name: '최시우', email: 'siwoo@x.com', status: 'pending', membership_status: 'invited', invite_type: 'new_account', invited_at: '2026-11-02T00:00:00Z', invite_expires_at: null, allowed_actions: ['resend_invite'] })]);
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=invites');
    const table = container.querySelector('.u2-table-card')!;
    expect(table.textContent).toContain('대기');
    expect(table.textContent).toContain('만료');
    expect(table.textContent).toContain('가입됨');
    expect(table.textContent).toContain('만료 정보 없음');
    expect(inviteStateOf(primaryRows()[5] as never)).toBe('expired');
    await setValue(byLabel('상태 필터') as HTMLSelectElement, 'expired');
    expect(text()).toContain('오지호');
    expect(text()).not.toContain('한서아');
    expect(lastSearch).toContain('status=expired');
  });
  it('재발송 쿨다운(429 INVITE_COOLDOWN)이면 버튼이 비활성되고 남은 시간이 보인다', async () => {
    api.resendCounselorInvite.mockRejectedValue(new ApiError(429, '쿨다운', { detail: '쿨다운', code: 'INVITE_COOLDOWN', retry_after_sec: 90 }));
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=invites');
    await click(byLabel('한서아 재발송', container.querySelector('.u2-table-card')!));
    const btn = byLabel('한서아 재발송', container.querySelector('.u2-table-card')!) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/1분 30초|1분 29초/); // 91초로 올림되면 실패 — 기준 시각 동일
  });
  it('재발송 성공 시 재조회하고, 가입됨 행에는 재발송이 없다', async () => {
    api.resendCounselorInvite.mockResolvedValue({ invite_sent: true, invite_expires_at: '2099-01-01T00:00:00Z' });
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=invites');
    expect(byLabel('박지안 재발송', container.querySelector('.u2-table-card')!)).toBeNull();
    await click(byLabel('오지호 재발송', container.querySelector('.u2-table-card')!));
    expect(api.resendCounselorInvite).toHaveBeenCalledWith('org-1', 'i2');
    expect(api.listCounselors).toHaveBeenCalledTimes(2);
  });
});

describe('U9 가입 요청', () => {
  it('승인은 handleRequest(approved), 거절은 사유 필수', async () => {
    api.handleRequest.mockResolvedValue({});
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=requests');
    expect(text()).toContain('문유진');
    expect(text()).toContain('사유: 서류 미비');
    await click(byLabel('문유진 승인', container.querySelector('.u2-table-card')!));
    expect(api.handleRequest).toHaveBeenCalledWith('org-1', 'q1', { status: 'approved' });
    await click(byLabel('문유진 거절', container.querySelector('.u2-table-card')!));
    const dialog = container.querySelector('[role="dialog"]')!;
    const confirm = byText('button', '거절하기', dialog) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await setValue(dialog.querySelector('textarea')!, '정원 초과');
    await click(confirm);
    expect(api.handleRequest).toHaveBeenLastCalledWith('org-1', 'q1', { status: 'rejected', reason: '정원 초과' });
  });
  it('요청 조회에 실패하면 알림과 함께 다른 탭은 정상 동작한다', async () => {
    api.listOrgJoinRequests.mockRejectedValue(new Error('x'));
    await mount(createElement(UiV2OrgMembersPage), '/counselors?tab=requests');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('가입 요청을 불러오지 못했습니다');
  });
});

describe('U10 상세', () => {
  it('기관 내 클래스·담당 회원·최근 활동·활동 없음, 이메일 입력은 없다', async () => {
    await mount(createElement(UiV2OrgMembersPage), '/counselors?member=k1');
    await flush();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('기관 내 클래스');
    expect(dialog.textContent).toContain('12명');
    expect(dialog.textContent).toContain('아침 마음챙김');
    expect(dialog.textContent).toContain('이 기관의 세션 정보만 표시합니다');
    expect(api.getCounselorActivity).toHaveBeenCalledWith('org-1', 'k1');
    expect(dialog.querySelector('input[type="email"]')).toBeNull();
  });
  it('활동이 없으면 "활동 없음"', async () => {
    api.getCounselorActivity.mockResolvedValue({ sessions: [], reports: [], classes: [], client_count: 0 });
    await mount(createElement(UiV2OrgMembersPage), '/counselors?member=k2');
    await flush();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('활동 없음');
  });
});

describe('U12 빈·검색없음·조회 실패', () => {
  it('세 상태 문구가 서로 다르다', async () => {
    api.listCounselors.mockResolvedValue([]);
    await mount(createElement(UiV2OrgMembersPage));
    expect(text()).toContain('아직 소속된 코치가 없습니다');
    act(() => root.unmount()); container.remove();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    api.listCounselors.mockResolvedValue(primaryRows());
    await mount(createElement(UiV2OrgMembersPage), '/counselors?q=없는이름');
    expect(text()).toContain('검색 조건에 맞는 코치가 없습니다');
    act(() => root.unmount()); container.remove();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    api.getOrgDashboard.mockRejectedValue(new Error('목록 실패'));
    await mount(createElement(UiV2OrgMembersPage));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('목록 실패');
    expect(byText('button', '다시 시도')).not.toBeNull();
  });
});

describe('그룹핑', () => {
  it('활동 형태별로 개인 상담소/기관 소속을 나눈다', async () => {
    await mount(createElement(UiV2OrgMembersPage), '/counselors?group=office');
    const heads = [...container.querySelectorAll('.u2m-grouphead')].map((h) => h.textContent);
    expect(heads).toEqual(['개인 상담소 · 1명', '기관 소속 · 2명']);
  });
});

describe('U11 대시보드', () => {
  it('초대 폼·재발송·권한 변경 버튼이 없고 요약 4종 + 탭 링크만 있다', async () => {
    await mount(createElement(UiV2OrgDashboardPage), '/counselors');
    const html = container.innerHTML;
    expect(html).not.toMatch(/초대 발송|재발송|권한 회수|관리자로 지정|input type="email"/);
    expect(text()).not.toContain('초대·가입 현황');
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a[data-summary-tab]')].map((a) => [a.dataset.summaryTab, a.getAttribute('href')]);
    expect(links).toEqual([['coaches', '/counselors'], ['admins', '/counselors?tab=admins'], ['invites', '/counselors?tab=invites'], ['requests', '/counselors?tab=requests']]);
    const summary = container.querySelector('.u2m-summary')!.textContent!;
    for (const l of ['활성 코치', '활성 관리자', '초대 대기', '가입 요청']) expect(summary).toContain(l);
    expect(container.querySelector('a[data-members-shortcut]')?.getAttribute('href')).toBe('/counselors');
  });
  it('요약 숫자는 항목별로만 세고 합산 숫자를 만들지 않는다', () => {
    const s = summaryOf(primaryRows() as never, reqs() as never);
    expect(s).toEqual({ coaches: 3, admins: 2, invitesPending: 2, requestsPending: 1 });
    expect(Object.keys(s)).toEqual(['coaches', 'admins', 'invitesPending', 'requestsPending']);
  });
});

describe('API 도우미', () => {
  it('에러 code 를 최상위·detail 안 양쪽에서 읽는다', () => {
    expect(apiErrorCode(new ApiError(409, 'x', { code: 'LAST_ADMIN' }))).toBe('LAST_ADMIN');
    expect(apiErrorCode(new ApiError(409, 'x', { detail: { code: 'CANNOT_TARGET_SELF' } }))).toBe('CANNOT_TARGET_SELF');
    expect(apiErrorCode(new ApiError(500, 'x', null))).toBeNull();
    expect(orgErrorMessage(new ApiError(403, '서버 문구', { code: 'PRIMARY_ADMIN_REQUIRED' }), 'f')).toContain('대표 관리자만');
    expect(orgErrorMessage(new ApiError(500, '서버 문구', null), 'f')).toBe('서버 문구');
  });
});

describe('U20 금지 표현·정지 UI 부재', () => {
  const root2 = resolve(__dirname, '..');
  const files = [
    'src/pages/org/ui-v2/ui-v2-org-members-page.tsx',
    ...readdirSync(resolve(root2, 'src/pages/org/ui-v2/members')).map((f) => `src/pages/org/ui-v2/members/${f}`),
    'src/styles/ui-v2-org-members.css',
  ];
  it('화면 문구에 점수·종합점수·좋음·나쁨·완료·보증·100% 가 없다', () => {
    for (const f of files.filter((x) => /\.tsx?$/.test(x))) {
      const t = readFileSync(resolve(root2, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
      expect(t, f).not.toMatch(/점수|종합점수|좋음|나쁨|완료|보증|100\s*%/);
      expect(t, f).not.toMatch(/정지|재활성|비활성화|suspendCounselor|unsuspendCounselor/);
    }
  });
  it('구성원 화면은 역할 문자열로 버튼을 분기하지 않는다(allowed_actions 만)', () => {
    const t = readFileSync(resolve(root2, 'src/pages/org/ui-v2/members/member-list.tsx'), 'utf8');
    expect(t).not.toMatch(/user\?\.role|useAuthStore/);
    void ALL_MUTATING;
  });
});
