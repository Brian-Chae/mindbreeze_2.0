import { describe, expect, it } from 'vitest';
import { resolvePostLoginPath } from '../src/lib/auth-routing';
import { EMPTY_SIGNUP_INFO, isSignupInfoReady } from '../src/lib/auth/signup-info';
import type { User } from '../src/lib/api/auth';
const base = { role: 'client', onboarding_completed: false, auth_provider: 'email' } as User;
describe('SDD-302 필수정보 기준 진입', () => {
  it('선택 전화가 없어도 필수정보 충족 회원은 홈', () => {
    expect(resolvePostLoginPath({ ...base, client_required_fields: [] })).toBe('/app');
  });
  it('과거 완료 상태도 필수 누락을 우회하지 않는다', () => {
    expect(resolvePostLoginPath({ ...base, onboarding_completed: true, client_required_fields: ['gender'] })).toBe('/onboarding/client/essentials');
  });
  it('신규 소셜 이름 성별 없이 제출 불가', () => {
    expect(isSignupInfoReady({ ...EMPTY_SIGNUP_INFO, birthDate: '1990-01-01', consents: { tos: true, privacy: true, sensitive: true } })).toBe(false);
  });
});
