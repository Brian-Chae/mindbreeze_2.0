// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultSchedule } from '../src/lib/class-structure/scheduling-model';
import { ClassSchedulingWizard } from '../src/pages/classes/class-scheduling-wizard';
const mocks = vi.hoisted(() => ({ candidates: vi.fn(), preview: vi.fn(), create: vi.fn(), getClasses: vi.fn(), getClass: vi.fn(), update: vi.fn() }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: mocks }));
vi.mock('../src/lib/api/class-structure', () => ({ getClasses: mocks.getClasses, getClass: mocks.getClass }));
vi.mock('../src/components/class/structure/class-member-picker', () => ({ ClassMemberPicker: ({ onChange }: { onChange: (items: { userId: string; name: string }[]) => void }) => <button onClick={() => onChange([{ userId: 'member-one', name: '회원' }])}>회원 선택</button> }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'u1', name: '지도사', role: 'counselor' } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let box: HTMLDivElement; let root: Root;
async function mount(start = true, initialEntry = '/classes/new') { box = document.createElement('div'); document.body.append(box); root = createRoot(box); await act(async () => root.render(<RouterProvider router={createMemoryRouter([{ path: '*', element: <ClassSchedulingWizard /> }], { initialEntries: [initialEntry] })} />)); if (start) await press('처음부터 만들어요이름·일정·강사를 새로 정해요'); }
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); });
it('4단계와 기본값을 표시하고 이름 없이 다음 단계에 가지 않는다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  await mount();
  expect(box.querySelectorAll('[aria-label="편성 단계"] li')).toHaveLength(4);
  expect(box.querySelector<HTMLInputElement>('[name="capacity"]')?.value).toBe('10');
  await act(async () => [...box.querySelectorAll('button')].find(x => x.textContent === '다음')!.click());
  expect(box.textContent).toContain('클래스 이름은 1~200자');
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
});
it('편성이 비활성화되어 후보 조회가 실패하면 생성하지 않는다', async () => {
  mocks.candidates.mockRejectedValue(new Error('secret'));
  await mount();
  expect(box.textContent).not.toContain('secret');
  expect(box.querySelector<HTMLButtonElement>('[data-save-draft]')?.disabled).toBe(true);
});
async function input(name: string, value: string) { const element = box.querySelector<HTMLInputElement>(`[name="${name}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function press(text: string) { await act(async () => [...box.querySelectorAll('button')].find(x => x.textContent === text)!.click()); }
it('4단계를 거쳐 실제 편성 저장 중 두 번 눌러도 생성은 한 번이다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.preview.mockResolvedValue({ rows: [{ client_key: 'regular:2026-12-21', seq: 1, scheduled_at: '2026-12-21T10:00:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' });
  mocks.create.mockImplementation(() => new Promise(() => {}));
  await mount(); await input('title', '마음 명상'); await press('다음'); await press('다음'); await press('다음');
  await act(async () => { const button = [...box.querySelectorAll('button')].find(x => x.textContent === '클래스 만들기')!; button.click(); button.click(); });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ status: 'active', schedule: { title: '마음 명상' } });
});
it('미정 회차는 확인 단계로 넘어갈 수 없고 초안 저장은 가능하다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.preview.mockResolvedValue({ rows: [{ client_key: 'regular:2026-12-21', seq: 1, scheduled_at: '2026-12-21T10:00:00Z', host_id: null, duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' });
  mocks.create.mockImplementation(() => new Promise(() => {}));
  await mount(); await input('title', '마음 명상'); await press('다음'); await press('다음'); await press('다음');
  expect(box.textContent).toContain('진행 지도사가 미정인 회차');
  expect(box.querySelector('[aria-current="step"]')?.textContent).toContain('강사 배정');
  await press('초안 저장'); expect(mocks.create.mock.calls[0][0].status).toBe('draft');
});
it('충돌 동의 없이는 생성하지 않는다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.preview.mockResolvedValue({ rows: [{ client_key: 'regular:2026-12-21', seq: 1, scheduled_at: '2026-12-21T10:00:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [{ kind: 'host', starts_at: '2026-12-21T10:00:00Z', visible: false, parent_title: '비공개 제목' }], conflict_fingerprint: 'fp' });
  await mount(); await input('title', '마음 명상'); await press('다음'); await press('다음'); await press('다음'); await press('클래스 만들기');
  expect(mocks.create).not.toHaveBeenCalled(); expect(box.textContent).not.toContain('비공개 제목');
  expect(box.textContent).toContain('겹치는 일정을 확인해 주세요');
});

it('시작 방법에서 완료된 실제 클래스 목록을 읽고 선택할 때만 복제를 진행한다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.getClasses.mockResolvedValue({ classes: [{ id: 'class-old', title: '지난 명상', schedule_mode: 'fixed', planned_session_count: 8, session_count: 8, status: 'completed' }], total: 1 });
  await mount(false);
  expect(box.querySelector('[data-screen="CH10"]')).not.toBeNull();
  await press('지난 클래스 그대로 시작해요요일·시각·횟수·강사 배정을 가져와요');
  expect(mocks.getClasses).toHaveBeenCalledWith({ status: 'completed', limit: 20 }, expect.any(AbortSignal));
  expect(box.querySelector('[role="dialog"]')?.textContent).toContain('지난 명상');
  expect([...box.querySelectorAll('button')].find(x => x.textContent === '이 클래스로 시작')?.disabled).toBe(true);
});
it('기본 정보는 승인된 중앙 카드·하단 버튼 구조와 단계점을 사용한다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  await mount();
  expect(box.querySelector('.fl-body .fl-col .fl-card.strong')).not.toBeNull();
  expect(box.querySelector('.fl-foot .fl-btn.primary')?.textContent).toBe('다음');
  expect(box.querySelectorAll('.fl-steps li')).toHaveLength(4);
  expect(box.querySelector('.cs-sidebar')).toBeNull();
});
it('회원 선택 변경은 이전 충돌 검사를 폐기하고 재검사한 UUID로 생성한다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.preview.mockResolvedValue({ rows: [{ client_key: 'regular:2026-12-21', seq: 1, scheduled_at: '2026-12-21T10:00:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' });
  mocks.create.mockImplementation(() => new Promise(() => {}));
  await mount(); await input('title', '마음 명상'); await press('다음'); await press('다음'); await press('다음');
  await press('회원 선택'); await press('클래스 만들기');
  expect(mocks.create).not.toHaveBeenCalled();
  await press('초대할 멤버의 일정 확인'); await press('클래스 만들기');
  expect(mocks.preview.mock.calls.at(-1)[0].member_ids).toEqual(['member-one']);
  expect(mocks.create.mock.calls[0][0].schedule.member_ids).toEqual(['member-one']);
});
it('초안 저장 완료는 공개 코드나 발송 완료를 꾸미지 않고 이어서 하기 경로를 표시한다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.create.mockResolvedValue({ class_id: 'draft-one', revision: 1 });
  await mount(); await input('title', '임시 명상'); await press('초안 저장');
  expect(box.querySelector('[data-screen="CH15"]')).not.toBeNull();
  expect(box.textContent).toContain('편성을 저장했어요');
  expect(box.querySelector('a[href="/classes/new?draft=draft-one"]')).not.toBeNull();
  expect(box.textContent).not.toContain('클래스 코드');
  expect(mocks.getClass).not.toHaveBeenCalled();
});
it('공개 완료는 서버가 돌려준 첫 회차로 이동한다', async () => {
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.preview.mockResolvedValue({ rows: [{ client_key: 'regular:2026-12-21', seq: 1, scheduled_at: '2026-12-21T10:00:00Z', host_id: 'u1', duration_min: 60 }], conflicts: [], conflict_fingerprint: 'fp' });
  mocks.create.mockResolvedValue({ class_id: 'created-one', revision: 1, session_ids: ['session-first', 'session-second'] });
  mocks.getClass.mockResolvedValue({ host_view: { access_code: '2941' } });
  await mount(); await input('title', '마음 명상'); await press('다음'); await press('다음'); await press('다음'); await press('클래스 만들기');
  expect(box.querySelector('a[href="/classes/created-one/sessions/session-first"]')?.textContent).toBe('첫 회차 보러 가기');
  expect(box.querySelector('.w-codebig')?.textContent).toBe('2941');
});

it('같은 초안 재저장 뒤 이어서 하기는 최신 초안과 revision을 다시 읽는다', async () => {
  const schedule = { ...defaultSchedule('u1'), title: '이어 쓸 초안' };
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.getClass.mockResolvedValueOnce({ status: 'draft', revision: 3, draft_schedule: schedule, capabilities: { schedule: true } })
    .mockResolvedValueOnce({ status: 'draft', revision: 5, draft_schedule: { ...schedule, title: '서버의 최신 초안' }, capabilities: { schedule: true } });
  mocks.update.mockResolvedValueOnce({ class_id: 'draft-existing', revision: 4 }).mockResolvedValueOnce({ class_id: 'draft-existing', revision: 6 });
  await mount(false, '/classes/new?draft=draft-existing');
  await press('초안 저장');
  expect(box.textContent).toContain('편성을 저장했어요');
  await act(async () => box.querySelector<HTMLAnchorElement>('a[href="/classes/new?draft=draft-existing"]')!.click());
  expect(box.querySelector('[data-screen="CH11"]')).not.toBeNull();
  expect(mocks.getClass).toHaveBeenCalledTimes(2);
  expect(box.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe('서버의 최신 초안');
  await press('초안 저장');
  expect(mocks.update.mock.calls[1][1].expected_revision).toBe(5);
  expect(mocks.update.mock.calls[1][1].operation_key).not.toBe(mocks.update.mock.calls[0][1].operation_key);
});
