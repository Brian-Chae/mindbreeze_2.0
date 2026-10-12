// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CounselorAgentPage from '../src/pages/agent/counselor-agent-page';
import { RoleGuard } from '../src/components/auth/RoleGuard';
import * as api from '../src/lib/api/agent-counselor';
import type { CounselorMessage, RelayEvent } from '../src/lib/api/agent-counselor';
import { useCounselorAgentStore } from '../src/stores/agent-counselor-store';
import type { UserRole } from '../src/lib/api/auth';

const auth = vi.hoisted(() => ({ role: 'counselor' as UserRole }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (state: { user: { role: UserRole }; isAuthenticated: boolean; isInitialized: boolean }) => unknown) => selector({ user: { role: auth.role }, isAuthenticated: true, isInitialized: true }) }));
vi.mock('../src/lib/api/agent-counselor', () => ({ getSettings: vi.fn(), putSettings: vi.fn(), listMessages: vi.fn(), sendMessage: vi.fn(), markRead: vi.fn(), getUnreadCount: vi.fn(), listRelayEvents: vi.fn(), markHandled: vi.fn(), runCta: vi.fn() }));
vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children, rightSlot }: { children: ReactNode; rightSlot: ReactNode }) => <main>{rightSlot}{children}</main> }));
const message: CounselorMessage = { id: 'm1', sender: 'agent', kind: 'briefing_morning', content: '오늘 일정 안내', cta: [{ id: 'schedule', action: 'open_schedule', label: '일정 보기' }], ref_type: null, ref_id: null, read_at: null, created_at: '2026-10-08T00:00:00Z' };
const relay: RelayEvent = { id: 'e1', kind: 'feedback', client_id: 'c1', client_name: '김내담', session_id: 's1', session_title: '상담', scheduled_at: null, payload: { choice: 'helpful', texts: ['  원문\n그대로  '] }, handled_at: null, created_at: '2026-10-08T00:00:00Z' };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  auth.role = 'counselor';
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(api.listMessages).mockResolvedValue({ items: [message], has_more: false });
  vi.mocked(api.markRead).mockResolvedValue({ unread: 0 });
  vi.mocked(api.listRelayEvents).mockResolvedValue({ items: [relay] });
  vi.mocked(api.getSettings).mockResolvedValue({ morning_enabled: true, morning_time: '08:00', evening_enabled: true, evening_time: '21:00', skip_no_session_days: true });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
async function render(path = '/agent') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/agent" element={<RoleGuard role="counselor"><CounselorAgentPage /></RoleGuard>} /><Route path="/" element={<p>접근 차단</p>} /><Route path="/sessions" element={<p>세션 목록 화면</p>} /></Routes></MemoryRouter>));
}
function button(label: string): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === label);
  expect(result).toBeDefined(); return result!;
}
it.each(['client', 'org_admin', 'platform_admin'] as UserRole[])('%s는 상담사 화면에 접근하지 못한다', async (role) => {
  auth.role = role; await render(); expect(container.textContent).toContain('접근 차단'); expect(api.listMessages).not.toHaveBeenCalled();
});
it('상담사는 브리핑과 입력창을 보고 CTA로 세션 목록을 연다', async () => {
  useCounselorAgentStore.getState().setUnread(3);
  await render(); expect(container.textContent).toContain('아침 브리핑'); expect(container.querySelector('input[type="text"]')?.maxLength).toBe(1000);
  expect(useCounselorAgentStore.getState().unread).toBe(0);
  await act(async () => button('일정 보기').click()); expect(container.textContent).toContain('세션 목록 화면');
});
it('relay 원문과 라벨을 보존하고 처리 완료 상태를 표시한다', async () => {
  vi.mocked(api.markHandled).mockResolvedValue({ ...relay, handled_at: '2026-10-08T01:00:00Z' });
  await render('/agent?tab=relay'); expect(container.textContent).toContain('도움이 됐어요'); expect(container.textContent).toContain('  원문\n그대로  ');
  expect(container.querySelector('a[href="/sessions/s1"]')).not.toBeNull();
  await act(async () => button('처리 완료').click()); expect(container.textContent).not.toContain('미처리');
  expect(Array.from(container.querySelectorAll('button')).some((node) => node.textContent === '처리 완료')).toBe(false);
});
it('설정 저장 실패를 시트에 표시하고 재시도 후 닫는다', async () => {
  vi.mocked(api.putSettings).mockRejectedValueOnce(new Error('저장 실패')).mockResolvedValueOnce({ morning_enabled: true, morning_time: '08:00', evening_enabled: true, evening_time: '21:00', skip_no_session_days: true });
  await render(); await act(async () => button('브리핑 설정').click());
  const submit = async () => { await act(async () => { container.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); };
  await submit(); expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('저장 실패');
  await submit(); expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it('최신 메시지는 아래에, 이전 메시지는 더보기 후 위에 유지한다', async () => {
  vi.mocked(api.listMessages).mockResolvedValueOnce({ items: [message], has_more: true }).mockResolvedValueOnce({ items: [{ ...message, id: 'old', content: '이전 대화', created_at: '2026-10-07T00:00:00Z' }], has_more: false });
  await render(); await act(async () => button('이전 메시지 더보기').click());
  const articles = container.querySelectorAll('[role="log"] article');
  expect(articles[0].textContent).toContain('이전 대화'); expect(articles[1].textContent).toContain('오늘 일정 안내');
});
it('메시지 전송 성공 후 입력을 비우고 사용자·AI 응답을 최신 하단에 표시한다', async () => {
  vi.mocked(api.sendMessage).mockResolvedValue({ user_message: { ...message, id: 'user', sender: 'user', content: '내일 일정', cta: [], created_at: '2026-10-08T01:00:00Z' }, agent_message: { ...message, id: 'reply', content: '내일 일정 안내', created_at: '2026-10-08T01:00:01Z' } });
  await render();
  const textarea = container.querySelector<HTMLInputElement>('input[type="text"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(textarea, '내일 일정');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(textarea.value).toBe('');
  const articles = container.querySelectorAll('[role="log"] article');
  expect(articles[1].textContent).toContain('내일 일정'); expect(articles[2].textContent).toContain('내일 일정 안내');
});
it('처리 요청 실패 시 원문과 미처리 상태를 남긴다', async () => {
  vi.mocked(api.markHandled).mockRejectedValue(new Error('처리 실패'));
  await render('/agent?tab=relay'); await act(async () => button('처리 완료').click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('처리 실패');
  expect(container.textContent).toContain('미처리'); expect(container.textContent).toContain('  원문\n그대로  ');
});
it('위험 알림은 실명·문장·두 CTA를 강조 카드에 표시한다', async () => {
  vi.mocked(api.listMessages).mockResolvedValue({ items: [{ ...message, kind: 'risk_alert', content: '김내담: 확인이 필요한 문장', cta: [
    { id: 'client', action: 'open_client', label: '내담자 보기', payload: { client_id: 'c1' } },
    { id: 'risk', action: 'open_risk_signals', label: '위험 신호 보기' },
  ] }], has_more: false });
  await render();
  const card = container.querySelector('[role="log"] article .border-amber-300');
  expect(card?.textContent).toContain('김내담: 확인이 필요한 문장');
  expect(card?.textContent).toContain('위험 알림');
  expect(button('내담자 보기').disabled).toBe(false);
  expect(button('위험 신호 보기').disabled).toBe(false);
});
