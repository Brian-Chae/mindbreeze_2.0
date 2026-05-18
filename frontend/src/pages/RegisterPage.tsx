// 회원가입 페이지: 이메일+OTP → 약관 동의 → 비밀번호+이름 (3단계)

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';
import { OtpInput } from '../components/auth/OtpInput';
import { ConsentCheckList, type Consents } from '../components/auth/ConsentCheckList';
import { requestOtp, verifyOtp } from '../lib/api/auth';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';

type Role = 'counselor' | 'client';

// 비밀번호 정책: 영문 + 숫자 + 특수문자, 8자 이상
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

interface StepIndicatorProps {
  current: 1 | 2 | 3;
}

function StepIndicator({ current }: StepIndicatorProps) {
  const steps = [
    { n: 1 as const, label: '이메일 인증' },
    { n: 2 as const, label: '약관 동의' },
    { n: 3 as const, label: '계정 정보' },
  ];
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((s, idx) => (
        <div key={s.n} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
              current >= s.n
                ? 'bg-brand-primary text-ink-on-brand'
                : 'bg-surface-sunken text-ink-tertiary'
            }`}
          >
            {s.n}
          </div>
          <span
            className={`text-xs ${
              current >= s.n ? 'text-ink-primary font-medium' : 'text-ink-tertiary'
            }`}
          >
            {s.label}
          </span>
          {idx < steps.length - 1 && <div className="w-6 h-px bg-border-default" />}
        </div>
      ))}
    </div>
  );
}

export default function RegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const roleParam = params.get('role');
  const role: Role = roleParam === 'client' ? 'client' : 'counselor';

  const registerCounselor = useAuthStore((s) => s.registerCounselor);
  const registerClient = useAuthStore((s) => s.registerClient);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [emailVerifyToken, setEmailVerifyToken] = useState<string | null>(null);

  // Step 2
  const [consents, setConsents] = useState<Consents>({ tos: false, privacy: false, sensitive: false });

  // Step 3
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const handleRequestOtp = async (): Promise<void> => {
    setError(null);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('올바른 이메일을 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      await requestOtp(email);
      setOtpSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('이미 등록된 이메일입니다');
      } else {
        setError('인증 코드 발송에 실패했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (): Promise<void> => {
    setError(null);
    if (otp.length !== 6) {
      setError('6자리 인증 코드를 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      const res = await verifyOtp(email, otp);
      setEmailVerifyToken(res.email_verify_token);
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError('인증 코드가 올바르지 않습니다');
      } else {
        setError('인증에 실패했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConsentNext = (): void => {
    setError(null);
    if (!consents.tos || !consents.privacy || !consents.sensitive) {
      setError('모든 약관에 동의해야 가입할 수 있습니다');
      return;
    }
    setStep(3);
  };

  const handleRegister = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('이름을 입력해주세요');
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
    if (!emailVerifyToken) {
      setError('이메일 인증이 필요합니다');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email,
        password,
        name: name.trim(),
        email_verify_token: emailVerifyToken,
        consents,
      };
      if (role === 'counselor') {
        await registerCounselor(payload);
        navigate('/onboarding/counselor');
      } else {
        await registerClient(payload);
        navigate('/onboarding/client');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError('이미 등록된 이메일입니다');
        } else {
          setError(err.message || '가입에 실패했습니다');
        }
      } else {
        setError('네트워크 오류가 발생했습니다');
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

      <div className="w-full max-w-[480px] space-y-8">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-3xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
          </Link>
          <p className="text-sm text-ink-tertiary">
            {role === 'counselor' ? '상담사 회원가입' : '내담자 회원가입'}
          </p>
        </div>

        <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-6">
          <StepIndicator current={step} />

          <h2 className="text-2xl font-bold text-ink-primary text-center">
            {step === 1 && '이메일 인증'}
            {step === 2 && '약관 동의'}
            {step === 3 && '계정 정보 입력'}
          </h2>

          {/* Step 1: 이메일 + OTP */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-ink-secondary">
                  이메일
                </label>
                <div className="flex gap-2">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    disabled={loading || otpSent}
                    className="flex-1 h-11 px-4 rounded-xl bg-surface border border-border-default text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    disabled={loading || !email || otpSent}
                    className="px-4 h-11 rounded-pill bg-brand-primary text-ink-on-brand text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {otpSent ? '발송됨' : '인증 요청'}
                  </button>
                </div>
              </div>

              {otpSent && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-ink-secondary text-center">
                    6자리 인증 코드를 입력해주세요
                  </label>
                  <OtpInput value={otp} onChange={setOtp} disabled={loading} />
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    disabled={loading}
                    className="w-full text-xs text-ink-tertiary hover:text-brand-primary"
                  >
                    인증 코드 재발송
                  </button>
                </div>
              )}

              {error && <p className="text-red-500 text-sm text-center">{error}</p>}

              <button
                type="button"
                onClick={handleVerifyOtp}
                disabled={loading || !otpSent || otp.length !== 6}
                className="w-full h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '확인 중...' : '다음'}
              </button>
            </div>
          )}

          {/* Step 2: 약관 동의 */}
          {step === 2 && (
            <div className="space-y-4">
              <ConsentCheckList consents={consents} onChange={setConsents} />
              {error && <p className="text-red-500 text-sm text-center">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 h-11 rounded-pill border border-border-default text-ink-secondary font-semibold hover:bg-surface-elevated"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={handleConsentNext}
                  className="flex-1 h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90"
                >
                  다음
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 비밀번호 + 이름 */}
          {step === 3 && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="block text-sm font-medium text-ink-secondary">
                  이름
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  className="w-full h-11 px-4 rounded-xl bg-surface border border-border-default text-sm text-ink-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-ink-secondary">
                  비밀번호
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="영문+숫자+특수문자 8자 이상"
                  disabled={loading}
                  className="w-full h-11 px-4 rounded-xl bg-surface border border-border-default text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="passwordConfirm" className="block text-sm font-medium text-ink-secondary">
                  비밀번호 확인
                </label>
                <input
                  id="passwordConfirm"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  disabled={loading}
                  className="w-full h-11 px-4 rounded-xl bg-surface border border-border-default text-sm text-ink-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15"
                />
              </div>

              {error && <p className="text-red-500 text-sm text-center">{error}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={loading}
                  className="flex-1 h-11 rounded-pill border border-border-default text-ink-secondary font-semibold hover:bg-surface-elevated"
                >
                  이전
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? '가입 중...' : '가입 완료'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-ink-tertiary">
          이미 계정이 있으신가요?{' '}
          <Link to="/login" className="text-brand-primary hover:text-brand-primary-hover font-medium">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
