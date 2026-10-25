// Android 에서는 Apple 공급자를 등록하지 않는다(apple.android.clientId 누락으로 initialize 전체가 실패해 Google 로그인까지 막힘).
import { beforeEach, expect, test, vi } from 'vitest';

const initialize = vi.fn(async (_opts: Record<string, unknown>) => {});
vi.mock('@capgo/capacitor-social-login', () => ({ SocialLogin: { initialize, login: vi.fn() } }));
let platform = 'android';
vi.mock('../src/lib/native/platform', () => ({ getPlatform: () => platform, isNativeApp: () => true }));

beforeEach(() => { initialize.mockClear(); vi.resetModules(); });

test('android: google 만 등록하고 apple 은 넘기지 않는다', async () => {
  platform = 'android';
  const { ensureSocialLoginInitialized } = await import('../src/lib/native/google');
  await ensureSocialLoginInitialized();
  const opts = initialize.mock.calls[0][0];
  expect(opts).toHaveProperty('google');
  expect(opts).not.toHaveProperty('apple');
});

test('ios: google 과 apple 을 함께 등록한다', async () => {
  platform = 'ios';
  const { ensureSocialLoginInitialized } = await import('../src/lib/native/google');
  await ensureSocialLoginInitialized();
  const opts = initialize.mock.calls[0][0];
  expect(opts).toHaveProperty('google');
  expect(opts).toHaveProperty('apple');
});
