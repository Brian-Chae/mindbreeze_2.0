// @vitest-environment jsdom
// SDD-208 I1 — 종료 화면 "리포트 받기" 시트 본문: GuestCompletePanel 에서 분리한 이메일 신청(OTP) 흐름이 그대로 동작한다.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReportEmailRequestPanel } from '../src/components/class/ReportEmailRequestPanel';

const h = vi.hoisted(() => ({ requestOtp: vi.fn(), verifyOtp: vi.fn(), requestReportEmail: vi.fn() }));
vi.mock('../src/lib/api/auth', () => ({ requestOtp: h.requestOtp, verifyOtp: h.verifyOtp }));
vi.mock('../src/lib/api/session', () => ({ requestReportEmail: h.requestReportEmail }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.requestOtp.mockResolvedValue({ ok: true });
  h.verifyOtp.mockResolvedValue({ email_verify_token: 'verified' });
  h.requestReportEmail.mockResolvedValue({ status: 'pending_review', message: null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const base = { sessionId: 's1', participantId: 'p1', participantToken: 'ptok', accountEmail: null as string | null, isLoggedIn: false };
const render = (props: Partial<typeof base> = {}) => act(async () => root.render(createElement(ReportEmailRequestPanel, { ...base, ...props })));
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;
async function type(selector: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(): Promise<void> {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

it('로그인 회원이 계정 이메일로 신청하면 OTP 없이 신청되고 완료 안내가 나온다', async () => {
  await render({ isLoggedIn: true, accountEmail: 'me@example.test', participantToken: null });
  const email = container.querySelector<HTMLInputElement>('#report-email')!;
  expect(email.readOnly).toBe(true);
  expect(email.value).toBe('me@example.test');
  await submit();
  expect(h.requestOtp).not.toHaveBeenCalled();
  expect(h.requestReportEmail).toHaveBeenCalledWith(
    's1',
    { participant_id: 'p1', email: 'me@example.test', email_verify_token: null, participant_token: null },
    { skipAuth: false },
  );
  expect(container.textContent).toContain('리포트 신청이 완료되었어요.');
  expect(container.textContent).toContain('상담사 승인 후 메일로 발송됩니다');
});

it('게스트는 이메일 → 인증 코드 → 신청 순서로 진행하고 소유 증명 토큰을 함께 보낸다', async () => {
  await render();
  await type('#report-email', 'guest@example.test');
  await submit();
  expect(h.requestOtp).toHaveBeenCalledWith('guest@example.test');
  expect(container.querySelector('#report-otp')).not.toBeNull();
  await type('#report-otp', '123456');
  await submit();
  expect(h.verifyOtp).toHaveBeenCalledWith('guest@example.test', '123456');
  expect(h.requestReportEmail).toHaveBeenCalledWith(
    's1',
    { participant_id: 'p1', email: 'guest@example.test', email_verify_token: 'verified', participant_token: 'ptok' },
    { skipAuth: true },
  );
  expect(container.textContent).toContain('리포트 신청이 완료되었어요.');
});

it('인증 코드가 6자리가 아니면 신청하지 않고 안내한다', async () => {
  await render();
  await type('#report-email', 'guest@example.test');
  await submit();
  await type('#report-otp', '123');
  await submit();
  expect(h.requestReportEmail).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('6자리 인증 코드를 입력해 주세요.');
});

it('참가 정보가 없으면 신청 폼 대신 안내만 보인다', async () => {
  await render({ participantId: null });
  expect(container.querySelector('form')).toBeNull();
  expect(container.textContent).toContain('참가 정보가 없어 리포트를 신청할 수 없습니다.');
});

it('게스트에게 소유 증명 토큰이 없으면 신청할 수 없다', async () => {
  await render({ participantToken: null });
  expect(container.querySelector('form')).toBeNull();
  expect(button('인증 코드 받기')).toBeNull();
});
