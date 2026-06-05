// 회원가입 페이지: 이메일+OTP → 약관 동의 → 비밀번호+이름 (3단계)
// LoginPage 디자인과 일치하도록 다크 배경 + background3.jpg 적용

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { OtpInput } from '../components/auth/OtpInput';
import { ConsentCheckList, type Consents } from '../components/auth/ConsentCheckList';
import { requestOtp, verifyOtp } from '../lib/api/auth';
import { useAuthStore } from '../stores/authStore';
import { ApiError } from '../lib/api/client';

type Role = 'counselor' | 'client';

// 비밀번호 정책: 영문 + 숫자 + 특수문자, 8자 이상
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1 as const, label: '이메일 인증' },
    { n: 2 as const, label: '약관 동의' },
    { n: 3 as const, label: '계정 정보' },
  ];
  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      {steps.map((s, idx) => (
        <div key={s.n} className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
              current >= s.n
                ? 'bg-[#5F0080] text-white'
                : 'bg-white/15 text-white/40'
            }`}
          >
            {s.n}
          </div>
          <span
            className={`text-[13px] ${
              current >= s.n ? 'text-white font-medium' : 'text-white/40'
            }`}
          >
            {s.label}
          </span>
          {idx < steps.length - 1 && <div className="w-8 h-px bg-white/15" />}
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

  const inputClass =
    'h-[52px] w-[280px] rounded-full bg-white border border-[#DDDEE7] px-5 text-[15px] text-[#1F1F1F] placeholder:text-[#9A9BA8] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-50';
  const btnClass =
    'h-[52px] w-[280px] rounded-full bg-[#5F0080] hover:bg-[#4B0066] active:bg-[#3F0055] disabled:opacity-60 text-white font-semibold text-[15px] transition-colors';

  return (
    <div className="relative min-h-screen overflow-hidden font-sans">
      {/* Background — LoginPage와 동일 */}
      <img
        src="/mb-design/assets/images/background3.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/35" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-[18px] px-6">
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2.5 group" aria-label="랜딩 페이지로 이동">
            <img
              src="/mb-design/assets/logo_symbol_dark.svg"
              width={32}
              height={14}
              alt=""
              className="brightness-0 invert"
            />
            <span className="font-extrabold text-[17px] text-white tracking-tight opacity-90 group-hover:opacity-100 transition-opacity">
              mind&nbsp;breeze
            </span>
          </Link>
        </div>

        {/* Logo */}
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
        <div className="text-[15px] text-white/85 mb-4">
          {role === 'counselor' ? '상담사 회원가입' : '내담자 회원가입'}
        </div>

        {/* Card */}
        <div className="bg-white rounded-[22px] p-6 sm:p-8 w-full max-w-[400px] shadow-lg">
          <StepIndicator current={step} />

          <h2 className="text-xl font-bold text-[#1F1F1F] text-center mb-6">
            {step === 1 && '이메일 인증'}
            {step === 2 && '약관 동의'}
            {step === 3 && '계정 정보 입력'}
          </h2>

          {/* Step 1: 이메일 + OTP */}
          {step === 1 && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex gap-2 w-full max-w-[280px]">
                <input
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
                  className="px-4 h-[52px] rounded-full bg-[#5F0080] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  {otpSent ? '발송됨' : '인증 요청'}
                </button>
              </div>

              {otpSent && (
                <div className="flex flex-col items-center gap-3">
                  <label className="text-sm text-[#6F6F6F]">
                    6자리 인증 코드를 입력해주세요
                  </label>
                  <OtpInput value={otp} onChange={setOtp} disabled={loading} />
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    disabled={loading}
                    className="text-xs text-[#6F6F6F] hover:text-[#5F0080]"
                  >
                    인증 코드 재발송
                  </button>
                </div>
              )}

              {error && (
                <p className="text-[13px] text-white bg-red-500/80 rounded-full px-4 py-1.5" role="alert">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={handleVerifyOtp}
                disabled={loading || !otpSent || otp.length !== 6}
                className={btnClass}
              >
                {loading ? '확인 중...' : '다음'}
              </button>
            </div>
          )}

          {/* Step 2: 약관 동의 */}
          {step === 2 && (
            <div className="flex flex-col items-center gap-4">
              <ConsentCheckList consents={consents} onChange={setConsents} />
              {error && (
                <p className="text-[13px] text-white bg-red-500/80 rounded-full px-4 py-1.5" role="alert">
                  {error}
                </p>
              )}
              <div className="flex gap-3 w-full max-w-[280px]">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 h-[52px] rounded-full border border-[#DDDEE7] text-[#6F6F6F] font-semibold hover:bg-[#F5EDFC]"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={handleConsentNext}
                  className={`flex-1 ${btnClass} w-auto`}
                >
                  다음
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 비밀번호 + 이름 */}
          {step === 3 && (
            <form onSubmit={handleRegister} className="flex flex-col items-center gap-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                disabled={loading}
                autoComplete="name"
                className={inputClass}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 (영문+숫자+특수문자 8자 이상)"
                disabled={loading}
                autoComplete="new-password"
                className={inputClass}
              />
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호 확인"
                disabled={loading}
                autoComplete="new-password"
                className={inputClass}
              />

              {error && (
                <p className="text-[13px] text-white bg-red-500/80 rounded-full px-4 py-1.5" role="alert">
                  {error}
                </p>
              )}

              <div className="flex gap-3 w-full max-w-[280px]">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={loading}
                  className="flex-1 h-[52px] rounded-full border border-[#DDDEE7] text-[#6F6F6F] font-semibold hover:bg-[#F5EDFC]"
                >
                  이전
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className={`flex-1 ${btnClass} w-auto`}
                >
                  {loading ? '가입 중...' : '가입 완료'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-[13px] text-white/85">
          이미 계정이 있으신가요?{' '}
          <Link to="/login" className="text-white font-semibold hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
