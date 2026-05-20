import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';

export default function LoginPage() {
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

  return (
    <div className="relative min-h-screen overflow-hidden font-sans">
      <img
        src="/mb-design/assets/images/background3.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/35" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-[18px] px-6">
        <img
          src="/mb-design/assets/logo_symbol_dark.svg"
          width={84}
          height={38}
          alt=""
          className="brightness-0 invert"
        />
        <div className="font-extrabold text-[32px] text-white tracking-tight">
          mind&nbsp;breeze
        </div>
        <div className="text-[15px] text-white/85 mb-7">
          상담사 전용 · MIND BREEZE Operator
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
