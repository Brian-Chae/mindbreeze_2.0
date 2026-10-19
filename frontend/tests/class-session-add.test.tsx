// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ClassSessionAdd } from '../src/components/class/structure/class-session-add';
import type { ClassDetailDto, ClassSessionDto } from '../src/lib/api/class-structure';
const api = vi.hoisted(() => ({ addSession: vi.fn(), get: vi.fn() }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: api }));
vi.mock('../src/lib/api/client', async original => ({ ...await original<object>(), apiClient: { get: api.get } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const detail = { id: 'c1', revision: 8, status: 'active', default_duration_min: 60, location_type: 'online', host_view: { instructors: [{ user_id: 'h1', name: '지도사', role: 'lead', status: 'active' }] } } as ClassDetailDto;
const sessions = [{ id: 's1', seq: 1, status: 'completed', session_kind: 'regular' }] as ClassSessionDto[];
let box: HTMLDivElement; let root: Root;
const saved = vi.fn();
async function mount() { box = document.createElement('div'); document.body.append(box); root = createRoot(box); await act(async () => root.render(<ClassSessionAdd detail={detail} sessions={sessions} onSaved={saved} />)); }
async function press(text: string) { await act(async () => [...box.querySelectorAll('button')].find(x => x.textContent === text)!.click()); }
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); });
it('보강은 원 회차와 선택한 회원 user_id를 전달하고 비회원은 제외한다', async () => {
  api.get.mockResolvedValue({ members: [{ id: 'membership-1', user_id: 'u1', name: '회원 하나', status: 'active' }, { id: 'guest', user_id: null, name: '비회원', status: 'active' }] });
  api.addSession.mockResolvedValue({ class_id: 'c1', revision: 9 });
  await mount(); await press('보강 추가');
  expect(box.querySelector('[aria-label="비회원 선택"]')).toBeNull();
  await act(async () => box.querySelector<HTMLInputElement>('[aria-label="회원 하나 선택"]')!.click());
  await press('회차 추가');
  expect(api.addSession.mock.calls[0][1]).toMatchObject({ expected_revision: 8, makeup_for_session_id: 's1', member_ids: ['u1'], row: { session_kind: 'makeup' } });
  expect(saved).toHaveBeenCalledTimes(1);
});
it('보강 대상 회원을 선택하지 않으면 저장하지 않는다', async () => {
  api.get.mockResolvedValue({ members: [] });
  await mount(); await press('보강 추가'); await press('회차 추가');
  expect(api.addSession).not.toHaveBeenCalled(); expect(box.textContent).toContain('보강 대상 회원을 선택');
});
