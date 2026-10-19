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
