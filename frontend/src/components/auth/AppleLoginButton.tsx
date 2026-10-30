// Sign in with Apple 버튼 (iOS 네이티브) — 서버 발급 nonce 로 인증하고 서버가 id_token 을 검증한다.

import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import { apiErrorCode, requestAppleChallenge, type ConsentPayload } from '../../lib/api/auth';
import { isAppleLoginAvailable, nativeAppleCredential } from '../../lib/native/apple';
import type { SocialCredential } from '../../stores/social-signup-store';

interface AppleLoginButtonProps {
  role?: string;
  inviteToken?: string;
  rememberMe?: boolean;
  /** 신규 가입 시에만 서버가 검사한다 — 재로그인에는 보내지 않아도 된다. */
  consents?: ConsentPayload;
  birthDate?: string;
  /** 서버 호출 전 입력 검증 — 문구를 돌려주면 onError 로 알리고 인증 창을 열지 않는다. */
  validateBeforeSubmit?: () => string | null;
  disabled?: boolean;
  /** 로그인 성공 */
  onSuccess?: (user: ReturnType<typeof useAuthStore.getState>['user']) => void;
  /** 신규 가입에 필요한 동의·생년월일이 비어 서버가 422 를 준 경우(화면이 입력란을 보여 준다) */
  onNeedsSignupInfo?: (code: string | null, credential?: SocialCredential) => void;
  onError?: (message: string) => void;
}

function messageFor(err: unknown): string {
  const code = apiErrorCode(err);
  if (code === 'ACCOUNT_LINK_REQUIRED') return '이미 같은 이메일로 가입된 계정이 있어요. 기존 방법으로 로그인한 뒤 연결해 주세요.';
  if (code === 'ACCOUNT_DELETION_PENDING') return '탈퇴 처리 중인 계정이에요. 영구 삭제가 끝난 뒤 다시 가입할 수 있어요.';
  if (code === 'APPLE_UNAVAILABLE') return 'Apple 인증 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
  if (err instanceof ApiError) return err.message || 'Apple 로그인에 실패했어요. 다시 시도해 주세요.';
  return 'Apple 로그인이 취소되었거나 실패했어요. 다시 시도해 주세요.';
}

const SIGNUP_INFO_CODES = new Set(['BIRTH_DATE_REQUIRED', 'CONSENT_REQUIRED', 'AGE_RESTRICTED', 'INVALID_BIRTH_DATE']);

export default function AppleLoginButton({
  role,
  inviteToken,
  rememberMe = true,
  consents,
  birthDate,
  validateBeforeSubmit,
  disabled,
  onSuccess,
  onNeedsSignupInfo,
  onError,
}: AppleLoginButtonProps) {
  const loginApple = useAuthStore((s) => s.loginApple);
  const [loading, setLoading] = useState(false);

  if (!isAppleLoginAvailable()) return null;

  const handleClick = async (): Promise<void> => {
    if (loading || disabled) return;
    const blocked = validateBeforeSubmit?.();
    if (blocked) { onError?.(blocked); return; }
    setLoading(true);
    let credential: Awaited<ReturnType<typeof nativeAppleCredential>> | null = null;
    try {
      const { nonce } = await requestAppleChallenge();
      credential = await nativeAppleCredential(nonce);
      const user = await loginApple(
        {
          id_token: credential.idToken,
          nonce: credential.nonce,
          authorization_code: credential.authorizationCode,
          name: credential.name,
          invite_token: inviteToken,
          role,
          consents,
          birth_date: birthDate || undefined,
        },
        rememberMe,
      );
      onSuccess?.(user);
    } catch (err) {
      const code = apiErrorCode(err);
      if (err instanceof ApiError && err.status === 422 && code && SIGNUP_INFO_CODES.has(code)) {
        // 계정은 만들어지지 않았고 nonce 도 소비되지 않았다 — 같은 자격으로 확인 화면에서 다시 제출한다.
        if (onNeedsSignupInfo && credential) {
          onNeedsSignupInfo(code, {
            provider: 'apple',
            idToken: credential.idToken,
            nonce: credential.nonce,
            authorizationCode: credential.authorizationCode,
            name: credential.name,
          });
          return;
        }
        onNeedsSignupInfo?.(code);
      }
      onError?.(messageFor(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={loading || disabled}
      className="flex h-[52px] w-full items-center justify-center gap-3 rounded-full bg-black px-4 text-[15px] font-semibold text-white transition-colors hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M16.37 1.43c0 1.14-.46 2.22-1.2 3.01-.8.86-2.1 1.52-3.16 1.43-.13-1.1.41-2.25 1.15-3 .83-.87 2.2-1.5 3.21-1.44zM20.5 17.3c-.55 1.27-.81 1.84-1.52 2.96-.99 1.57-2.38 3.52-4.1 3.54-1.53.02-1.93-1-4.01-.99-2.08.01-2.52 1.01-4.05.99-1.72-.02-3.04-1.78-4.03-3.35C-.04 16.1-.33 10.97 1.4 8.3c1.22-1.89 3.15-3 4.96-3 1.84 0 3 1.01 4.52 1.01 1.48 0 2.38-1.01 4.51-1.01 1.61 0 3.32.88 4.54 2.4-3.99 2.19-3.34 7.9.57 9.6z" />
      </svg>
      {loading ? '연결 중…' : 'Apple로 계속하기'}
    </button>
  );
}
