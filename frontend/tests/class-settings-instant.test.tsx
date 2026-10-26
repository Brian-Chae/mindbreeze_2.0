// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClassSettingsPanel } from '../src/components/class/structure/class-settings-panel';
import { defaultSchedule } from '../src/lib/class-structure/scheduling-model';
import type { ClassDetailDto } from '../src/lib/api/class-structure';
const mocks = vi.hoisted(() => ({ instructors: vi.fn(), candidates: vi.fn(), update: vi.fn() }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: mocks }));
vi.mock('../src/lib/api/class-operations', () => ({ classOperationsApi: mocks }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { role: 'counselor' } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let box: HTMLDivElement; let root: Root;
beforeEach(() => { vi.resetAllMocks(); mocks.instructors.mockResolvedValue({ instructors: [{ user_id: 'u1', role: 'lead', status: 'active' }] }); mocks.candidates.mockResolvedValue({ instructors: [{ id: 'u1', name: '진행자' }] }); mocks.update.mockResolvedValue({ revision: 2 }); });
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); });
async function mount(startNow: boolean) {
 const base = defaultSchedule('u1');
 const detail = { ...base, id: 'instant-class', title: '명상', revision: 1, status: 'active', planned_session_count: startNow ? 1 : 8, default_duration_min: 60, recurrence_rule: { ...base.recurrence_rule, start_now: startNow }, progress: { completed: 0, total: startNow ? 1 : 8 }, host_view: { access_code: '2941', instructors: [{ user_id: 'u1', name: '진행자', role: 'lead', status: 'active' }] } } as unknown as ClassDetailDto;
 box = document.createElement('div'); document.body.append(box); root = createRoot(box);
 await act(async () => root.render(<MemoryRouter><ClassSettingsPanel detail={detail} onSaved={() => {}} /></MemoryRouter>));
}
it('즉시 클래스 설정은 미래 일정·배정을 숨기고 기본 설정 저장 시 즉시 계약을 보존한다', async () => {
 await mount(true);
 expect(box.textContent).toContain('바로 지금 만든 1회차 클래스예요.');
 expect(box.querySelector('[aria-label="앞으로 생성할 회차 시작 시각"]')).toBeNull();
 expect(box.querySelector('[aria-label="배정 방식"]')).toBeNull();
 expect(box.textContent).toContain('기본 설정'); expect(box.textContent).toContain('음성 녹음'); expect(box.textContent).toContain('2941');
 await act(async () => box.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
 expect(mocks.update.mock.calls[0][1].schedule).toMatchObject({ planned_session_count: 1, recurrence_rule: { start_now: true }, rows: [], assignment_rule: { mode: 'all_one', host_ids: ['u1'] } });
});
it('일반 예약 클래스는 미래 일정·배정 설정을 유지한다', async () => {
 await mount(false);
 expect(box.querySelector('[aria-label="앞으로 생성할 회차 시작 시각"]')).not.toBeNull();
 expect(box.querySelector('[aria-label="배정 방식"]')).not.toBeNull();
 expect(box.textContent).not.toContain('바로 지금 만든 1회차 클래스예요.');
});
