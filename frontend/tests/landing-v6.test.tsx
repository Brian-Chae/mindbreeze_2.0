// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api/org-inquiry';
import LandingPage from '../src/pages/LandingPage';

vi.mock('../src/lib/api/org-inquiry', () => ({ submitOrgInquiry: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
async function render(node: ReactNode) { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)); }
const dialog = () => document.querySelector('[role="dialog"]');
async function type(selector: string, value: string) {
  const el = document.querySelector(selector) as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}

it('섹션이 시안 순서대로 렌더링된다', async () => {
  await render(<LandingPage />);
  const ids = [...container.querySelectorAll('main > section')].map((s) => s.id);
  expect(ids).toEqual(['hero', '', 'roles', 'apps', 'multidevice', 'pause', 'signals', 'reports', 'inquiry', 'band', 'journey', 'download', 'trust', 'faq', 'contact']);
});

it('로그인·코드 입장·웹 시작 링크와 스토어 배지·곧 출시 문구를 유지한다', async () => {
  await render(<LandingPage />);
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toContain('/login');
  expect(hrefs).toContain('/join');
  expect(container.querySelectorAll('.badge img').length).toBe(2);
  expect(container.querySelectorAll('.badge-item small').length).toBe(2);
  expect(container.textContent).toContain('웹에서 바로 시작하기');
  expect(container.textContent).not.toContain('시안 미리보기');
});

it('CTA 5곳(hero·roles·mid·contact·floating)이 모두 문의 모달을 연다', async () => {
  await render(<LandingPage />);
  for (const source of ['hero', 'roles', 'mid', 'contact']) {
    expect(dialog()).toBeNull();
    await act(async () => (container.querySelector(`[data-cta="${source}"]`) as HTMLButtonElement).click());
    expect(dialog()).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(dialog()).toBeNull();
  }
  const floating = container.querySelector('.float-cta') as HTMLButtonElement;
  expect(floating.textContent).toBe('기관 가입 문의');
  await act(async () => floating.click());
  expect(dialog()).not.toBeNull();
  expect(container.querySelector('.float-cta')?.hasAttribute('hidden')).toBe(true);
});

it('모달은 X·바깥 클릭으로 닫히고 Tab 이 모달 안에서 순환한다', async () => {
  await render(<LandingPage />);
  const open = async () => act(async () => (container.querySelector('[data-cta="hero"]') as HTMLButtonElement).click());
  await open();
  await act(async () => (document.querySelector('.modal-x') as HTMLButtonElement).click());
  expect(dialog()).toBeNull();
  await open();
  const backdrop = document.querySelector('[data-testid="inquiry-backdrop"]') as HTMLElement;
  await act(async () => { backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(dialog()).toBeNull();
  await open();
  const submit = document.querySelector('button[type="submit"]') as HTMLButtonElement;
  submit.focus();
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
  expect(dialog()!.contains(document.activeElement)).toBe(true);
});

it('모달 필수값 미입력 시 오류, 정상 제출 시 API 호출 후 완료 화면을 보여준다', async () => {
  vi.mocked(api.submitOrgInquiry).mockResolvedValue({ inquiry_id: 'x', status: 'new' });
  await render(<LandingPage />);
  await act(async () => (container.querySelector('[data-cta="hero"]') as HTMLButtonElement).click());
  const form = () => document.querySelector('form')!;
  await act(async () => { form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('기관명');
  expect(api.submitOrgInquiry).not.toHaveBeenCalled();
  await type('#oi-org-name', '마음숲'); await type('#oi-contact-name', '홍길동');
  await type('#oi-phone', '010-1234-5678'); await type('#oi-email', 'hong@example.com');
  await act(async () => (document.querySelectorAll('form input[type="checkbox"]')[1] as HTMLInputElement).click());
  await act(async () => { form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(api.submitOrgInquiry).toHaveBeenCalledTimes(1);
  expect(dialog()!.textContent).toContain('기관 가입 문의가 접수되었습니다.');
  await act(async () => ([...document.querySelectorAll('button')].find((b) => b.textContent === '닫고 서비스 둘러보기') as HTMLButtonElement).click());
  expect(dialog()).toBeNull();
});
