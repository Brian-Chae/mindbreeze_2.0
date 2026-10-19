// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ClassScheduleEditor } from '../src/components/class/structure/class-schedule-editor';
import type { ClassDetailDto, ClassSessionDto } from '../src/lib/api/class-structure';
const api = vi.hoisted(() => ({ previewBulk: vi.fn(), bulk: vi.fn() }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: api }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const detail = { id: 'c1', revision: 4, capabilities: { schedule: true, manage: true, invite: true }, host_view: { access_code: '0042', instructors: [{ user_id: 'h1', name: '진행자', role: 'lead', status: 'active' }] } } as ClassDetailDto;
const sessions: ClassSessionDto[] = [1, 2, 3].map(seq => ({ id: `s${seq}`, seq, scheduled_at: `2026-12-${20 + seq}T10:00:00Z`, status: seq === 3 ? 'completed' : 'scheduled', session_kind: 'regular', host: { id: 'h1', name: '진행자' }, host_state: 'assigned', state_version: seq + 5, duration_min: 60, location_type: 'online', location_address: null }));
let box: HTMLDivElement; let root: Root;
const saved = vi.fn();
async function mount() { box = document.createElement('div'); document.body.append(box); root = createRoot(box); await act(async () => root.render(<ClassScheduleEditor detail={detail} sessions={sessions} onSaved={saved} />)); }
async function press(text: string) { await act(async () => [...box.querySelectorAll('button')].find(x => x.textContent === text)!.click()); }
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); });
it('완료 회차는 선택할 수 없고 선택한 회차 버전을 단일 미리보기에 전달한다', async () => {
  api.previewBulk.mockResolvedValue({ rows: [], conflicts: [], conflict_fingerprint: 'fp', class_revision: 4 });
  await mount();
  expect(box.querySelector<HTMLInputElement>('[aria-label="3회차 선택"]')?.disabled).toBe(true);
  await act(async () => { box.querySelector<HTMLInputElement>('[aria-label="1회차 선택"]')!.click(); box.querySelector<HTMLInputElement>('[aria-label="2회차 선택"]')!.click(); });
  await press('한 주 밀기');
  expect(api.previewBulk).toHaveBeenCalledTimes(1);
  expect(api.previewBulk.mock.calls[0][1]).toMatchObject({ action: 'shift_week', expected_revision: 4, session_ids: ['s1', 's2'], expected_state_versions: { s1: 6, s2: 7 } });
  expect(api.bulk).not.toHaveBeenCalled();
  await press('편집으로 돌아가기'); expect(api.bulk).not.toHaveBeenCalled();
});
it('확인 뒤 단일 bulk를 실행하고 최신 조회를 요청한다', async () => {
  api.previewBulk.mockResolvedValue({ rows: [], conflicts: [], conflict_fingerprint: 'fp', class_revision: 4 });
  api.bulk.mockResolvedValue({ class_id: 'c1', revision: 5 });
  await mount(); await act(async () => box.querySelector<HTMLInputElement>('[aria-label="1회차 선택"]')!.click());
  await press('선택 회차 취소'); await press('변경 저장');
  expect(api.bulk).toHaveBeenCalledTimes(1); expect(api.bulk.mock.calls[0][1].action).toBe('cancel'); expect(saved).toHaveBeenCalledTimes(1);
});
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
it('일시만 이후 회차에 적용하면 서로 다른 지도사·길이·장소·개별 배정을 보존한다', async () => {
  sessions[1] = { ...sessions[1], host: { id: 'h2', name: '다른 지도사' }, duration_min: 90, location_type: 'offline', location_address: '명상실', assignment_override: false };
  api.previewBulk.mockImplementation((_id, command) => Promise.resolve({ rows: command.rows, conflicts: [], conflict_fingerprint: 'fp' }));
  await mount(); await act(async () => box.querySelector<HTMLButtonElement>('[aria-label="1회차 편집"]')!.click());
  await change(box.querySelector<HTMLInputElement>('input[type="datetime-local"]')!, '2026-12-21T20:00');
  const selects = box.querySelectorAll<HTMLSelectElement>('[role="dialog"] select'); await change(selects[selects.length - 1], 'following');
  await press('편집 내용 적용'); await press('변경 내용 확인');
  expect(api.previewBulk.mock.calls[0][1].rows[1]).toMatchObject({ host_id: 'h2', duration_min: 90, location_type: 'offline', location_address: '명상실', assignment_override: false, scheduled_at: '2026-12-22T11:00:00.000Z' });
});
it('저장 전 확인에서 지도사·길이·장소 변경 전후를 모두 읽을 수 있다', async () => {
  detail.host_view!.instructors.push({ user_id: 'h2', name: '다른 지도사', role: 'assistant', status: 'active' });
  api.previewBulk.mockImplementation((_id, command) => Promise.resolve({ rows: command.rows, conflicts: [], conflict_fingerprint: 'fp' }));
  await mount(); await act(async () => box.querySelector<HTMLButtonElement>('[aria-label="1회차 편집"]')!.click());
  await change(box.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]')!, '90');
  const selects = box.querySelectorAll<HTMLSelectElement>('[role="dialog"] select'); await change(selects[0], 'h2'); await change(selects[1], 'offline');
  await change(box.querySelector<HTMLInputElement>('[role="dialog"] input:not([type])')!, '명상실');
  await press('편집 내용 적용'); await press('변경 내용 확인');
  const text = box.querySelector('[aria-label="저장 전 확인"]')!.textContent;
  expect(text).toContain('진행자 → 다른 지도사'); expect(text).toContain('60분 → 90분'); expect(text).toContain('온라인 → 명상실');
});
