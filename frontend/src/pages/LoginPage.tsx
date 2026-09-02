import { useState, useCallback, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';
import type { User } from '../lib/api/auth';
import { useGoogleLogin } from '@react-oauth/google';

function resolvePostLoginPath(user: User, next: string | null): string {
  if (user.role === 'platform_admin') {
    return next && next.startsWith('/admin') ? next : '/admin/orgs';
  }

  if (user.role === 'org_admin') {
    return '/dashboard/org';
  }

  if (user.role === 'counselor') {
    return '/dashboard';
  }

  if (user.role === 'client') {
    return user.onboarding_completed ? '/app' : '/onboarding/client';
  }

  return '/';
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const loginGoogle = useAuthStore((s) => s.loginGoogle);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
  const loginRole = searchParams.get('role') === 'platform_admin' ? 'platform_admin' : 'counselor';
  const next = searchParams.get('next');
  const isPlatformAdminMode = loginRole === 'platform_admin';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(resolvePostLoginPath(user, next));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 423) {
          setError('계정이 잠겼습니다. 15분 후 다시 시도해주세요');
        } else if (err.status === 401 || err.status === 400) {
          setError('이메일 또는 비밀번호가 일치하지 않습니다');
        } else {
          setError(err.message || '로그인에 실패했습니다');
        }
      } else {
        setError('네트워크 오류가 발생했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = (user: User | null): void => {
    if (!user) {
      navigate('/');
      return;
    }
    navigate(resolvePostLoginPath(user, next));
  };

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setError(null);
      setGoogleLoading(true);
      try {
        const user = await loginGoogle(tokenResponse.access_token, undefined, loginRole);
        handleGoogleSuccess(user);
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : 'Google 로그인에 실패했습니다. 다시 시도해주세요.';
        setError(message);
      } finally {
        setGoogleLoading(false);
      }
    },
    onError: () => {
      setError('Google 로그인 중 오류가 발생했습니다.');
    },
  });

  const handleGoogleClick = useCallback(() => {
    if (googleLoading) return;
    setError(null);
    googleLogin();
  }, [googleLoading, googleLogin]);

  return (
    <div className="relative min-h-screen font-sans">
      <img
        src="/mb-design/assets/images/background3.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/35" />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-[18px] px-6">
        <div className="absolute left-0 right-0 top-0 flex items-center justify-between px-6 py-5">
          <Link
            to="/"
            className="group flex items-center gap-2.5"
            aria-label="랜딩 페이지로 이동"
          >
            <img
              src="/mb-design/assets/logo_symbol_dark.svg"
              width={32}
              height={14}
              alt=""
              className="brightness-0 invert"
            />
            <span className="text-[17px] font-extrabold tracking-tight text-white opacity-90 transition-opacity group-hover:opacity-100">
              Mind&nbsp;Breeze
            </span>
          </Link>
          <Link
            to="/login/client"
            className="rounded-full border border-white/30 px-4 py-2 text-[13px] font-medium text-white/90 transition-colors hover:border-white/60 hover:text-white"
          >
            회원 로그인
          </Link>
        </div>

        <img
          src="/mb-design/assets/logo_symbol_dark.svg"
          width={64}
          height={29}
          alt=""
          className="brightness-0 invert opacity-80"
        />
        <div className="text-[22px] font-extrabold tracking-tight text-white/70">
          Mind&nbsp;Breeze
        </div>
        <h1 className="text-[36px] font-extrabold leading-tight tracking-tighter text-white">
          {isPlatformAdminMode ? '시스템 관리자 로그인' : '상담사 로그인'}
        </h1>
        <div className="mb-7 text-[15px] text-white/60">
          {isPlatformAdminMode ? 'MIND BREEZE System Admin' : 'MIND BREEZE Operator'}
        </div>

        {!isPlatformAdminMode && (
          <form onSubmit={handleSubmit} className="flex flex-col items-center gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일"
              disabled={loading}
              autoComplete="email"
              className="h-[52px] w-[280px] rounded-full border border-[#DDDEE7] bg-white px-5 text-[15px] text-[#1F1F1F] outline-none placeholder:text-[#9A9BA8] focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-50"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              disabled={loading}
              autoComplete="current-password"
              className="h-[52px] w-[280px] rounded-full border border-[#DDDEE7] bg-white px-5 text-[15px] text-[#1F1F1F] outline-none placeholder:text-[#9A9BA8] focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-50"
            />

            {error && (
              <p className="rounded-full bg-red-500/80 px-4 py-1.5 text-[13px] text-white" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="h-[52px] w-[280px] rounded-full bg-[#5F0080] text-[15px] font-semibold text-white transition-colors hover:bg-[#4B0066] active:bg-[#3F0055] disabled:opacity-60"
            >
              {loading ? '로그인 중…' : '로그인'}
            </button>
          </form>
        )}

        {isPlatformAdminMode && error && (
          <p className="rounded-full bg-red-500/80 px-4 py-1.5 text-[13px] text-white" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col items-center gap-3">
          {!isPlatformAdminMode && (
            <div className="flex w-[280px] items-center gap-3">
              <div className="h-px flex-1 bg-white/20" />
              <span className="text-[13px] text-white/60">또는</span>
              <div className="h-px flex-1 bg-white/20" />
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={!hasGoogleClientId || googleLoading}
            className="flex h-[52px] w-[280px] items-center justify-center gap-3 rounded-full border border-white/20 bg-white/10 transition-colors hover:border-white/40 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {googleLoading ? (
              <span className="text-[15px] font-medium text-white/80">연결 중...</span>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span className="text-[15px] font-medium text-white/90">
                  {isPlatformAdminMode ? 'Google Workspace로 로그인' : 'Google로 시작하기'}
                </span>
              </>
            )}
          </button>

          {!isPlatformAdminMode && (
            <button
              type="button"
              disabled
              className="flex h-[52px] w-[280px] cursor-not-allowed items-center justify-center gap-3 rounded-full border border-white/20 bg-[#FEE500]/70 opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M9 0C4.03 0 0 3.144 0 7.024c0 2.465 1.633 4.63 4.09 5.864l-1.03 3.784c-.066.242.213.44.434.306l4.518-2.995c.322.044.65.066.988.066 4.97 0 9-3.145 9-7.025S13.97 0 9 0z"
                  fill="#391B1B"
                  fillOpacity="0.85"
                />
              </svg>
              <span className="text-[15px] font-medium text-[#391B1B]/60">카카오로 시작하기</span>
            </button>
          )}
        </div>

        {!isPlatformAdminMode && (
          <>
            <Link
              to="/forgot-password"
              className="text-[13px] text-white/85 underline-offset-2 hover:text-white hover:underline"
            >
              비밀번호를 잊으셨나요?
            </Link>
            <div className="text-[13px] text-white/85">
              아직 계정이 없으신가요?{' '}
              <Link to="/register" className="font-semibold text-white hover:underline">
                회원가입
              </Link>
            </div>
            <div className="mt-7 text-[12px] text-white/70">
              기관 발급 계정으로만 접속하실 수 있습니다.
            </div>
          </>
        )}

        {isPlatformAdminMode && (
          <div className="mt-7 max-w-[320px] text-center text-[12px] text-white/70">
            시스템 어드민은 Google 로그인만 지원한다. `@looxidlabs.com` 계정으로 로그인하면 관리자 접근이 승인된다.
          </div>
        )}
      </div>
    </div>
  );
}
