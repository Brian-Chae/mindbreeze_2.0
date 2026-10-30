// 회원가입 이메일 인증 — 숫자 키패드 + 이메일 변경·재요청 (신승찬 버그 리포트 10/30)
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { OtpInput } from '../src/components/auth/OtpInput';
import { sanitizeOtp } from '../src/lib/sanitize-otp';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('OtpInput — 숫자 키패드', () => {
  const html = renderToStaticMarkup(createElement(OtpInput, { value: '', onChange: () => {} }));
  test('단일 input + numeric 속성 + one-time-code', () => {
    expect((html.match(/<input/g) || []).length).toBe(1);
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('pattern="[0-9]*"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).not.toContain('inputMode="text"');
  });
  test('숫자 외 문자 제거·6자리 제한', () => {
    expect(sanitizeOtp('12a3-45 6789', 6)).toBe('123456');
    expect(sanitizeOtp('abc', 6)).toBe('');
  });
});

describe.each([
  'src/pages/register/RegisterClientPage.tsx',
  'src/pages/register/RegisterCounselorPage.tsx',
])('%s — 이메일 변경·재요청', (file) => {
  const src = read(file);
  test('이메일 변경 버튼이 코드·토큰을 초기화하고 입력 단계로 복귀', () => {
    expect(src).toContain('이메일 변경');
    expect(src).toMatch(/handleChangeEmail[\s\S]{0,200}setOtpSent\(false\)[\s\S]{0,100}setOtp\(''\)[\s\S]{0,100}setEmailVerifyToken\(null\)/);
  });
  test('인증번호 다시 받기 + 쿨다운 준수', () => {
    expect(src).toContain('인증번호 다시 받기');
    expect(src).toContain('cooldown.remaining > 0');
  });
});
