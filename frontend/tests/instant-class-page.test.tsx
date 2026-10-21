// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InstantClassPage } from '../src/pages/classes/instant-class-page';
const mocks = vi.hoisted(() => ({ candidates: vi.fn(), preview: vi.fn(), create: vi.fn(), getClass: vi.fn(), emailInvites: vi.fn(), role: 'counselor' }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: mocks }));
vi.mock('../src/lib/api/class-structure', () => ({ getClass: mocks.getClass }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'u1', name: '지도사', role: mocks.role } }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr') } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let box: HTMLDivElement; let root: Root;
beforeEach(() => { localStorage.clear(); mocks.role = 'counselor'; mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '지도사' }] }); mocks.preview.mockResolvedValue({ rows: [{ host_id: 'u1' }], conflicts: [], conflict_fingerprint: 'fp' }); mocks.create.mockResolvedValue({ class_id: 'c1', revision: 1, session_ids: ['s1'] }); mocks.getClass.mockResolvedValue({ id: 'c1', title: '즉석', revision: 1, capacity: 10, host_view: { access_code: 'ABCD' } }); mocks.emailInvites.mockResolvedValue({ invitations: [] }); });
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); });
async function mount(path = '/classes/now') { box = document.createElement('div'); document.body.append(box); root = createRoot(box); await act(async () => root.render(<RouterProvider router={createMemoryRouter([{ path: '*', element: <InstantClassPage /> }], { initialEntries: [path] })} />)); }
async function press(text: string) { await act(async () => [...box.querySelectorAll('button')].find(button => button.textContent === text)!.click()); }
it('입력 없이 열고 공유 화면에 머물며 회차 입장 링크를 제공한다', async () => { await mount(); await press('지금 열기'); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.create.mock.calls[0][0]).toMatchObject({ status: 'active', schedule: { duration_min: 30, recurrence_rule: { start_now: true } } }); expect(box.textContent).toContain('ABCD'); expect(box.querySelector('a[href="/sessions/s1/player"]')).not.toBeNull(); expect(localStorage.getItem('mb:instant-class:last:u1')).not.toBeNull(); });
it('관리자는 지도사 선택 전 열 수 없다', async () => { mocks.role = 'org_admin'; await mount(); expect([...box.querySelectorAll('button')].find(button => button.textContent === '지금 열기')?.disabled).toBe(true); expect(box.querySelector('select[aria-label="진행 지도사"]')).not.toBeNull(); });
it('충돌 시 확인 한 번 뒤 fingerprint와 force를 전송한다', async () => { mocks.preview.mockResolvedValue({ rows: [{ host_id: 'u1' }], conflicts: [{ kind: 'host', visible: false, parent_title: '비공개', starts_at: '2026-10-21T06:00:00Z' }], conflict_fingerprint: 'fp' }); await mount(); await press('지금 열기'); expect(mocks.create).not.toHaveBeenCalled(); expect(box.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(box.textContent).not.toContain('비공개'); await press('그대로 열기'); expect(mocks.create.mock.calls[0][0]).toMatchObject({ force: true, confirmed_conflict_fingerprint: 'fp' }); });
it('실패한 같은 입력 재시도는 operation_key를 유지한다', async () => { mocks.create.mockRejectedValueOnce(new Error('연결')); await mount(); await press('지금 열기'); await press('지금 열기'); expect(mocks.create.mock.calls[0][0].operation_key).toBe(mocks.create.mock.calls[1][0].operation_key); });
it('오프라인은 주소 없이 열 수 없다', async () => { await mount(); await press('오프라인(대면)'); expect([...box.querySelectorAll('button')].find(button => button.textContent === '지금 열기')?.disabled).toBe(true); });
it('더블 클릭에도 preview와 생성은 한 번이다', async () => { await mount(); await act(async () => { const button = [...box.querySelectorAll('button')].find(item => item.textContent === '지금 열기')!; button.click(); button.click(); }); expect(mocks.preview).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(1); });
it('공유 링크와 QR에는 코드가 들어가지 않는다', async () => { const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); await mount(); await press('지금 열기'); await press('코드 복사'); expect(writeText).toHaveBeenLastCalledWith('ABCD'); await press('입장 링크 복사'); expect(writeText).toHaveBeenLastCalledWith(`${location.origin}/join`); expect(box.querySelector('[data-join-url]')?.getAttribute('data-join-url')).toBe(`${location.origin}/join`); });
it('지난 사용자 설정을 복원한다', async () => { localStorage.setItem('mb:instant-class:last:u1', JSON.stringify({ duration_min: 35, location_type: 'offline', location_address: '서울 명상실', capacity: 8, linkband_mode: 'none', record_audio: false, record_video: false, chat_enabled: true })); await mount(); expect(box.querySelector<HTMLInputElement>('[aria-label="소요 시간 직접 입력"]')?.value).toBe('35'); expect(box.querySelector<HTMLInputElement>('[aria-label="장소 주소"]')?.value).toBe('서울 명상실'); await press('지금 열기'); expect(mocks.create.mock.calls[0][0].schedule).toMatchObject({ duration_min: 35, capacity: 8, location_address: '서울 명상실' }); });

it('다시 열기는 원본 설정을 채우고 새 제목으로 새 클래스를 만든다', async () => {
 mocks.getClass.mockResolvedValue({ id: 'source', title: '이전 제목', default_duration_min: 35, location_type: 'offline', location_address: '부산 명상실', capacity: 6, linkband_mode: 'none', record_audio: false, record_video: false, chat_enabled: true, host_view: { instructors: [{ user_id: 'u1', role: 'lead' }] } });
 await mount('/classes/now?from=source');
 expect(mocks.getClass).toHaveBeenCalledWith('source', expect.any(AbortSignal));
 expect(box.querySelector<HTMLInputElement>('[aria-label="소요 시간 직접 입력"]')?.value).toBe('35');
 expect(box.querySelector<HTMLInputElement>('[aria-label="장소 주소"]')?.value).toBe('부산 명상실');
 expect(box.querySelector<HTMLInputElement>('[aria-label="클래스 이름"]')?.value).toMatch(/^즉석 명상 ·/);
 await press('지금 열기');
 expect(mocks.create.mock.calls[0][0].schedule).toMatchObject({ duration_min: 35, capacity: 6, location_address: '부산 명상실', record_audio: false, chat_enabled: true });
});
