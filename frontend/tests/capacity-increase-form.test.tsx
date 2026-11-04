// @vitest-environment jsdom
// SDD-289 — 정원 늘리기 폼: 호출 계약·입력 오류·관리자 사유·서버 오류·성공 안내
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';

const increaseCapacity = vi.fn();
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: { increaseCapacity: (...a: unknown[]) => increaseCapacity(...a) } }));

import { CapacityIncreaseForm } from '../src/components/class/player/host/CapacityIncreaseForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const onChanged = vi.fn();
const base = { classId: 'c1', current: 40, occupied: 40, waiting: 10, online: false, revision: 7, admin: false, onChanged };
let host: HTMLDivElement; let root: Root;

const mount = (props: Partial<typeof base> = {}) => act(() => { root.render(createElement(CapacityIncreaseForm, { ...base, ...props })); });
const input = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const reasonInput = () => host.querySelector<HTMLInputElement>('.hp-cap__reason input')!;
const submit = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); increaseCapacity.mockReset(); onChanged.mockReset(); });

describe('CapacityIncreaseForm', () => {
  it('현재 정원보다 큰 값으로 호출하고 대기자 입장 안내를 보인다', async () => {
    increaseCapacity.mockResolvedValue({ capacity: 50, promoted_count: 10, revision: 8 });
    mount();
    type(input('새 정원'), '50');
    await act(async () => { submit().click(); }); await flush();
    expect(increaseCapacity).toHaveBeenCalledTimes(1);
    const [id, cmd] = increaseCapacity.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('c1');
    expect(cmd).toMatchObject({ capacity: 50, expected_revision: 7 });
    expect(typeof cmd.operation_key).toBe('string');
    expect(cmd.reason).toBeUndefined();
    expect(host.textContent).toContain('10명을 입장 처리');
    expect(onChanged).toHaveBeenCalledWith(50);
  });
  it('입력 오류면 제출 불가, 상한 초과 문구', () => {
    mount();
    type(input('새 정원'), '101');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('최대 100명');
    expect(submit().disabled).toBe(true);
  });
  it('현재 입장 인원 미만 문구', () => {
    mount({ current: 40, occupied: 45 });
    type(input('새 정원'), '42');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('현재 입장 인원(45명)');
    expect(submit().disabled).toBe(true);
  });
  it('기관관리자는 사유가 있어야 제출 가능', () => {
    mount({ admin: true });
    type(input('새 정원'), '45');
    expect(submit().disabled).toBe(true);
    type(reasonInput(), '행사 증원');
    expect(submit().disabled).toBe(false);
  });
  it('서버 오류를 한국어로 보이고 성공 콜백은 부르지 않는다', async () => {
    increaseCapacity.mockRejectedValue(new ApiError(422, 'x', { detail: { code: 'capacity_below_occupied' } }));
    mount();
    type(input('새 정원'), '45');
    await act(async () => { submit().click(); }); await flush();
    expect(host.textContent).toContain('입장 인원보다 적게');
    expect(onChanged).not.toHaveBeenCalled();
  });
  it('이미 상한이면 제출 비활성', () => {
    mount({ current: 100, occupied: 100 });
    expect(submit().disabled).toBe(true);
    expect(host.textContent).toContain('최대 정원');
  });
});
