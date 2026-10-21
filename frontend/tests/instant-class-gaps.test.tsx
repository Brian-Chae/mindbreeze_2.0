// @vitest-environment jsdom
// SDD-226 검증 보강: 기존 테스트가 다루지 않는 분기(이메일 초대 실패·재시도, 정원, 관리자 대행 사유,
// 장소 충돌, 생성 시 409 충돌, 지도사 없는 미리보기, 직접 입력 검증, 저장 시점). 모든 API는 대역이다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstantClassPage } from '../src/pages/classes/instant-class-page';
import { ApiError } from '../src/lib/api/client';
import { defaultInstantSettings, instantSchedule } from '../src/lib/class-structure/instant-class-model';

const mocks = vi.hoisted(() => ({
  candidates: vi.fn(), preview: vi.fn(), create: vi.fn(), getClass: vi.fn(), inviteEmails: vi.fn(),
  emailInvites: vi.fn(), retryEmail: vi.fn(), role: 'counselor',
  selection: { members: [] as { userId: string; name: string }[], emails: [] as string[] },
}));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: mocks }));
vi.mock('../src/lib/api/class-structure', () => ({ getClass: mocks.getClass }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'u1', name: '지도사', role: mocks.role } }) }));
vi.mock('../src/pages/classes/instant-invite-sheet', () => ({
  InstantInviteSheet: ({ onSent }: { onSent: (value: typeof mocks.selection) => void }) => <button onClick={() => onSent(mocks.selection)}>선택 적용</button>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let box: HTMLDivElement; let root: Root;
const ok = { rows: [{ host_id: 'u1' }], conflicts: [], conflict_fingerprint: 'fp' };
beforeEach(() => {
  localStorage.clear(); mocks.role = 'counselor'; mocks.selection = { members: [], emails: [] };
  mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] });
  mocks.preview.mockResolvedValue(ok);
  mocks.create.mockResolvedValue({ class_id: 'c1', revision: 1, session_ids: ['s1'] });
  mocks.getClass.mockResolvedValue({ id: 'c1', title: '즉석', revision: 3, capacity: 10, host_view: { access_code: 'ABCD' } });
  mocks.inviteEmails.mockResolvedValue({});
  mocks.emailInvites.mockResolvedValue({ invitations: [] });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); });

async function mount() {
  box = document.createElement('div'); document.body.append(box); root = createRoot(box);
  await act(async () => root.render(<RouterProvider router={createMemoryRouter([{ path: '*', element: <InstantClassPage /> }], { initialEntries: ['/classes/now'] })} />));
}
const button = (text: string) => [...box.querySelectorAll('button')].find(item => item.textContent === text);
async function press(text: string) { const target = button(text); if (!target) throw new Error(`버튼 없음: ${text}`); await act(async () => target.click()); }
async function type(selector: string, value: string, proto: 'input' | 'select' = 'input') {
  const element = box.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  const prototype = proto === 'select' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(proto === 'select' ? 'change' : 'input', { bubbles: true })); });
}
async function selectInvites(selection: typeof mocks.selection) {
  mocks.selection = selection;
  await act(async () => (box.querySelector('.ic-invite') as HTMLButtonElement).click());
  await press('선택 적용');
}
const alertText = () => [...box.querySelectorAll('[role="alert"]')].map(item => item.textContent).join(' | ');

describe('즉석 클래스 — 이메일 초대 실패·재시도', () => {
  it('생성 뒤 이메일 초대가 실패해도 클래스는 유지되고 같은 명령으로 재시도된다', async () => {
    mocks.inviteEmails.mockRejectedValueOnce(new Error('연결'));
    await mount(); await selectInvites({ members: [], emails: ['a@example.com'] }); await press('지금 열기');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(box.querySelector('[data-screen="IC-04"]')).not.toBeNull();
    expect(alertText()).toContain('클래스는 열렸지만 이메일 초대를 보내지 못했어요');
    expect(button('이메일 초대 다시 보내기')).toBeTruthy();
    await press('이메일 초대 다시 보내기');
    expect(mocks.inviteEmails).toHaveBeenCalledTimes(2);
    expect(mocks.inviteEmails.mock.calls[1][1].operation_key).toBe(mocks.inviteEmails.mock.calls[0][1].operation_key);
    expect(mocks.inviteEmails.mock.calls[1][1]).toMatchObject({ emails: ['a@example.com'], expected_revision: 3 });
    expect(mocks.create).toHaveBeenCalledTimes(1); // 재시도가 클래스를 새로 만들지 않는다
    expect(alertText()).toBe('');
  });
});

describe('즉석 클래스 — 정원·관리자 대행 사유', () => {
  it('초대 인원이 정원을 넘으면 생성하지 않는다', async () => {
    await mount();
    await selectInvites({ members: [], emails: Array.from({ length: 11 }, (_, index) => `m${index}@example.com`) });
    await press('지금 열기');
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
    expect(alertText()).toContain('초대 인원이 정원을 초과했어요');
  });
  it('관리자는 이메일 초대 시 대행 사유가 없으면 생성하지 않고, 입력하면 사유와 함께 보낸다', async () => {
    mocks.role = 'org_admin'; await mount();
    await type('select[aria-label="진행 지도사"]', 'u1', 'select');
    await selectInvites({ members: [], emails: ['a@example.com'] });
    await press('지금 열기');
    expect(mocks.create).not.toHaveBeenCalled(); expect(alertText()).toContain('센터 관리자 대행 사유');
    await type('input[aria-label="센터 관리자 대행 사유"]', '현장 요청');
    await press('지금 열기');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.inviteEmails.mock.calls[0][1]).toMatchObject({ reason: '현장 요청', emails: ['a@example.com'] });
  });
  it('관리자가 지도사를 고르면 해당 지도사 1명으로 만든다', async () => {
    mocks.role = 'org_admin'; await mount();
    await type('select[aria-label="진행 지도사"]', 'u1', 'select'); await press('지금 열기');
    expect(mocks.create.mock.calls[0][0].schedule.assignment_rule).toMatchObject({ mode: 'all_one', host_ids: ['u1'] });
  });
});

describe('즉석 클래스 — 충돌·검증 분기', () => {
  it('장소 충돌만 있으면 확인 시트 없이 바로 만든다(기존 마법사와 동일 규칙)', async () => {
    mocks.preview.mockResolvedValue({ ...ok, conflicts: [{ kind: 'place', visible: true, parent_title: 'x', starts_at: '2026-10-21T06:00:00Z' }] });
    await mount(); await press('지금 열기');
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('force');
  });
  it('미리보기에 진행자가 비어 있으면 생성하지 않는다', async () => {
    mocks.preview.mockResolvedValue({ ...ok, rows: [{ host_id: null }] });
    await mount(); await press('지금 열기');
    expect(mocks.create).not.toHaveBeenCalled(); expect(alertText()).toContain('진행 지도사를 확인해 주세요');
  });
  it('생성 시점 409 schedule_conflict 는 확인 시트를 띄우고 새 fingerprint 로 강제 생성한다', async () => {
    const conflict = new ApiError(409, 'conflict', { detail: { code: 'schedule_conflict', conflicts: [{ kind: 'host', visible: true, parent_title: '기존 수업', starts_at: '2026-10-21T06:00:00Z' }], conflict_fingerprint: 'fp-new' } });
    mocks.create.mockRejectedValueOnce(conflict);
    await mount(); await press('지금 열기');
    expect(box.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(box.textContent).toContain('기존 수업');
    await press('그대로 열기');
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ force: true, confirmed_conflict_fingerprint: 'fp-new' });
  });
  it('5분 단위가 아닌 직접 입력 시간은 생성하지 않는다', async () => {
    await mount();
    await act(async () => (box.querySelector('button[aria-label="직접 입력"]') as HTMLButtonElement).click());
    await type('input[aria-label="소요 시간 직접 입력"]', '7'); await press('지금 열기');
    expect(mocks.create).not.toHaveBeenCalled(); expect(alertText()).toContain('5분 단위');
  });
  it('생성에 실패하면 지난 설정을 저장하지 않는다', async () => {
    mocks.create.mockRejectedValueOnce(new Error('연결'));
    await mount(); await press('지금 열기');
    expect(localStorage.getItem('mb:instant-class:last:u1')).toBeNull();
  });
  it('코드 조회 전에는 코드 복사를 막는다', async () => {
    mocks.getClass.mockResolvedValue({ id: 'c1', title: '즉석', revision: 1, capacity: 10 });
    await mount(); await press('지금 열기');
    expect(box.textContent).toContain('확인 중…'); expect((button('코드 복사') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('즉석 클래스 모델 — 오프라인 영상 녹화', () => {
  it('오프라인이면 영상 녹화가 켜져 있어도 보내지 않는다', () => {
    const value = instantSchedule({ ...defaultInstantSettings(), location_type: 'offline', location_address: '서울', record_video: true }, 'h1', '즉석');
    expect(value.record_video).toBe(false);
  });
});

describe('즉석 클래스 — 공용 입장 링크', () => {
  it('VITE_PUBLIC_APP_URL이 있으면 앱(Capacitor)에서도 그 공용 주소로 회차 입장 링크를 만든다(코드·QR 없음)', async () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://dev.example.test/');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      await mount(); await press('지금 열기'); await press('입장 링크 복사');
      expect(writeText).toHaveBeenLastCalledWith('https://dev.example.test/class/s1/enter');
      expect(String(writeText.mock.calls.at(-1)?.[0])).not.toContain('ABCD');
      expect(box.querySelector('img')).toBeNull();
    } finally { vi.unstubAllEnvs(); }
  });
});
