// 비밀번호 찾기: 이메일 입력 → 재설정 링크 발송 (enumeration 방지를 위해 항상 성공 메시지)

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { forgotPassword } from '../lib/api/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email);
    } catch {
      // 의도적으로 무시: enumeration 방지를 위해 항상 동일한 응답을 보여준다
    } finally {
      setLoading(false);
      setSubmitted(true);
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
          <p className="text-sm text-ink-tertiary">비밀번호 찾기</p>
        </div>

        <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-6">
          {!submitted ? (
            <>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-ink-primary">비밀번호 재설정</h2>
                <p className="text-sm text-ink-secondary">
                  가입하신 이메일 주소를 입력해주세요. 재설정 링크를 발송해드립니다.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="block text-sm font-medium text-ink-secondary">
                    이메일
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    disabled={loading}
                    className="w-full h-11 px-4 rounded-xl bg-surface border border-border-default text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? '발송 중...' : '재설정 링크 발송'}
                </button>
              </form>
            </>
          ) : (
            <div className="text-center space-y-4 py-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-brand-primary/15 flex items-center justify-center">
                <svg className="w-6 h-6 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-ink-primary">메일을 확인해주세요</h2>
              <p className="text-sm text-ink-secondary">
                비밀번호 재설정 링크를 이메일로 발송했습니다.
                <br />
                메일이 도착하지 않으면 스팸함을 확인해주세요.
              </p>
            </div>
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
