// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api/agent-checkin';
import * as agent from '../src/lib/api/agent';
import AgentCheckinPanel from '../src/components/clients/agent-checkin-panel';
import AiAgentPage from '../src/pages/client/ai-agent-page';
import RiskSignals, { sortRiskSignals } from '../src/pages/agent/risk-signals';
import { useCounselorAgentStore } from '../src/stores/agent-counselor-store';
vi.mock('../src/lib/api/agent-checkin', () => ({ getCheckinPrefs: vi.fn(), putCheckinPrefs: vi.fn(), listCheckinClients: vi.fn(), getProfile: vi.fn(), listCheckins: vi.fn(), setCheckinEnabled: vi.fn(), patchProfileItem: vi.fn(), listRiskSignals: vi.fn(), handleRiskSignal: vi.fn() }));
vi.mock('../src/lib/api/agent', () => ({ getConsent: vi.fn(), listMessages: vi.fn(), markRead: vi.fn() }));
vi.mock('../src/components/client/ClientShell', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
let root: Root;
let container: HTMLDivElement;
const profile: api.ProfileItem = { id: 'p', category: 'sleep', text: '잠들기 어렵다고 표현함', status: 'ai_estimate', evidence_count: 2, updated_at: '2026-10-08' };
const client: api.CheckinClient = { client_id: 'c', client_name: '김민지', enabled: false, last_checkin_at: null, open_risk_count: 1 };
const risk: api.RiskSignal = { id: 'r', client_id: 'c', client_name: '김민지', level: 'high', excerpt: '확인이 필요한 문장', handled_at: null, created_at: '2026-10-08' };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(agent.getConsent).mockResolvedValue({ agreed: true, version: 'v1' });
  vi.mocked(agent.markRead).mockResolvedValue({ unread: 0 });
  vi.mocked(agent.listMessages).mockResolvedValue({ items: ['checkin', 'checkin_closing'].map((kind, index) => ({ id: String(index), kind: kind as 'checkin' | 'checkin_closing', sender: 'agent', content: index ? '상담사님과 이야기 나눠보시면 좋겠어요' : '오늘은 어떻게 지내셨어요?', cta: index ? [{ id: 'talk', action: 'talk_to_counselor', label: '상담사님과 대화하기', payload: { room_id: 'room' } }] : [], ref_type: null, ref_id: null, read_at: null, created_at: '2026-10-08T01:00:00Z' })), has_more: false });
  vi.mocked(api.listCheckinClients).mockResolvedValue({ items: [client] });
  vi.mocked(api.getProfile).mockResolvedValue({ items: [profile] });
  vi.mocked(api.listCheckins).mockResolvedValue({ items: [{ id: 's', client_id: 'c', started_at: '2026-10-08', closed_at: null, summary: '일상을 돌아봄', mood_direction: 'same' }] });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
async function render(node: ReactNode) { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); }
function button(label: string) { const found = [...container.querySelectorAll('button')].find((element) => element.textContent === label); expect(found).toBeDefined(); return found!; }
it.each([false, true])('안부 제공 여부 %s에 따라 토글을 표시하고 내담자에게 감지 문구를 노출하지 않는다', async (available) => {
  vi.mocked(api.getCheckinPrefs).mockResolvedValue({ available, paused: false });
  vi.mocked(api.putCheckinPrefs).mockResolvedValue({ available: true, paused: true });
  await render(<AiAgentPage />);
  expect(Boolean(container.querySelector('[role="switch"]'))).toBe(available);
  expect(container.textContent).toContain('오늘은 어떻게 지내셨어요?');
  expect(button('상담사님과 대화하기').disabled).toBe(false);
  expect(container.innerHTML).not.toMatch(/감지|위험|모니터링|알림이 갔|알렸|risk_alert|amber/);
  if (available) {
    await act(async () => (container.querySelector('[role="switch"]') as HTMLInputElement).click());
    expect(api.putCheckinPrefs).toHaveBeenCalledWith(true);
    expect((container.querySelector('[role="switch"]') as HTMLInputElement).checked).toBe(true);
  }
});
it('상담사는 안부 켜기, 카테고리, 확정·수정·기각 및 요약을 확인한다', async () => {
  vi.mocked(api.setCheckinEnabled).mockResolvedValue({ ...client, enabled: true });
  await render(<AgentCheckinPanel clientId="c" />);
  for (const label of ['수면', '스트레스 요인', '감정 표현', '대처 방식', '주요 인물·사건', 'AI 추정', '근거 2개', '비슷함', '일상을 돌아봄']) expect(container.textContent).toContain(label);
  await act(async () => (container.querySelector('[role="switch"]') as HTMLInputElement).click());
  expect((container.querySelector('[role="switch"]') as HTMLInputElement).checked).toBe(true);
  vi.mocked(api.patchProfileItem).mockResolvedValue({ ...profile, status: 'confirmed' });
  await act(async () => button('확정').click());
  expect(container.textContent).not.toContain('AI 추정');
  await act(async () => button('수정').click());
  const textarea = container.querySelector('textarea')!;
  expect(textarea.maxLength).toBe(300);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '상담사가 수정한 내용'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  vi.mocked(api.patchProfileItem).mockResolvedValue({ ...profile, status: 'confirmed', text: '상담사가 수정한 내용' });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(container.textContent).toContain('상담사가 수정한 내용');
  vi.mocked(api.patchProfileItem).mockResolvedValue({ ...profile, status: 'dismissed' });
  await act(async () => button('기각').click());
  expect(container.textContent).not.toContain('상담사가 수정한 내용');
});
it('위험 목록은 미처리 우선이며 처리 완료하면 상태와 배지를 갱신한다', async () => {
  const handled = { ...risk, id: 'handled', created_at: '2026-10-09', handled_at: '2026-10-09' };
  const items = [handled, risk];
  expect(sortRiskSignals(items).map((item) => item.id)).toEqual(['r', 'handled']);
  expect(items[0].id).toBe('handled');
  vi.mocked(api.listRiskSignals).mockResolvedValue({ items });
  vi.mocked(api.handleRiskSignal).mockResolvedValue({ ...risk, handled_at: '2026-10-10' });
  useCounselorAgentStore.getState().setOpenRisk(1);
  await render(<RiskSignals />);
  expect(container.querySelector('article')?.textContent).toContain('긴급 · 미처리');
  expect(container.textContent).toContain('김민지');
  await act(async () => button('처리 완료').click());
  expect(container.textContent).not.toContain('미처리');
  expect(useCounselorAgentStore.getState().openRisk).toBe(0);
});
