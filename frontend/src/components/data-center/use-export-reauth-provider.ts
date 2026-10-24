// 데이터 센터 반출 본인 확인 수단 — 로그인 계정 유형에서 결정한다.
import { useAuthStore } from '../../stores/authStore';

export type ReauthProvider = 'email' | 'google' | 'apple';

export function useExportReauthProvider(): ReauthProvider {
  const provider = useAuthStore((s) => s.user?.auth_provider);
  return provider === 'google' || provider === 'apple' ? provider : 'email';
}
