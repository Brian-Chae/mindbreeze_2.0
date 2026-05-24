import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';
import type { User } from '../lib/api/auth';
import GoogleLoginButton from '../components/auth/GoogleLoginButton';

export default function ClientLoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.onboarding_completed) {
        if (user.role === 'client') {
          navigate('/app');
        } else if (user.role === 'counselor') {
          navigate('/dashboard');
        } else {
          navigate('/');
        }
      } else if (user.role === 'client') {
        navigate('/onboarding/client');
      } else if (user.role === 'counselor') {
        navigate('/onboarding/counselor');
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
      if (user.role === 'client') {
        navigate('/app');
      } else {
        navigate('/dashboard');
      }
    } else if (user.role === 'client') {
      navigate('/onboarding/client');
    } else {
      navigate('/onboarding/counselor');
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-block mb-3">
            <h1 className="text-2xl font-bold text-[#1F1F1F]">MIND BREEZE</h1>
          </Link>
          <p className="text-[#6F6F6F] text-sm">내담자 로그인</p>
        </div>

        {/* 이메일/비밀번호 로그인 폼 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일"
              disabled={loading}
              autoComplete="email"
              className="w-full px-4 py-3 border border-[#D4D4D4] rounded-xl text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] outline-none focus:ring-2 focus:ring-[#5F0080] focus:border-transparent disabled:opacity-50 transition-shadow"
            />
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              disabled={loading}
              autoComplete="current-password"
              className="w-full px-4 py-3 border border-[#D4D4D4] rounded-xl text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] outline-none focus:ring-2 focus:ring-[#5F0080] focus:border-transparent disabled:opacity-50 transition-shadow"
            />
          </div>

          {error && (
            <p className="text-[13px] text-red-500 text-center bg-red-50 rounded-xl px-4 py-2" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full rounded-xl px-6 py-3 font-semibold text-white bg-[#5F0080] hover:bg-[#4A0066] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        {/* 구분선 */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-[#D4D4D4]" />
          <span className="text-sm text-[#6F6F6F]">또는</span>
          <div className="flex-1 h-px bg-[#D4D4D4]" />
        </div>

        {/* 소셜 로그인 */}
        <div className="space-y-3">
          <GoogleLoginButton onSuccess={handleGoogleSuccess} />

          {/* 카카오 로그인 (비활성) */}
          <button
            type="button"
            disabled
            className="flex items-center justify-center gap-3 w-full h-[52px] rounded-xl bg-[#FEE500] border border-[#D4D4D4] opacity-50 cursor-not-allowed"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M9 0C4.03 0 0 3.144 0 7.024c0 2.465 1.633 4.63 4.09 5.864l-1.03 3.784c-.066.242.213.44.434.306l4.518-2.995c.322.044.65.066.988.066 4.97 0 9-3.145 9-7.025S13.97 0 9 0z"
                fill="#391B1B"
                fillOpacity="0.85"
              />
            </svg>
            <span className="text-[15px] font-medium text-[#391B1B]/85">카카오로 시작하기</span>
          </button>
        </div>

        {/* 하단 링크 */}
        <div className="mt-6 space-y-3 text-center">
          <Link
            to="/forgot-password"
            className="block text-[13px] text-[#6F6F6F] hover:text-[#5F0080] hover:underline transition-colors"
          >
            비밀번호를 잊으셨나요?
          </Link>
          <p className="text-[13px] text-[#6F6F6F]">
            계정이 없으신가요?{' '}
            <Link to="/register" className="text-[#5F0080] font-semibold hover:underline">
              가입하기
            </Link>
          </p>
        </div>

        {/* 상담사 로그인 링크 */}
        <div className="mt-4 pt-4 border-t border-[#EFEFEF] text-center">
          <Link
            to="/login"
            className="text-[13px] text-[#6F6F6F] hover:text-[#5F0080] transition-colors"
          >
            상담사로 로그인
          </Link>
        </div>
      </div>
    </div>
  );
}
