// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../src/lib/api/client';
import { transitionSession, type SessionDto } from '../src/lib/api/session';
import { useClasses, useClassDetail } from '../src/hooks/use-class-structure';
import { useSessionLiveSocket } from '../src/hooks/useSessionLiveSocket';
import { useAuthStore } from '../src/stores/authStore';
import type { User } from '../src/lib/api/auth';
import type { ClassDetailDto } from '../src/lib/api/class-structure';
import { asClassId } from '../src/lib/class-structure/read-model';
import { adaptHostClass } from '../src/lib/class-structure/adapters';
import { NextClassView } from '../src/components/class/structure/host-class-views';
import { resetFocusRefetchGuard } from '../src/lib/class-structure/invalidation';
const io = vi.hoisted(() => ({ listeners: new Map<string, Set<(data: unknown) => void>>() }));
vi.mock('../src/lib/socket', async original => ({ ...await original<typeof import('../src/lib/socket')>(), getSessionLiveSocket: () => ({ connected: true, emit: vi.fn(),
  on: (name: string, fn: (data: unknown) => void) => { const callbacks = io.listeners.get(name) ?? new Set(); callbacks.add(fn); io.listeners.set(name, callbacks); },
  off: (name: string, fn: (data: unknown) => void) => io.listeners.get(name)?.delete(fn),
}) }));
const user = (role: User['role']): User => ({ id: 'u', role, name: '합성 사용자', email: 'synthetic@example.invalid', verified_tier: 'unverified', onboarding_completed: true, auth_provider: 'email', counselors: [] });
let status = 'active';
const fixture = (): ClassDetailDto => ({ id: 'c', title: '즉시 클래스', status, schedule_mode: 'fixed', planned_session_count: 1, area: 'meditation', progress: { completed: status === 'completed' ? 1 : 0, total: 1 }, session_count: 1, next_session: null, has_open_session: status === 'active', location_type: 'online', location_address: null, linkband_mode: 'none', record_audio: false, capacity: 1, participant_mode: 'registered', default_duration_min: 60, host_view: null });
let root: Root; let container: HTMLDivElement;
function Reads({ socket = false }: { socket?: boolean }) {
  const list = useClasses(); const detail = useClassDetail(asClassId('c'));
  useSessionLiveSocket({ sessionId: 's', skipAuth: true, enabled: socket });
  return <><span data-list>{list.state.status === 'success' ? list.state.data.classes[0].status : list.state.status}</span>
    <span data-detail>{detail.state.status === 'success' ? detail.state.data.detail.status : detail.state.status}</span>
    {detail.state.status === 'success' && <NextClassView model={adaptHostClass(detail.state.data.detail)} />}</>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); status = 'active'; io.listeners.clear();
  useAuthStore.setState({ user: user('counselor'), isAuthenticated: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(path => Promise.resolve(path === '/classes' ? { classes: [fixture()], total: 1 } : path.endsWith('/sessions') ? { sessions: [], total: 0 } : fixture()));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAuthStore.setState({ user: null, isAuthenticated: false }); vi.restoreAllMocks(); });
async function render(socket = false) { await act(async () => root.render(<MemoryRouter><Reads socket={socket}/></MemoryRouter>)); }
async function receive(version: number, nextStatus: string, sessionId = 's') { await act(async () => io.listeners.get('session_state_changed')?.forEach(fn => fn({ session_id: sessionId, status: nextStatus, version }))); }
it.each(['counselor', 'client'] as const)('NV10 %s 종료 성공 직후 열린 목록·상세를 재조회한다', async role => {
  useAuthStore.setState({ user: user(role) }); await render();
  vi.spyOn(apiClient, 'post').mockImplementation(async () => { status = 'completed'; return { id: 's', status: 'completed' } as SessionDto; });
  await act(async () => { await transitionSession('s', 'end'); });
  expect(container.querySelector('[data-list]')?.textContent).toBe('completed');
  expect(container.querySelector('[data-detail]')?.textContent).toBe('completed');
  expect(container.textContent).toContain('모든 회차를 마쳤어요');
  expect(container.querySelector('[data-hero-actions]')).toBeNull();
  expect(apiClient.get).toHaveBeenCalledTimes(6);
});
it('NV10 열린 상세에 복귀하면 다른 탭에서 완료된 상태를 재조회한다', async () => {
  await render(); status = 'completed';
  resetFocusRefetchGuard(); await act(async () => window.dispatchEvent(new Event('focus')));
  expect(container.querySelector('[data-detail]')?.textContent).toBe('completed');
  expect(container.querySelector('[data-list]')?.textContent).toBe('completed');
});
it('NV10 현재 회차 terminal WS만 재조회하며 이전 버전·다른 회차는 무시한다', async () => {
  await render(true); await receive(3, 'in_progress'); status = 'completed';
  await receive(2, 'completed'); await receive(4, 'completed', 'other');
  expect(apiClient.get).toHaveBeenCalledTimes(3);
  await receive(4, 'completed');
  expect(container.querySelector('[data-detail]')?.textContent).toBe('completed');
});
it('종료 실패는 완료를 추정하거나 기존 읽기를 무효화하지 않는다', async () => {
  await render(); vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('합성 전송 실패'));
  await expect(transitionSession('s', 'end')).rejects.toThrow('합성 전송 실패');
  expect(apiClient.get).toHaveBeenCalledTimes(3); expect(container.querySelector('[data-detail]')?.textContent).toBe('active');
});
it.each(['active', 'cancelled'])('NV12 다음 정규회차가 없어도 부모 %s 상태를 완료로 추정하지 않는다', async next => {
  status = next; await render(); expect(container.textContent).not.toContain('모든 회차를 마쳤어요');
  expect(container.querySelector('[data-detail]')?.textContent).toBe(next);
});
it('종료 전 상세 요청이 늦게 끝나도 재조회한 완료 상태를 덮지 않는다', async () => {
  const old = fixture(); let resolveOld!: (value: ClassDetailDto) => void;
  const oldRequest = new Promise<ClassDetailDto>(resolve => { resolveOld = resolve; }); let detailRequests = 0;
  vi.mocked(apiClient.get).mockImplementation(path => {
    if (path === '/classes/c' && detailRequests++ === 0) return oldRequest;
    return Promise.resolve(path === '/classes' ? { classes: [fixture()], total: 1 } : path.endsWith('/sessions') ? { sessions: [], total: 0 } : fixture());
  });
  await render();
  vi.spyOn(apiClient, 'post').mockImplementation(async () => { status = 'completed'; return { id: 's', status: 'completed' } as SessionDto; });
  await act(async () => { await transitionSession('s', 'end'); });
  await act(async () => resolveOld(old));
  expect(container.querySelector('[data-detail]')?.textContent).toBe('completed');
});
it('취소 WS는 부모의 실제 active 상태를 재조회하고 완료 문구를 만들지 않는다', async () => {
  await render(true); await receive(1, 'cancelled');
  expect(apiClient.get).toHaveBeenCalledTimes(6);
  expect(container.querySelector('[data-detail]')?.textContent).toBe('active');
  expect(container.textContent).not.toContain('모든 회차를 마쳤어요');
});
