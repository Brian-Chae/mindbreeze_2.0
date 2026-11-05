// @vitest-environment jsdom
// 코치(상담사) 코드 입력 화면(RegisterClientPage)의 숫자 키패드 속성 및 숫자 외 문자 제거 단언
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getOnboardingProgress = vi.fn();
const getProfile = vi.fn();
const checkCounselorCode = vi.fn();

vi.mock('../src/lib/api/onboarding', () => ({
  getOnboardingProgress: (...a: unknown[]) => getOnboardingProgress(...a),
  submitClientStep1: vi.fn(),
  submitClientStep2: vi.fn(),
  submitClientStep3: vi.fn(),
  matchClientWithCounselor: vi.fn(),
  confirmClientInviteMatch: vi.fn(),
}));

vi.mock('../src/lib/api/client-portal', () => ({
  getProfile: (...a: unknown[]) => getProfile(...a),
}));

vi.mock('../src/lib/api/signup', () => ({
  checkCounselorCode: (...a: unknown[]) => checkCounselorCode(...a),
  registerClient: vi.fn(),
}));

vi.mock('../src/lib/api/auth', () => ({
  requestOtp: vi.fn().mockResolvedValue({ message: '인증 코드가 발송되었습니다' }),
  verifyOtp: vi.fn().mockResolvedValue({ valid: true, email_verify_token: 'valid_token' }),
  apiErrorCode: () => null,
}));

import ClientOnboardingPage from '../src/pages/onboarding/ClientOnboardingPage';
import RegisterClientPage from '../src/pages/register/RegisterClientPage';
import { useAuthStore } from '../src/stores/authStore';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  getOnboardingProgress.mockReset();
  getProfile.mockReset();
  checkCounselorCode.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('ClientOnboardingPage 이전 주소 호환', () => {
  it.each([
    { required: [] as string[], target: '회원 홈' },
    { required: ['gender'], target: '필수 정보 보완' },
  ])('필수정보 누락 $required에 따라 $target으로 이동한다', async ({ required, target }) => {
    useAuthStore.setState({
      user: { id: 'u1', name: '회원', role: 'client', counselors: [], onboarding_completed: true, client_required_fields: required } as never,
      isAuthenticated: true, isInitialized: true,
    });
    await act(async () => {
      root!.render(createElement(MemoryRouter, { initialEntries: ['/onboarding/client'] }, createElement(Routes, null,
        createElement(Route, { path: '/onboarding/client', element: createElement(ClientOnboardingPage) }),
        createElement(Route, { path: '/app', element: createElement('p', null, '회원 홈') }),
        createElement(Route, { path: '/onboarding/client/essentials', element: createElement('p', null, '필수 정보 보완') }),
      )));
    });
    await flush();
    expect(host!.textContent).toBe(target);
    expect(host!.querySelector('#onboarding-counselor-code')).toBeNull();
    expect(getOnboardingProgress).not.toHaveBeenCalled();
  });
});

describe('RegisterClientPage 코치 코드 숫자 입력', () => {
  it('Step 2 진입 시 inputMode="numeric", pattern="[0-9]*", autoComplete="off" 및 숫자 외 문자 필터링을 단언한다', async () => {
    await act(async () => {
      root!.render(
        createElement(MemoryRouter, { initialEntries: ['/register/client'] }, createElement(RegisterClientPage)),
      );
    });
    await flush();

    // Step 1: 이메일 입력 + OTP 요청
    const emailInput = host!.querySelector('#email') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(emailInput, 'test@example.com');
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();

    const sendOtpBtn = Array.from(host!.querySelectorAll('button')).find((b) => b.textContent?.includes('인증 요청'));
    await act(async () => {
      sendOtpBtn?.click();
    });
    await flush();

    // OTP 입력 (첫 번째 OTP 입력칸에 '123456' 입력 시 OtpInput 내부에서 6자리 채워짐)
    const otpInputs = host!.querySelectorAll('input[autocomplete="one-time-code"]');
    if (otpInputs.length > 0) {
      await act(async () => {
        setter.call(otpInputs[0], '123456');
        otpInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      });
      await flush();
    }

    // Step 1 확인 및 Step 2 이동 ('다음' 버튼 클릭)
    const nextBtn1 = Array.from(host!.querySelectorAll('button')).find((b) => b.textContent?.includes('다음'));
    await act(async () => {
      nextBtn1?.click();
    });
    await flush();

    // Step 2 진입 확인
    const codeInput = host!.querySelector('#counselorCode') as HTMLInputElement;
    expect(codeInput).not.toBeNull();
    expect(codeInput.getAttribute('inputmode')).toBe('numeric');
    expect(codeInput.getAttribute('pattern')).toBe('[0-9]*');
    expect(codeInput.getAttribute('autocomplete')).toBe('off');
    expect(codeInput.placeholder).toBe('6자리 숫자');
    expect(host!.textContent).toContain('6자리 숫자');

    // 숫자 외 문자 입력 시 제거되고 숫자만 남는지 검증
    await act(async () => {
      setter.call(codeInput, 'ABC789!@#012');
      codeInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();

    expect(codeInput.value).toBe('789012');
  });
});
