// 초대 토큰으로 최초 비밀번호 설정 (기관 담당자 온보딩)

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient, ApiError, tokenStorage } from '../lib/api/client';
import type { LoginResponse } from '../lib/api/auth';
import { useAuthStore } from '../stores/authStore';

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

interface SetPasswordSuccessResponse {
  success: boolean;
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.access_token === 'string' && record.user !== undefined;
}

export default function SetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const inviteType = params.get('type');
  const isCounselorInvite = inviteType === 'counselor';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (!token) {
      setLinkExpired(true);
      return;
    }
    if (!PASSWORD_REGEX.test(password)) {
      setError('비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다');
      return;
    }
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post<LoginResponse | SetPasswordSuccessResponse>(
        '/auth/set-password',
        { token, new_password: password },
        { skipAuth: true },
      );

      let redirectPath = '/dashboard/org';
      if (isLoginResponse(response)) {
        tokenStorage.set(response.access_token, response.refresh_token);
        localStorage.setItem('mb_user', JSON.stringify(response.user));
        useAuthStore.setState({
          user: response.user,
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          isAuthenticated: true,
          isInitialized: true,
        });
        redirectPath =
          response.user.role === 'counselor' ? '/dashboard' : '/dashboard/org';
      } else if (isCounselorInvite) {
        redirectPath = '/dashboard';
      }

      navigate(redirectPath, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 410)) {
        setLinkExpired(true);
      } else if (err instanceof ApiError) {
        setError(err.message || '비밀번호 설정에 실패했습니다');
      } else {
        setError('네트워크 오류가 발생했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen font-sans">
      <img
        src="/mb-design/assets/images/background3.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/35" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-[18px] px-6">
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
            to="/login"
            className="text-[13px] text-white/90 hover:text-white font-medium px-4 py-2 rounded-full border border-white/30 hover:border-white/60 transition-colors"
          >
            {isCounselorInvite ? '상담사 로그인' : '기관 로그인'}
          </Link>
        </div>

        <img
          src="/mb-design/assets/logo_symbol_dark.svg"
          width={64}
          height={29}
          alt=""
          className="brightness-0 invert opacity-80"
        />
        <div className="font-extrabold text-[22px] text-white/70 tracking-tight">Mind&nbsp;Breeze</div>
        <h1 className="text-[36px] font-extrabold text-white tracking-tighter leading-tight">
          {isCounselorInvite ? '상담사 계정 활성화' : '비밀번호 설정'}
        </h1>
        <div className="text-[15px] text-white/60 mb-7 text-center">
          {isCounselorInvite ? (
            <>
              기관 담당자의 초대로 접속하셨습니다.
              <br />
              상담사 계정 활성화를 위해 비밀번호를 설정해주세요.
            </>
          ) : (
            <>
              초대 링크로 접속하셨습니다.
              <br />
              계정 활성화를 위해 비밀번호를 설정해주세요.
            </>
          )}
        </div>

        {linkExpired ? (
          <div className="flex flex-col items-center gap-4 text-center max-w-[320px]">
            <p className="text-[15px] text-white bg-red-500/80 rounded-full px-4 py-2" role="alert">
              초대 링크가 만료되었거나 유효하지 않습니다
            </p>
            <Link
              to="/login"
              className="text-[13px] text-white/85 hover:text-white underline-offset-2 hover:underline"
            >
              {isCounselorInvite ? '상담사 로그인 페이지로 이동' : '기관 로그인 페이지로 이동'}
            </Link>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col items-center gap-3">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="새 비밀번호"
              disabled={loading}
              autoComplete="new-password"
              className="h-[52px] w-[280px] rounded-full bg-white border border-[#DDDEE7] px-5 text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-50"
            />
            <input
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              placeholder="비밀번호 확인"
              disabled={loading}
              autoComplete="new-password"
              className="h-[52px] w-[280px] rounded-full bg-white border border-[#DDDEE7] px-5 text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-50"
            />

            {error && (
              <p className="text-[13px] text-white bg-red-500/80 rounded-full px-4 py-1.5" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password || !passwordConfirm}
              className="h-[52px] w-[280px] rounded-full bg-[#5F0080] hover:bg-[#4B0066] active:bg-[#3F0055] disabled:opacity-60 text-white font-semibold text-[15px] transition-colors"
            >
              {loading ? '설정 중…' : '비밀번호 설정 완료'}
            </button>
          </form>
        )}

        <div className="mt-7 text-[12px] text-white/70 text-center">
          이미 비밀번호를 설정하셨나요?{' '}
          <Link to="/login" className="text-white font-semibold hover:underline">
            로그인하기
          </Link>
        </div>
      </div>
    </div>
  );
}
