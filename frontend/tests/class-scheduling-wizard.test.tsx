// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ClassSchedulingWizard } from '../src/pages/classes/class-scheduling-wizard';
const mocks = vi.hoisted(() => ({ candidates: vi.fn(), preview: vi.fn(), create: vi.fn() }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: mocks }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'u1', name: '지도사', role: 'counselor' } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let box: HTMLDivElement; let root: Root;
async function mount() { box = document.createElement('div'); document.body.append(box); root = createRoot(box); await act(async () => root.render(<RouterProvider router={createMemoryRouter([{ path: '*', element: <ClassSchedulingWizard /> }])} />)); }
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
