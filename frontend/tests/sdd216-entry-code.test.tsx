// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
const mocks = vi.hoisted(() => ({ post: vi.fn(), verify: vi.fn(), authenticated: true, user: { role: 'client', name: 'member', email: 'member@test.invalid' } }));
vi.mock('../src/lib/api/client', async (original) => ({ ...(await original<typeof import('../src/lib/api/client')>()), apiClient: { post: mocks.post } }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ isAuthenticated: mocks.authenticated, user: mocks.authenticated ? mocks.user : null }) }));
vi.mock('../src/lib/api/client-profile', () => ({ getClientProfile: () => Promise.resolve({}) }));
vi.mock('../src/lib/api/class-flow', async (original) => ({ ...(await original<typeof import('../src/lib/api/class-flow')>()), verifyEntryCode: mocks.verify }));
vi.mock('../src/components/class/flow/member/CodeEntryView', () => ({ CodeEntryView: (props: { onChange: (s: string) => void; onSubmit: () => void; status: string }) => <><button onClick={() => props.onChange('0042')}>코드 채우기</button><button onClick={props.onSubmit}>확인</button><p>{props.status}</p></> }));
vi.mock('../src/components/class/flow/member/ProfileEntryView', () => ({ ProfileEntryView: () => <p>기존 개인정보 입력</p> }));
import CodeEntryPage from '../src/pages/class/CodeEntryPage';
let root: Root; let container: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) }); mocks.post.mockReset(); mocks.verify.mockReset(); mocks.authenticated = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function Location() { const loc = useLocation(); return <p>{loc.pathname}{loc.search}</p>; }
async function click(text: string) { const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); }
async function start() { await act(async () => root.render(<MemoryRouter><Routes><Route path="/" element={<CodeEntryPage />} /><Route path="/app/classes/:id" element={<Location />} /></Routes></MemoryRouter>)); await click('코드 채우기'); await click('확인'); }
it('미래 일정만 있어도 확인 후 회원 가입하고 클래스 상세로 이동한다', async () => {
  mocks.post.mockResolvedValueOnce({ class_id: 'c1', title: '주간 명상', sessions: [], next_session: { session_id: 's2', scheduled_at: '2030-01-01T09:00:00Z', status: 'scheduled', seq: 2 } }).mockResolvedValueOnce({ class_id: 'c1', member_id: 'm1', status: 'active' });
  await start(); expect(container.textContent).toContain('주간 명상'); expect(mocks.verify).not.toHaveBeenCalled();
  await click('클래스 가입하기');
  expect(mocks.post).toHaveBeenNthCalledWith(1, '/classes/resolve-code', { code: '0042' }, expect.objectContaining({ skipAuth: true }));
  expect(mocks.post).toHaveBeenNthCalledWith(2, '/classes/c1/join', { code: '0042' }, expect.anything());
  expect(container.textContent).toContain('/app/classes/c1'); expect(container.textContent).not.toContain('0042');
});
it('클래스 조회 404만 기존 단건 코드 확인으로 이어진다', async () => {
  mocks.post.mockRejectedValue(new ApiError(404, '없음', null)); mocks.verify.mockResolvedValue({ title: '기존 클래스' });
  await start(); expect(mocks.verify).toHaveBeenCalledWith('0042'); expect(container.textContent).toContain('기존 개인정보 입력');
});
it.each([403, 429])('조회 %s는 기존 코드 조회로 숨기지 않는다', async (status) => {
  mocks.post.mockRejectedValue(new ApiError(status, '실패', null));
  await start(); expect(mocks.verify).not.toHaveBeenCalled(); expect(container.textContent).toContain(status === 429 ? 'throttled' : 'unavailable');
});
it('비회원은 기존 회차별 입장 자격 흐름을 유지한다', async () => {
  mocks.authenticated = false; mocks.verify.mockResolvedValue({ title: '회차' });
  await start(); expect(mocks.post).not.toHaveBeenCalled(); expect(container.textContent).toContain('기존 개인정보 입력');
});
it('열린 회차가 하나면 가입 후 해당 회차를 선택한다', async () => {
  mocks.post.mockResolvedValueOnce({ class_id: 'c1', title: '주간 명상', sessions: [{ session_id: 's1', seq: 1, scheduled_at: null, status: 'open' }], next_session: null }).mockResolvedValueOnce({ class_id: 'c1', member_id: 'm1', status: 'active' });
  await start(); await click('클래스 가입하기'); expect(container.textContent).toContain('/app/classes/c1?sessionId=s1');
});
it('열린 회차가 둘이면 자동 선택 없이 클래스 상세로 간다', async () => {
  mocks.post.mockResolvedValueOnce({ class_id: 'c1', title: '주간 명상', sessions: [{ session_id: 's1' }, { session_id: 's2' }], next_session: null }).mockResolvedValueOnce({ class_id: 'c1', member_id: 'm1', status: 'active' });
  await start(); await click('클래스 가입하기'); expect(container.textContent).toBe('/app/classes/c1');
});
it('가입 403이면 안내하고 기존 단건 입장으로 우회하지 않는다', async () => {
  mocks.post.mockResolvedValueOnce({ class_id: 'c1', title: '주간 명상', sessions: [], next_session: null }).mockRejectedValueOnce(new ApiError(403, 'member_only', null));
  await start(); await click('클래스 가입하기'); expect(container.textContent).toContain('이 계정으로는 클래스에 가입할 수 없어요.'); expect(mocks.verify).not.toHaveBeenCalled();
});
