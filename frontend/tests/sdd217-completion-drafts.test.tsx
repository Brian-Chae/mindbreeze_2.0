// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HostClassDetailPage } from '../src/pages/classes/host-class-detail-page';
import { apiClient, ApiError } from '../src/lib/api/client';
import { useAuthStore } from '../src/stores/authStore';
import type { ClassDetailDto, ClassSessionDto } from '../src/lib/api/class-structure';
import type { User } from '../src/lib/api/auth';
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const user: User = { id: 'h', role: 'counselor', name: '합성 강사', email: 'synthetic@example.invalid', verified_tier: 'unverified', onboarding_completed: true, auth_provider: 'email', counselors: [] };
let detail: ClassDetailDto;
let sessions: ClassSessionDto[];
let root: Root; let box: HTMLDivElement;
let hold: Promise<ClassDetailDto> | null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); hold = null;
  detail = { id: 'c', revision: 1, title: '서버 이름', status: 'active', schedule_mode: 'fixed', planned_session_count: 1, area: 'meditation', progress: { completed: 0, total: 1 }, session_count: 1, next_session: null, has_open_session: false, location_type: 'online', location_address: null, capacity: 10, participant_mode: 'group', default_duration_min: 60, linkband_mode: 'optional', record_audio: false, record_video: false, chat_enabled: false, reminder_offsets: [], capabilities: { manage: true, invite: true, schedule: true, host_request: true },
    recurrence_rule: { version: 1, start_date: '2026-12-01', weekdays: [1], time: '19:00', interval_weeks: 1, skip_dates: [] }, assignment_rule: { version: 1, mode: 'all_one', host_ids: ['h'], weekday_hosts: {} }, host_view: { access_code: '1234', instructors: [{ user_id: 'h', name: '합성 강사', role: 'lead', status: 'active' }] } };
  sessions = [{ id: 's', seq: 1, status: 'scheduled', scheduled_at: '2026-12-21T10:00:00Z', session_kind: 'regular', host: { id: 'h', name: '합성 강사' }, host_state: 'assigned', state_version: 1, duration_min: 60, location_type: 'online', location_address: null }];
  useAuthStore.setState({ user, isAuthenticated: true }); box = document.createElement('div'); document.body.append(box); root = createRoot(box);
  vi.spyOn(apiClient, 'get').mockImplementation(path => {
    if (path === '/classes/c') return hold ?? Promise.resolve(structuredClone(detail));
    if (path === '/classes/c/sessions') return Promise.resolve({ sessions: structuredClone(sessions), total: sessions.length });
    if (path.endsWith('/members')) return Promise.resolve({ members: [] });
    if (path.endsWith('/email-invites')) return Promise.resolve({ invitations: [] });
    return Promise.resolve({ instructors: [] });
  });
  vi.spyOn(apiClient, 'patch').mockResolvedValue({}); vi.spyOn(apiClient, 'post').mockResolvedValue({});
});
afterEach(async () => { await act(async () => root.unmount()); box.remove(); useAuthStore.setState({ user: null, isAuthenticated: false }); vi.restoreAllMocks(); });
async function mount(tab: string) { await act(async () => root.render(<MemoryRouter initialEntries={[`/classes/c/${tab}`]}><Routes><Route path="/classes/:classId/*" element={<HostClassDetailPage/>}/></Routes></MemoryRouter>)); }
async function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
const titleInput = () => [...box.querySelectorAll<HTMLInputElement>('input')].find(input => input.closest('label')?.textContent?.startsWith('클래스 이름'))!;
async function click(label: string) { const button = [...box.querySelectorAll('button')].find(item => item.textContent === label); expect(button).toBeTruthy(); await act(async () => button!.click()); }
async function focus() { await act(async () => window.dispatchEvent(new Event('focus'))); }
it('설정 미저장 입력은 같은 revision의 새 객체 재조회 중과 완료 후에도 보존한다', async () => {
  await mount('settings'); const input = titleInput(); await change(input, '미저장 이름');
  let resolve!: (value: ClassDetailDto) => void; hold = new Promise(done => { resolve = done; });
  await focus(); expect(input.isConnected).toBe(true); expect(titleInput().value).toBe('미저장 이름');
  await act(async () => { resolve(structuredClone(detail)); });
  expect(titleInput().value).toBe('미저장 이름');
});
it('설정 dirty 기반 revision이 달라지면 입력을 보존하고 최신 서버 설정 덮어쓰기를 막는다', async () => {
  await mount('settings'); await change(titleInput(), '미저장 이름'); detail = { ...detail, revision: 2, title: '다른 강사의 변경' };
  await focus(); expect(titleInput().value).toBe('미저장 이름'); expect(box.textContent).toContain('다른 변경');
  await act(async () => box.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(apiClient.patch).not.toHaveBeenCalled();
  await click('입력 취소하고 최신 내용 불러오기'); expect(titleInput().value).toBe('다른 강사의 변경');
  await change(titleInput(), '확인 후 수정');
  await act(async () => box.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(apiClient.patch).toHaveBeenCalledWith('/classes/c', expect.objectContaining({ expected_revision: 2, schedule: expect.objectContaining({ title: '확인 후 수정' }) }));
});
it('편성 시트와 미저장 값은 focus 재조회 뒤에도 보존하고 서버 revision 충돌은 명시 처리한다', async () => {
  await mount('schedule'); await act(async () => box.querySelector<HTMLButtonElement>('[aria-label="1회차 편집"]')!.click());
  await change(box.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')!, '90');
  await focus(); expect(box.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('90');
  detail = { ...detail, revision: 2 }; sessions = sessions.map(row => ({ ...row, duration_min: 75, state_version: 2 }));
  await focus(); expect(box.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')?.value).toBe('90');
  expect(box.textContent).toContain('다른 변경'); await click('편집 내용 적용'); await click('변경 내용 확인'); expect(apiClient.post).not.toHaveBeenCalled();
  await click('입력 취소하고 최신 편성 불러오기'); expect(box.querySelector('[role="dialog"]')).toBeNull(); expect(box.textContent).toContain('75분');
});
it('초대 이메일·열린 회원 검색 입력은 visible/focus와 새 revision에도 유지한다', async () => {
  await mount('members'); await change(box.querySelector('textarea')!, 'draft@example.invalid'); await click('회원 초대');
  await change(box.querySelector<HTMLInputElement>('input[type="search"]')!, '검색 중인 회원');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  detail = { ...detail, revision: 2 }; await focus();
  expect(box.querySelector('textarea')?.value).toBe('draft@example.invalid');
  expect(box.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('검색 중인 회원');
});
it('일시 재조회 실패도 dirty 입력을 보존하고 서버 오류를 알린다', async () => {
  await mount('settings'); await change(titleInput(), '연결 복구 중인 입력'); hold = Promise.reject(new Error('합성 연결 실패')); void hold.catch(() => {});
  await focus(); expect(titleInput()?.value).toBe('연결 복구 중인 입력'); expect(box.textContent).toContain('최신 내용을 불러오지 못했어요');
});
it('편집하지 않은 설정과 회차는 새 서버 revision의 실제 값으로 갱신한다', async () => {
  await mount('settings'); detail = { ...detail, revision: 2, title: '최신 이름' }; await focus(); expect(titleInput().value).toBe('최신 이름');
});

it('접근 거부 응답은 이전 편집 화면을 계속 표시하지 않는다', async () => {
  await mount('settings'); await change(titleInput(), '회수 전 입력'); hold = Promise.reject(new ApiError(403, '접근 거부', null)); void hold.catch(() => {});
  await focus(); expect(titleInput()).toBeUndefined(); expect(box.textContent).not.toContain('회수 전 입력');
});
