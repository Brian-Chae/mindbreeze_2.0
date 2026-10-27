// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api/org-inquiry';
import { ApiError } from '../src/lib/api/client';
import { OrgInquiryForm, ORG_INQUIRY_SUCCESS_MESSAGE } from '../src/components/landing/OrgInquiryForm';
import { CTASection } from '../src/components/landing/CTASection';

vi.mock('../src/lib/api/org-inquiry', () => ({ submitOrgInquiry: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
async function render(node: ReactNode) { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); }
async function type(selector: string, value: string) {
  const el = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function check(selector: string) { await act(async () => (container.querySelector(selector) as HTMLInputElement).click()); }
async function submit() { await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function fillRequired() {
  await type('#oi-org-name', '마음숲 상담센터'); await type('#oi-contact-name', '홍길동');
  await type('#oi-phone', '010-1234-5678'); await type('#oi-email', 'hong@example.com');
}
const consentBox = () => container.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement;

it('필수값 누락·이메일 형식 오류·동의 미체크 시 제출을 막고 오류를 보여준다', async () => {
  await render(<OrgInquiryForm />);
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('기관명');
  await fillRequired(); await type('#oi-email', 'bad');
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('이메일');
  await type('#oi-email', 'hong@example.com');
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('동의');
  expect(api.submitOrgInquiry).not.toHaveBeenCalled();
});

it('정상 제출 시 페이로드(허니팟 빈 값)를 보내고 제출 중 버튼을 막은 뒤 성공 문구를 보여준다', async () => {
  let resolve!: (v: api.OrgInquiryResponse) => void;
  vi.mocked(api.submitOrgInquiry).mockReturnValue(new Promise((r) => { resolve = r; }));
  const onSuccess = vi.fn();
  await render(<OrgInquiryForm onSuccess={onSuccess} />);
  await fillRequired(); await type('#oi-users', '30'); await type('#oi-message', '도입 문의');
  await check('input[type="checkbox"]');
  await act(async () => consentBox().click());
  await submit();
  const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
  expect(submitBtn.disabled).toBe(true);
  await submit();
  expect(api.submitOrgInquiry).toHaveBeenCalledTimes(1);
  const payload = vi.mocked(api.submitOrgInquiry).mock.calls[0][0];
  expect(payload).toMatchObject({ org_name: '마음숲 상담센터', email: 'hong@example.com', expected_users: 30, band_interest: true, privacy_consent: true, website: '' });
  await act(async () => resolve({ inquiry_id: 'x', status: 'new' }));
  expect(container.textContent).toContain(ORG_INQUIRY_SUCCESS_MESSAGE);
  expect(onSuccess).toHaveBeenCalled();
});

it('서버 실패 시 오류 메시지를 보여주고 다시 제출할 수 있다', async () => {
  vi.mocked(api.submitOrgInquiry).mockRejectedValueOnce(new ApiError(500, 'x', null)).mockResolvedValueOnce({ inquiry_id: 'x', status: 'new' });
  await render(<OrgInquiryForm />);
  await fillRequired(); await act(async () => consentBox().click());
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('실패');
  expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  await submit();
  expect(container.textContent).toContain(ORG_INQUIRY_SUCCESS_MESSAGE);
});

it('랜딩 CTA 버튼을 누르면 문의 폼 모달이 열린다', async () => {
  await render(<CTASection />);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('기관 도입 문의'))!;
  await act(async () => btn.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.querySelector('form[aria-label="기관 도입 문의"]')).not.toBeNull();
});
