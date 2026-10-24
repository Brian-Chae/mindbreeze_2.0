// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import NotificationGroups from '../src/components/settings/notification-groups';
import * as api from '../src/lib/api/notifications';
import { useAuthStore } from '../src/stores/authStore';

let host: HTMLDivElement;
let root: Root;
const sample = { email: { session_booked: true, session_updated: false, chat_message: false, report_ready: true, retired_event: false }, in_app: { session_booked: true, session_updated: true, chat_message: true, report_ready: true }, push: { chat_message: false } };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('6개 알림 스위치 저장 계약', () => {
  it('최초 조회는 기존 혼합값을 보존하고 쓰기 요청을 하지 않는다', async () => {
    vi.spyOn(api, 'getPreferences').mockResolvedValue(structuredClone(sample));
    const save = vi.spyOn(api, 'updatePreferences').mockResolvedValue(sample);
    await act(async () => root.render(<NotificationGroups />));
    expect(host.querySelectorAll('[role=switch]')).toHaveLength(6);
    expect(host.textContent).toContain('일부');
    expect(save).not.toHaveBeenCalled();
    const mixed = host.querySelector<HTMLButtonElement>('[aria-label="일정·참여 이메일 알림"]')!;
    expect(mixed.getAttribute('aria-checked')).toBe('false');
    expect(mixed.getAttribute('aria-describedby')).toBeTruthy();
  });
  it('묶음만 저장하고 연속 입력을 막으며 실패하면 혼합 상태로 복구한다', async () => {
    vi.spyOn(api, 'getPreferences').mockResolvedValue(structuredClone(sample));
    let rejectSave: ((error: Error) => void) | undefined;
    const save = vi.spyOn(api, 'updatePreferences').mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    await act(async () => root.render(<NotificationGroups />));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="일정·참여 이메일 알림"]')!;
    await act(async () => { button.click(); button.click(); });
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('세션 예약');
    await act(async () => { const apply = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '적용하기')!; apply.click(); apply.click(); });
    expect(save).toHaveBeenCalledExactlyOnceWith({ email: { session_booked: true, session_updated: true }, in_app: {} });
    expect([...host.querySelectorAll<HTMLButtonElement>('[role=switch]')].every((item) => item.disabled)).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
    await act(async () => rejectSave?.(new Error('offline')));
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('저장하지 못했어요');
    expect(button.disabled).toBe(false);
  });
  it('성공한 서버 응답을 반영한다', async () => {
    vi.spyOn(api, 'getPreferences').mockResolvedValue(structuredClone(sample));
    const saved = { ...sample, email: { ...sample.email, chat_message: true } };
    vi.spyOn(api, 'updatePreferences').mockResolvedValue(saved);
    await act(async () => root.render(<NotificationGroups />));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="대화 이메일 알림"]')!;
    await act(async () => button.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '적용하기')!.click());
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('[role=status]')?.textContent).toContain('저장했어요');
  });
  it('조회 실패 시 다시 시도하고 불러오기만으로 저장하지 않는다', async () => {
    vi.spyOn(api, 'getPreferences').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(sample);
    const save = vi.spyOn(api, 'updatePreferences');
    await act(async () => root.render(<NotificationGroups />));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('불러오지 못했어요');
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(host.querySelectorAll('[role=switch]')).toHaveLength(6);
    expect(save).not.toHaveBeenCalled();
  });
  it('계정 변경 뒤 도착한 이전 계정 응답은 버린다', async () => {
    let resolveOld: ((value: api.NotificationPreferencesResponse) => void) | undefined;
    const load = vi.spyOn(api, 'getPreferences').mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ email: { chat_message: true }, in_app: { chat_message: false } });
    await act(async () => root.render(<NotificationGroups />));
    const oldUser = useAuthStore.getState().user;
    await act(async () => useAuthStore.setState({ user: { id: 'new-account', role: 'client', name: '예시', email: 'sample@example.test' } as NonNullable<typeof oldUser> }));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => resolveOld?.(sample));
    expect(host.querySelector('[aria-label="대화 이메일 알림"]')?.getAttribute('aria-checked')).toBe('true');
    await act(async () => useAuthStore.setState({ user: oldUser }));
  });
  it('변경 목록에서 취소하면 기존 혼합값과 저장0회를 유지한다', async () => {
    vi.spyOn(api, 'getPreferences').mockResolvedValue(structuredClone(sample));
    const save = vi.spyOn(api, 'updatePreferences');
    await act(async () => root.render(<NotificationGroups />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="일정·참여 이메일 알림"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '취소')!.click());
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="일정·참여 이메일 알림"]')?.getAttribute('aria-checked')).toBe('false');
  });
  it('기존 추가3종은 호환 상세에서 개별 변경하고 묶음·미지원키·push에 영향을 주지 않는다', async () => {
    const extra = { ...sample, email: { ...sample.email, agent_message: false, schedule_change_request: true, risk_signal: false } };
    vi.spyOn(api, 'getPreferences').mockResolvedValue(extra);
    const save = vi.spyOn(api, 'updatePreferences').mockResolvedValue(extra);
    await act(async () => root.render(<NotificationGroups />));
    expect(host.querySelector('summary')?.textContent).toContain('추가 알림 선택');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="AI 대화 안내 이메일 알림"]')!.click());
    expect(save).toHaveBeenCalledExactlyOnceWith({email:{agent_message:true},in_app:{}});
  });

  it('세부 설정에서 항목별로 켜고 끄면 그 묶음의 항목 값만 저장한다', async () => {
    vi.spyOn(api, 'getPreferences').mockResolvedValue(structuredClone(sample));
    const save = vi.spyOn(api, 'updatePreferences').mockImplementation(async (patch) => ({ ...sample, email: { ...sample.email, ...patch.email } }));
    await act(async () => root.render(<NotificationGroups />));
    const detail = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.startsWith('세부 설정') && item.closest('div')?.textContent?.includes('이메일'))!;
    expect(detail.textContent).toBe('세부 설정 1/2');
    await act(async () => detail.click());
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    const booked = dialog.querySelector<HTMLButtonElement>('[aria-label="세션 예약 이메일 알림"]')!;
    expect(booked.getAttribute('aria-checked')).toBe('true');
    expect(dialog.querySelector('[aria-label="세션 변경 이메일 알림"]')?.getAttribute('aria-checked')).toBe('false');
    await act(async () => booked.click());
    expect(booked.getAttribute('aria-checked')).toBe('false');
    expect(save).not.toHaveBeenCalled();
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '적용하기')!.click());
    expect(save).toHaveBeenCalledExactlyOnceWith({ email: { session_booked: false, session_updated: false }, in_app: {} });
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('세부 설정에서 바꾼 것 없이 적용하면 저장하지 않는다', async () => {
    vi.spyOn(api, 'getPreferences').mockResolvedValue(structuredClone(sample));
    const save = vi.spyOn(api, 'updatePreferences');
    await act(async () => root.render(<NotificationGroups />));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.startsWith('세부 설정'))!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '적용하기')!.click());
    expect(save).not.toHaveBeenCalled();
  });
});
