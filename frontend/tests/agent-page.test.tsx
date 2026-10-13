// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AiAgentPage from '../src/pages/client/ai-agent-page';
import * as api from '../src/lib/api/agent';
import type { AgentCta, AgentMessage } from '../src/lib/api/agent';

vi.mock('../src/lib/api/agent', () => ({
  getConsent: vi.fn(), agree: vi.fn(), listMessages: vi.fn(), sendMessage: vi.fn(),
  markRead: vi.fn(), getUnreadCount: vi.fn(), runCta: vi.fn(), streamMessage: vi.fn(),
  AgentReplyError: class AgentReplyError extends Error {},
}));
vi.mock('../src/lib/api/session', () => ({ getSession: vi.fn() }));
vi.mock('../src/components/client/ClientShell', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

const message: AgentMessage = {
  id: 'message-1', sender: 'agent', kind: 'free', content: '안녕하세요, AI 비서입니다.',
  cta: [], ref_type: null, ref_id: null, read_at: null, created_at: '2026-10-08T01:00:00Z',
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.getConsent).mockResolvedValue({ agreed: true, version: 'v1' });
  vi.mocked(api.agree).mockResolvedValue({ agreed: true, version: 'v1' });
  vi.mocked(api.listMessages).mockResolvedValue({ items: [message], has_more: false });
  vi.mocked(api.markRead).mockResolvedValue({ unread: 0 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.resetAllMocks();
});
async function render() {
  await act(async () => root.render(<MemoryRouter><AiAgentPage /></MemoryRouter>));
}
function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.startsWith(label));
  expect(found, `${label} 버튼`).toBeDefined();
  return found!;
}
async function input(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) {
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

it('동의 전에는 대화 조회와 입력을 차단하고 거절 후에도 차단한다', async () => {
  vi.mocked(api.getConsent).mockResolvedValue({ agreed: false, version: 'v1' });
  await render();
  expect(api.listMessages).not.toHaveBeenCalled();
  expect(container.querySelector('textarea')).toBeNull();
  expect(container.textContent).toContain('피드백은 상담사에게 그대로 전달됩니다');
  await act(async () => button('동의하지 않음').click());
  expect(container.textContent).toContain('동의하지 않으면 AI 대화를 이용할 수 없습니다.');
  expect(api.listMessages).not.toHaveBeenCalled();
  expect(api.agree).not.toHaveBeenCalled();
  await act(async () => button('동의하고 시작하기').click());
  expect(api.agree).toHaveBeenCalledOnce();
  expect(container.querySelector('[role="log"]')?.textContent).toContain(message.content);
  expect(api.markRead).toHaveBeenCalledWith(message.created_at);
});

it('일정 변경 사유는 필수이고 500자로 제한하며 접수 응답을 표시한다', async () => {
  const cta: AgentCta = { id: 'change', action: 'request_change', label: '일정 변경' };
  vi.mocked(api.listMessages).mockResolvedValue({ items: [{ ...message, cta: [cta] }], has_more: false });
  vi.mocked(api.runCta).mockResolvedValue({ cta: { ...cta, done: true }, agent_message: { ...message, id: 'receipt', content: '변경 문의가 접수되었습니다.', created_at: '2026-10-08T01:01:00Z' } });
  await render();
  await act(async () => button('일정 변경').click());
  const form = container.querySelector<HTMLFormElement>('form[role="dialog"]')!;
  const reason = form.querySelector('textarea')!;
  expect(reason.required).toBe(true);
  expect(reason.maxLength).toBe(500);
  expect(button('문의 보내기').disabled).toBe(true);
  await submit(form);
  expect(api.runCta).not.toHaveBeenCalled();
  await input(reason, '가'.repeat(501));
  await submit(form);
  expect(api.runCta).not.toHaveBeenCalled();
  await input(reason, '일정이 겹쳐 변경을 요청합니다.');
  await submit(form);
  expect(api.runCta).toHaveBeenCalledWith(message.id, cta.id, { reason: '일정이 겹쳐 변경을 요청합니다.' });
  expect(container.querySelector('form[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="log"]')?.textContent).toContain('변경 문의가 접수되었습니다.');
});

it('피드백을 선택하면 세 선택지 모두 비활성화한다', async () => {
  const ctas: AgentCta[] = [
    { id: 'helpful', action: 'feedback_choice', label: '도움이 됐어요', payload: { choice: 'helpful' } },
    { id: 'neutral', action: 'feedback_choice', label: '보통이에요', payload: { choice: 'neutral' } },
    { id: 'disappointed', action: 'feedback_choice', label: '아쉬웠어요', payload: { choice: 'disappointed' } },
  ];
  vi.mocked(api.listMessages).mockResolvedValue({ items: [{ ...message, cta: ctas }], has_more: false });
  vi.mocked(api.runCta).mockResolvedValue({ cta: { ...ctas[0], done: true } });
  await render();
  await act(async () => button('도움이 됐어요').click());
  expect(api.runCta).toHaveBeenCalledWith(message.id, 'helpful', {});
  ctas.forEach((cta) => expect(button(cta.label).disabled).toBe(true));
  await act(async () => button('보통이에요').click());
  expect(api.runCta).toHaveBeenCalledOnce();
});

it('메시지를 1000자로 제한하고 전송 실패 시 입력을 보존한다', async () => {
  vi.mocked(api.streamMessage).mockImplementation(async function* () { throw new Error('전송 실패'); });
  await render();
  const textarea = container.querySelector<HTMLInputElement>('[aria-label="루시에게 보낼 메시지"]')!;
  const form = textarea.closest('form')!;
  expect(textarea.maxLength).toBe(1000);
  await input(textarea, '가'.repeat(1001));
  await submit(form);
  expect(api.streamMessage).not.toHaveBeenCalled();
  await input(textarea, '가'.repeat(1000));
  await submit(form);
  expect(api.streamMessage).toHaveBeenCalledWith('가'.repeat(1000));
  expect(textarea.value).toBe('가'.repeat(1000));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('전송 실패');
});

it('루시 답변 실패 시 안내와 다시 시도를 보여주고, 재시도하면 같은 내용으로 다시 보낸다', async () => {
  vi.mocked(api.streamMessage)
    .mockImplementationOnce(async function* () { throw new api.AgentReplyError(); })
    .mockImplementationOnce(async function* () { yield '들려주셔서 고마워요.'; });
  await render();
  const form = container.querySelector('form[class*="border-t"]') as HTMLFormElement;
  const textarea = form.querySelector('textarea') as HTMLTextAreaElement;
  await input(textarea, '아침마다 괴로워요');
  await submit(form);

  // 고정 문구 대신 실패 안내 + 다시 시도, 내 말풍선은 유지
  expect(container.textContent).toContain('루시가 지금 답변을 만들지 못했어요');
  expect(container.textContent).toContain('아침마다 괴로워요');
  expect(api.streamMessage).toHaveBeenCalledTimes(1);

  // 재시도 성공 후 서버가 저장한 확정 메시지(사용자 발화 + 루시 답변)를 내려준다.
  const saved: AgentMessage[] = [
    { ...message, id: 'reply-1', content: '들려주셔서 고마워요.', created_at: '2026-10-08T01:00:03Z' },
    { ...message, id: 'user-1', sender: 'user', content: '아침마다 괴로워요', created_at: '2026-10-08T01:00:01Z' },
  ];
  vi.mocked(api.listMessages).mockResolvedValue({ items: saved, has_more: false });
  await act(async () => { button('다시 시도').click(); });

  expect(api.streamMessage).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.streamMessage).mock.calls[1][0]).toBe('아침마다 괴로워요');
  expect(container.textContent).not.toContain('루시가 지금 답변을 만들지 못했어요');
  expect(container.textContent?.match(/아침마다 괴로워요/g)?.length).toBe(1); // 말풍선 중복 없음
});
