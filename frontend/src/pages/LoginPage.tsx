import { useState, useCallback, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';
import type { User } from '../lib/api/auth';
import { useGoogleLogin } from '@react-oauth/google';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const loginGoogle = useAuthStore((s) => s.loginGoogle);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.onboarding_completed) {
        if (user.role === 'counselor') {
          navigate('/dashboard');
        } else if (user.role === 'client') {
          navigate('/clients');
        } else {
          navigate('/');
        }
      } else if (user.role === 'counselor') {
        navigate('/onboarding/counselor');
      } else if (user.role === 'client') {
        navigate('/onboarding/client');
      } else {
        navigate('/');
      }
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
    if (user.onboarding_completed) {
      navigate('/dashboard');
    } else {
      navigate('/onboarding/counselor');
    }
  };

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setError(null);
      setGoogleLoading(true);
      try {
        const user = await loginGoogle(tokenResponse.access_token, undefined, 'counselor');
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
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/35" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-[18px] px-6">
        {/* 상단 전환 버튼 */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5">
          <Link
            to="/"
            className="flex items-center gap-2.5 group"
            aria-label="랜딩 페이지로 이동"
          >
            <img
              src="/mb-design/assets/logo_symbol_dark.svg"
              width={32}
              height={14}
              alt=""
              className="brightness-0 invert"
            />
            <span className="font-extrabold text-[17px] text-white tracking-tight opacity-90 group-hover:opacity-100 transition-opacity">
              Mind&nbsp;Breeze
            </span>
          </Link>
          <Link
            to="/login/client"
            className="text-[13px] text-white/90 hover:text-white font-medium px-4 py-2 rounded-full border border-white/30 hover:border-white/60 transition-colors"
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
        <div className="font-extrabold text-[22px] text-white/70 tracking-tight">
          Mind&nbsp;Breeze
        </div>
        <h1 className="text-[36px] font-extrabold text-white tracking-tighter leading-tight">
          상담사 로그인
        </h1>
        <div className="text-[15px] text-white/60 mb-7">
          MIND BREEZE Operator
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            disabled={loading}
            autoComplete="email"
            className="h-[52px] w-[280px] rounded-full bg-white border border-[#DDDEE7] px-5 text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-50"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            disabled={loading}
            autoComplete="current-password"
            className="h-[52px] w-[280px] rounded-full bg-white border border-[#DDDEE7] px-5 text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-50"
          />

          {error && (
            <p className="text-[13px] text-white bg-red-500/80 rounded-full px-4 py-1.5" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="h-[52px] w-[280px] rounded-full bg-[#5F0080] hover:bg-[#4B0066] active:bg-[#3F0055] disabled:opacity-60 text-white font-semibold text-[15px] transition-colors"
          >
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>

        {/* 소셜 로그인 */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3 w-[280px]">
            <div className="flex-1 h-px bg-white/20" />
            <span className="text-[13px] text-white/60">또는</span>
            <div className="flex-1 h-px bg-white/20" />
          </div>

          {/* Google 로그인 — 다크 테마 맞춤 */}
          <button
            type="button"
            onClick={handleGoogleClick}
            disabled={!hasGoogleClientId || googleLoading}
            className="flex items-center justify-center gap-3 w-[280px] h-[52px] rounded-full bg-white/10 border border-white/20 hover:bg-white/20 hover:border-white/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                <span className="text-[15px] font-medium text-white/90">Google로 시작하기</span>
              </>
            )}
          </button>

          {/* 카카오 로그인 (비활성) */}
          <button
            type="button"
            disabled
            className="flex items-center justify-center gap-3 w-[280px] h-[52px] rounded-full bg-[#FEE500]/70 border border-white/20 opacity-50 cursor-not-allowed"
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
        </div>

        <Link
          to="/forgot-password"
          className="text-[13px] text-white/85 hover:text-white underline-offset-2 hover:underline"
        >
          비밀번호를 잊으셨나요?
        </Link>
        <div className="text-[13px] text-white/85">
          아직 계정이 없으신가요?{' '}
          <Link to="/register" className="text-white font-semibold hover:underline">
            회원가입
          </Link>
        </div>

        <div className="mt-7 text-[12px] text-white/70">
          기관 발급 계정으로만 접속하실 수 있습니다.
        </div>
      </div>
    </div>
  );
}
