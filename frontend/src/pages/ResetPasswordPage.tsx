// 비밀번호 재설정: 쿼리스트링 토큰 + 새 비밀번호 입력

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { resetPassword } from '../lib/api/auth';
import { ApiError } from '../lib/api/client';

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
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
      await resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 410)) {
        setLinkExpired(true);
      } else {
        setError('비밀번호 변경에 실패했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-4 sm:p-8 relative">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[420px] space-y-8">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-3xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
          </Link>
          <p className="text-sm text-ink-tertiary">비밀번호 재설정</p>
        </div>

        <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-6">
          {linkExpired ? (
            <div className="text-center space-y-4 py-4">
              <h2 className="text-xl font-bold text-ink-primary">링크가 만료되었습니다</h2>
              <p className="text-sm text-ink-secondary">
                재설정 링크가 만료되었거나 유효하지 않습니다.
              </p>
              <Link
                to="/forgot-password"
                className="inline-block px-6 py-3 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90"
              >
                재설정 링크 다시 요청
              </Link>
            </div>
          ) : success ? (
            <div className="text-center space-y-4 py-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-brand-primary/15 flex items-center justify-center">
                <svg className="w-6 h-6 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-ink-primary">비밀번호가 변경되었습니다</h2>
              <p className="text-sm text-ink-secondary">잠시 후 로그인 페이지로 이동합니다.</p>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-ink-primary">새 비밀번호 설정</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="password" className="block text-sm font-medium text-ink-secondary">
                    새 비밀번호
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="영문+숫자+특수문자 8자 이상"
                    required
                    disabled={loading}
                    className="w-full h-11 px-4 rounded-xl bg-surface border border-border-default text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-50"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="passwordConfirm" className="block text-sm font-medium text-ink-secondary">
                    새 비밀번호 확인
                  </label>
                  <input
                    id="passwordConfirm"
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full h-11 px-4 rounded-xl bg-surface border border-border-default text-sm text-ink-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-50"
                  />
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !password || !passwordConfirm}
                  className="w-full h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? '변경 중...' : '비밀번호 변경'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-sm text-ink-tertiary">
          <Link to="/login" className="text-brand-primary hover:text-brand-primary-hover font-medium">
            로그인 페이지로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  );
}
