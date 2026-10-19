// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSchedule, scheduleProblems } from '../src/lib/class-structure/scheduling-model';
import { ClassSchedulingWizard } from '../src/pages/classes/class-scheduling-wizard';
const mocks = vi.hoisted(() => ({ role: 'counselor', candidates: vi.fn(), preview: vi.fn(), create: vi.fn(), getClasses: vi.fn(), getClass: vi.fn(), update: vi.fn(), publish: vi.fn(), inviteEmails: vi.fn(), emailInvites: vi.fn(), retryEmail: vi.fn() }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: mocks }));
vi.mock('../src/lib/api/class-structure', () => ({ getClasses: mocks.getClasses, getClass: mocks.getClass }));
vi.mock('../src/components/class/structure/class-member-picker', () => ({ ClassMemberPicker: ({ onChange }: { onChange: (items: { userId: string; name: string }[]) => void }) => <button onClick={() => onChange([{ userId: 'member-one', name: '회원' }])}>회원 선택</button> }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'u1', role: mocks.role } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let box: HTMLDivElement; let root: Root;
const instantSchedule = () => { const base = defaultSchedule('u1'); return { ...base, title: '지금 명상', planned_session_count: 1, recurrence_rule: { ...base.recurrence_rule, start_now: true, start_date: '2020-01-01', time: '02:03' } }; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.role = 'counselor';
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }, { id: 'u2', name: '다른 지도사' }] });
  mocks.preview.mockImplementation(async schedule => ({ rows: [{ client_key: 'instant', seq: 1, scheduled_at: '2026-10-19T01:03:00Z', host_id: schedule.assignment_rule.host_ids[0] ?? null, duration_min: schedule.duration_min }], conflicts: [], conflict_fingerprint: 'fp' }));
  mocks.create.mockResolvedValue({ class_id: 'created-one', revision: 1, session_ids: ['open-session'] });
  mocks.getClass.mockResolvedValue({ host_view: { access_code: '2941' } });
  mocks.inviteEmails.mockResolvedValue({ invitations: [] });
  mocks.emailInvites.mockResolvedValue({ invitations: [] });
  mocks.retryEmail.mockResolvedValue({});
});
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); });
async function press(text: string) { const button = [...box.querySelectorAll('button')].find(x => x.textContent === text); expect(button, `버튼: ${text}`).toBeDefined(); await act(async () => button!.click()); }
async function input(label: string, value: string) { const element = box.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; expect(element).not.toBeNull(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function mount(entry = '/classes/new') { box = document.createElement('div'); document.body.append(box); root = createRoot(box); await act(async () => root.render(<RouterProvider router={createMemoryRouter([{ path: '*', element: <ClassSchedulingWizard /> }], { initialEntries: [entry] })} />)); if (!entry.includes('?')) { await press('처음부터 만들어요이름·일정·강사를 새로 정해요'); await input('클래스 이름', '지금 명상'); } }
async function chooseNow() { await mount(); await press('다음'); await press('바로 지금'); }
it('즉시는 과거 placeholder 날짜·야간 시각에도 유효하지만 일반 1회는 거절한다', () => {
  expect(scheduleProblems(instantSchedule())).toEqual([]);
  const regular = { ...defaultSchedule('u1'), title: '예약', planned_session_count: 1 };
  expect(scheduleProblems(regular)).toContain('횟수는 2~52회로 입력해 주세요.');
});
it('바로 지금은 날짜·시간·요일·횟수를 숨기고 길이를 유지하며 상담사 강사 단계를 건너뛴다', async () => {
  await chooseNow();
  for (const label of ['시작 날짜', '시작 시각', '요일', '횟수']) expect(box.querySelector(`[aria-label="${label}"]`)).toBeNull();
  expect(box.querySelector('[aria-label="소요 시간"]')).not.toBeNull();
  await press('다음'); expect(box.querySelector('[data-screen="CH14"]')).not.toBeNull();
  expect(box.querySelector('[aria-label="강사 수정"]')).toBeNull();
  expect(mocks.preview.mock.calls[0][0]).toMatchObject({ planned_session_count: 1, schedule_mode: 'fixed', recurrence_rule: { start_now: true }, assignment_rule: { mode: 'all_one', host_ids: ['u1'] }, rows: [], ends_on: null });
  await press('이전'); expect(box.querySelector('[data-screen="CH12"]')).not.toBeNull();
});
it('즉시에서 일반 fixed·rolling으로 전환하면 예약 입력·횟수와 강사 단계를 복원한다', async () => {
  await chooseNow(); await press('정해진 횟수');
  expect(box.querySelector('[aria-label="시작 날짜"]')).not.toBeNull();
  await press('다음'); expect(box.querySelector('[data-screen="CH13"]')).not.toBeNull();
  expect(mocks.preview.mock.calls.at(-1)[0]).toMatchObject({ planned_session_count: 8, recurrence_rule: { start_now: false } });
  await press('이전'); await press('바로 지금'); await press('계속 이어져요'); await press('다음');
  expect(mocks.preview.mock.calls.at(-1)[0]).toMatchObject({ schedule_mode: 'rolling', recurrence_rule: { start_now: false } });
});
it('관리자는 후보 중 한 명을 선택해야 즉시 초대 단계로 진행한다', async () => {
  mocks.role = 'org_admin'; await chooseNow(); await press('다음');
  expect(box.querySelector('[data-screen="CH13"]')).not.toBeNull();
  await press('다음'); expect(box.querySelector('[data-screen="CH14"]')).toBeNull();
  const select = box.querySelector<HTMLSelectElement>('[aria-label="진행 지도사"]')!;
  expect([...select.options].map(option => option.value)).toEqual(['', 'u1', 'u2']);
  await act(async () => { select.value = 'u2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await press('다음'); expect(box.querySelector('[data-screen="CH14"]')).not.toBeNull();
  expect(mocks.preview.mock.calls.at(-1)[0]).toMatchObject({ instructors: [{ user_id: 'u2', role: 'lead' }], assignment_rule: { mode: 'all_one', host_ids: ['u2'] }, rows: [] });
  await press('클래스 만들기');
  expect(box.querySelector('a[href="/classes/created-one/sessions/open-session"]')?.textContent).toBe('회차 확인하기');
  expect(box.querySelector('a[href="/sessions/open-session/player"]')).toBeNull();
});
it('회원·이메일 초대를 함께 보존하고 초대 실패 재시도는 클래스와 작업 키를 재생성하지 않는다', async () => {
  mocks.inviteEmails.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ invitations: [] });
  await chooseNow(); await press('다음'); await press('회원 선택'); await press('비회원 이메일'); await input('초대할 이메일', 'guest@example.com'); await press('추가');
  await press('초대할 멤버의 일정 확인'); await press('클래스 만들기');
  expect(mocks.create.mock.calls[0][0].schedule).toMatchObject({ member_ids: ['member-one'], rows: [], recurrence_rule: { start_now: true } });
  expect(box.querySelector('a[href="/sessions/open-session/player"]')?.textContent).toBe('진행 화면으로 이동');
  await press('초대 요청 다시 시도'); expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.inviteEmails.mock.calls[1]).toEqual(mocks.inviteEmails.mock.calls[0]);
});
it('즉시 초안 저장은 start_now를 유지하고 입장 링크를 만들지 않는다', async () => {
  await chooseNow(); await press('초안 저장');
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ status: 'draft', schedule: { recurrence_rule: { start_now: true }, planned_session_count: 1, rows: [] } });
  expect(box.querySelector('a[href="/classes/new?draft=created-one"]')).not.toBeNull();
  expect(box.textContent).not.toContain('진행 화면으로 이동');
});
it('오래된 즉시 초안을 재개해도 예약 날짜 오류 없이 게시하고 서버 회차로 이동한다', async () => {
  mocks.getClass.mockResolvedValueOnce({ status: 'draft', revision: 3, draft_schedule: instantSchedule(), capabilities: { schedule: true } });
  mocks.update.mockResolvedValue({ class_id: 'draft-one', revision: 4 });
  mocks.publish.mockResolvedValue({ class_id: 'draft-one', revision: 5, session_ids: ['published-now'] });
  await mount('/classes/new?draft=draft-one'); await press('다음'); await press('다음'); await press('클래스 만들기');
  expect(mocks.update.mock.calls[0][1].schedule.recurrence_rule.start_now).toBe(true);
  expect(mocks.publish.mock.calls[0][1].expected_revision).toBe(4);
  expect(box.querySelector('a[href="/sessions/published-now/player"]')).not.toBeNull();
});
it('즉시 프리뷰 충돌 동의를 유지하고 생성 요청에는 예약 row를 넣지 않는다', async () => {
  mocks.preview.mockResolvedValue({ rows: [{ client_key: 'instant', seq: 1, scheduled_at: '2026-10-19T01:03:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [{ kind: 'host', starts_at: '2026-10-19T01:03:00Z', visible: false }], conflict_fingerprint: 'instant-conflict' });
  await chooseNow(); await press('다음'); await press('클래스 만들기'); expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => box.querySelector<HTMLInputElement>('.cw-check input')!.click());
  await press('클래스 만들기');
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ force: true, confirmed_conflict_fingerprint: 'instant-conflict', schedule: { rows: [] } });
});

it('일반 예약의 요일을 모두 지운 뒤 즉시로 바꾸면 유효한 구조로 검사하고 예약 복귀 시 입력을 복원한다', async () => {
  mocks.preview.mockImplementation(async schedule => {
    if (!schedule.recurrence_rule.weekdays.length) throw new Error('요일 구조 오류');
    return { rows: [{ client_key: 'instant', seq: 1, scheduled_at: '2026-10-19T01:03:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' };
  });
  await mount(); await press('다음');
  const weekdays = [...box.querySelectorAll<HTMLButtonElement>('[aria-label="요일"] button[aria-pressed="true"]')];
  for (const day of weekdays) await act(async () => day.click());
  await press('바로 지금'); await press('다음');
  expect(box.querySelector('[data-screen="CH14"]')).not.toBeNull();
  expect(mocks.preview.mock.calls[0][0].recurrence_rule).toEqual({ ...defaultSchedule('u1').recurrence_rule, start_now: true });
  await press('이전'); await press('정해진 횟수');
  expect(box.querySelectorAll('[aria-label="요일"] button[aria-pressed="true"]')).toHaveLength(0);
});

it('완료 화면은 실제 발송 대기·실패·처리됨 상태를 조회하고 수동 새로고침한다', async () => {
  const invitation = { id: 'invite-one', email: 'guest@example.com', status: 'pending', created_at: '2026-10-19T01:00:00Z', sent_at: null };
  mocks.emailInvites.mockResolvedValueOnce({ invitations: [invitation] }).mockResolvedValueOnce({ invitations: [{ ...invitation, status: 'failed' }] }).mockResolvedValueOnce({ invitations: [{ ...invitation, status: 'sent' }] });
  await chooseNow(); await press('다음'); await press('비회원 이메일'); await input('초대할 이메일', invitation.email); await press('추가'); await press('클래스 만들기');
  expect(box.textContent).toContain('발송 대기');
  await press('발송 상태 새로고침'); expect(box.textContent).toContain('발송 실패');
  await press('발송 상태 새로고침'); expect(box.textContent).toContain('발송 처리됨');
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it('실제 발송 실패 재시도는 최신 버전·관리자 사유와 같은 작업 키를 쓰며 클래스를 재생성하지 않는다', async () => {
  const invitation = { id: 'invite-one', email: 'guest@example.com', status: 'failed', created_at: '2026-10-19T01:00:00Z', sent_at: null };
  mocks.role = 'org_admin';
  mocks.emailInvites.mockResolvedValue({ invitations: [invitation] });
  mocks.retryEmail.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({});
  mocks.getClass.mockResolvedValue({ revision: 7, host_view: { access_code: '2941' } });
  await chooseNow(); await press('다음');
  const select = box.querySelector<HTMLSelectElement>('[aria-label="진행 지도사"]')!;
  await act(async () => { select.value = 'u2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await press('다음'); await press('비회원 이메일'); await input('초대할 이메일', invitation.email); await press('추가');
  const reason = box.querySelector<HTMLTextAreaElement>('[aria-label="센터 관리자 대행 사유"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, '즉시 수업 초대 지원'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
  await press('클래스 만들기'); await press('다시 보내기');
  expect(mocks.retryEmail.mock.calls[0]).toEqual(['created-one', 'invite-one', expect.objectContaining({ expected_revision: 7, reason: '즉시 수업 초대 지원', operation_key: expect.any(String) })]);
  await press('다시 보내기');
  expect(mocks.retryEmail.mock.calls[1]).toEqual(mocks.retryEmail.mock.calls[0]);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
