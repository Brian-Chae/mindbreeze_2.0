// Google OAuth 로그인 버튼 (내담자용)
// @react-oauth/google의 useGoogleLogin 훅 사용

import { useState, useCallback } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';

interface GoogleLoginButtonProps {
  inviteToken?: string;
  onSuccess?: (user: ReturnType<typeof useAuthStore.getState>['user']) => void;
  onError?: (error: Error) => void;
}

export default function GoogleLoginButton({
  inviteToken,
  onSuccess,
  onError,
}: GoogleLoginButtonProps) {
  const loginGoogle = useAuthStore((s) => s.loginGoogle);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setError(null);
      setLoading(true);
      try {
        // access_token을 id_token으로 서버에 전달
        const user = await loginGoogle(tokenResponse.access_token, inviteToken);
        onSuccess?.(user);
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : 'Google 로그인에 실패했습니다. 다시 시도해주세요.';
        setError(message);
        onError?.(err instanceof Error ? err : new Error(message));
      } finally {
        setLoading(false);
      }
    },
    onError: (errorResponse) => {
      const message = 'Google 로그인 중 오류가 발생했습니다.';
      setError(message);
      onError?.(new Error(errorResponse.error_description ?? message));
    },
  });

  const handleClick = useCallback(() => {
    if (loading) return;
    setError(null);
    googleLogin();
  }, [loading, googleLogin]);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex items-center justify-center gap-3 w-full h-[52px] rounded-xl bg-white border border-[#D4D4D4] shadow-sm hover:shadow-md hover:border-[#5F0080]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
      >
        {loading ? (
          <span className="text-[15px] font-medium text-[#6F6F6F]">연결 중...</span>
        ) : (
          <>
            {/* Google 로고 */}
            <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            <span className="text-[15px] font-medium text-[#1F1F1F]">Google로 시작하기</span>
          </>
        )}
      </button>
      {error && (
        <p className="text-[13px] text-red-500 text-center" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
