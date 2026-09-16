// 회원(내담자) 가입 — 이메일 OTP → 약관 동의 → 개인정보 + 상담사 코드 (SDD-073)

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ThemeToggle from '../../components/ThemeToggle';
import { OtpInput } from '../../components/auth/OtpInput';
import { ConsentCheckList, type Consents } from '../../components/auth/ConsentCheckList';
import { requestOtp, verifyOtp } from '../../lib/api/auth';
import { checkCounselorCode, type CounselorCodeCheckResponse } from '../../lib/api/signup';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';

// 비밀번호 정책: 영문 + 숫자 + 특수문자, 8자 이상
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const GENDER_OPTIONS = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
  { value: 'other', label: '기타' },
] as const;

type Gender = (typeof GENDER_OPTIONS)[number]['value'];

interface StepIndicatorProps {
  current: 1 | 2 | 3;
}

function StepIndicator({ current }: StepIndicatorProps) {
  const steps = [
    { n: 1 as const, label: '이메일 인증' },
    { n: 2 as const, label: '약관 동의' },
    { n: 3 as const, label: '정보 입력' },
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

const inputClass =
  'w-full h-11 px-4 rounded-xl bg-surface-raised border border-border-default text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-60';

export default function RegisterClientPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const inviteToken = params.get('token') ?? '';
  const isInviteRegistration = inviteToken.length > 0;

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
  const [gender, setGender] = useState<Gender | ''>('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [counselorCode, setCounselorCode] = useState('');
  const [codeChecking, setCodeChecking] = useState(false);
  const [matchedCounselor, setMatchedCounselor] = useState<CounselorCodeCheckResponse | null>(null);

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

  const handleCheckCode = async (): Promise<void> => {
    setError(null);
    setMatchedCounselor(null);
    const code = counselorCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError('상담사 코드는 6자리입니다');
      return;
    }
    if (!emailVerifyToken) {
      setError('이메일 인증이 필요합니다');
      return;
    }
    setCodeChecking(true);
    try {
      const res = await checkCounselorCode(code, emailVerifyToken);
      setMatchedCounselor(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || '상담사 코드를 확인할 수 없습니다');
      } else {
        setError('네트워크 오류가 발생했습니다');
      }
    } finally {
      setCodeChecking(false);
    }
  };

  const handleRegister = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('이름을 입력해주세요');
      return;
    }
    if (!gender) {
      setError('성별을 선택해주세요');
      return;
    }
    if (!birthDate) {
      setError('생년월일을 입력해주세요');
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
    if (!isInviteRegistration && !matchedCounselor) {
      setError('상담사 코드를 확인해주세요. 코드가 없다면 초대한 상담사에게 요청해 주세요.');
      return;
    }

    setLoading(true);
    try {
      await registerClient({
        email,
        password,
        name: name.trim(),
        email_verify_token: emailVerifyToken,
        consents,
        invite_token: inviteToken || undefined,
        gender,
        birth_date: birthDate,
        phone: phone.trim() || undefined,
        counselor_code: isInviteRegistration ? undefined : counselorCode.trim().toUpperCase(),
      });
      // 초대 가입: 온보딩 Step 4에서 코드 입력 없이 연결 확인 화면으로 진입.
      // 코드 가입: ?code= 로 Step 4 자동 매칭(재입력 없이 연결 확인)을 유도한다.
      navigate(
        isInviteRegistration
          ? '/onboarding/client?source=invite'
          : `/onboarding/client?code=${counselorCode.trim().toUpperCase()}`,
      );
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
            {isInviteRegistration ? '초대받은 회원 가입' : '회원 가입'}
          </p>
          <p className="text-xs text-ink-tertiary">
            <Link to="/register" className="underline hover:text-brand-primary">
              다른 유형으로 가입하기
            </Link>
          </p>
        </div>

        {isInviteRegistration && (
          <div className="rounded-2xl border border-brand-primary/30 bg-brand-primary/5 px-5 py-4 text-center space-y-1">
            <p className="text-sm font-semibold text-ink-primary">
              상담사님의 초대로 가입 중입니다
            </p>
            <p className="text-xs text-ink-tertiary">
              가입 완료 시 상담사와 자동으로 연결됩니다
            </p>
          </div>
        )}

        <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-6">
          <StepIndicator current={step} />

          <h2 className="text-2xl font-bold text-ink-primary text-center">
            {step === 1 && '이메일 인증'}
            {step === 2 && '약관 동의'}
            {step === 3 && '정보 입력'}
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
                    className={`flex-1 ${inputClass}`}
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

          {/* Step 3: 개인정보 + 비밀번호 + 상담사 코드 */}
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
                  className={inputClass}
                />
              </div>

              <div className="space-y-2">
                <span className="block text-sm font-medium text-ink-secondary">성별</span>
                <div className="flex gap-2">
                  {GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setGender(opt.value)}
                      disabled={loading}
                      className={`flex-1 h-11 rounded-xl border text-sm font-medium transition-colors ${
                        gender === opt.value
                          ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                          : 'border-border-default text-ink-secondary hover:bg-surface-elevated'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="birthDate" className="block text-sm font-medium text-ink-secondary">
                  생년월일
                </label>
                <input
                  id="birthDate"
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  disabled={loading}
                  className={inputClass}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="phone" className="block text-sm font-medium text-ink-secondary">
                  전화번호 <span className="font-normal text-ink-tertiary">(선택)</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  maxLength={20}
                  disabled={loading}
                  className={inputClass}
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
                  className={inputClass}
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
                  className={inputClass}
                />
              </div>

              {!isInviteRegistration && (
                <div className="space-y-2">
                  <label htmlFor="counselorCode" className="block text-sm font-medium text-ink-secondary">
                    초대 상담사 코드
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="counselorCode"
                      type="text"
                      value={counselorCode}
                      onChange={(e) => {
                        setCounselorCode(e.target.value.toUpperCase());
                        setMatchedCounselor(null);
                      }}
                      placeholder="6자리 코드"
                      maxLength={6}
                      disabled={loading}
                      className={`flex-1 font-mono tracking-widest ${inputClass}`}
                    />
                    <button
                      type="button"
                      onClick={handleCheckCode}
                      disabled={loading || codeChecking || counselorCode.trim().length !== 6}
                      className="px-4 h-11 rounded-pill bg-brand-primary text-ink-on-brand text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                    >
                      {codeChecking ? '확인 중...' : '코드 확인'}
                    </button>
                  </div>
                  {matchedCounselor ? (
                    <div className="rounded-xl border border-brand-primary/30 bg-brand-primary/5 px-4 py-3 text-sm">
                      <p className="font-semibold text-ink-primary">
                        {matchedCounselor.counselor_name} 상담사와 연결하여 가입합니다
                      </p>
                      {matchedCounselor.organization_name && (
                        <p className="text-xs text-ink-tertiary mt-0.5">
                          {matchedCounselor.organization_name}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-ink-tertiary">
                      코드가 없다면 초대한 상담사에게 코드를 요청해 주세요.
                    </p>
                  )}
                </div>
              )}

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
          <Link to="/login?role=client" className="text-brand-primary hover:text-brand-primary-hover font-medium">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
