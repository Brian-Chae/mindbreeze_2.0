// 회원(내담자) 가입 — 이메일 OTP → 약관 동의 → 개인정보 + 상담사 코드 (SDD-073)

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from '../../components/auth/AuthShell';
import { OtpInput } from '../../components/auth/OtpInput';
import { useCooldown } from '../../hooks/useCooldown';
import { BirthDateInput } from '../../components/auth/BirthDateInput';
import { ConsentCheckList, type Consents } from '../../components/auth/ConsentCheckList';
import { BIRTH_DATE_MESSAGES, checkBirthDate } from '../../lib/auth/age';
import { hasRequiredConsents, toConsentPayload } from '../../lib/auth/consents';
import { resolvePostLoginPath } from '../../lib/auth-routing';
import { apiErrorCode } from '../../lib/api/auth';
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
  current: 1 | 2;
}

function StepIndicator({ current }: StepIndicatorProps) {
  const steps = [
    { n: 1 as const, label: '이메일 인증' },
    { n: 2 as const, label: '정보 입력·동의' },
  ];
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((s, idx) => (
        <div key={s.n} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
              current >= s.n
                ? 'bg-[#5F0080] text-white'
                : 'bg-[#EDEDED] text-[#6F6F6F]'
            }`}
          >
            {s.n}
          </div>
          <span
            className={`text-xs ${
              current >= s.n ? 'text-[#1F1F1F] font-medium' : 'text-[#6F6F6F]'
            }`}
          >
            {s.label}
          </span>
          {idx < steps.length - 1 && <div className="w-6 h-px bg-[#D4D4D4]" />}
        </div>
      ))}
    </div>
  );
}

const inputClass =
  'w-full h-11 px-4 rounded-xl bg-white border border-[#D4D4D4] text-sm text-[#1F1F1F] placeholder:text-[#6F6F6F] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-60';

export default function RegisterClientPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const inviteToken = params.get('token') ?? '';
  const isInviteRegistration = inviteToken.length > 0;

  const registerClient = useAuthStore((s) => s.registerClient);

  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [emailVerifyToken, setEmailVerifyToken] = useState<string | null>(null);
  const cooldown = useCooldown();

  // Step 2
  const [consents, setConsents] = useState<Consents>({ tos: false, privacy: false, sensitive: false });

  // Step 3
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [birthDate, setBirthDate] = useState('');
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
      setOtp('');
      cooldown.start();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('이미 등록된 이메일입니다');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('잠시 후 다시 요청해 주세요 (60초 간격)');
        cooldown.start();
      } else {
        setError('인증 코드 발송에 실패했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  // 이메일 오입력 시 입력 단계로 되돌아간다(코드·인증 토큰 초기화)
  const handleChangeEmail = (): void => {
    setError(null);
    setOtpSent(false);
    setOtp('');
    setEmailVerifyToken(null);
    cooldown.reset();
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

  const handleCheckCode = async (): Promise<void> => {
    setError(null);
    setMatchedCounselor(null);
    const code = counselorCode.trim();
    if (code.length !== 6) {
      setError('코치 코드는 6자리 숫자입니다');
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
        setError(err.message || '코치 코드를 확인할 수 없습니다');
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

    if (!hasRequiredConsents(consents)) {
      setError('필수 약관에 모두 동의해야 가입할 수 있습니다');
      return;
    }
    if (!name.trim()) {
      setError('이름을 입력해주세요');
      return;
    }
    if (!gender) {
      setError('성별을 선택해주세요');
      return;
    }
    // 서버가 최종 판정하지만(Asia/Seoul 기준) 입력 단계에서 먼저 안내한다.
    const birthCheck = checkBirthDate(birthDate);
    if (birthCheck !== 'ok') {
      setError(BIRTH_DATE_MESSAGES[birthCheck]);
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
      setError('코치 코드를 확인해주세요. 코드가 없다면 초대한 코치에게 요청해 주세요.');
      return;
    }

    setLoading(true);
    try {
      const user = await registerClient({
        email,
        password,
        name: name.trim(),
        email_verify_token: emailVerifyToken,
        consents: toConsentPayload(consents),
        invite_token: inviteToken || undefined,
        gender,
        birth_date: birthDate,
        counselor_code: isInviteRegistration ? undefined : counselorCode.trim(),
      });
      navigate(resolvePostLoginPath(user));
    } catch (err) {
      if (err instanceof ApiError) {
        if (apiErrorCode(err) === 'ACCOUNT_DELETION_PENDING') {
          // F2: 탈퇴 처리 중인 이메일은 영구 삭제가 끝날 때까지 가입할 수 없다.
          setError('탈퇴 처리 중인 이메일이에요. 영구 삭제가 끝난 뒤 다시 가입할 수 있어요');
        } else if (err.status === 409) {
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
    <AuthShell variant="member" title={isInviteRegistration ? '초대받은 회원 가입' : '회원 가입'} maxWidthClass="max-w-[480px]">
      <div className="space-y-5">

        {isInviteRegistration && (
          <div className="rounded-3xl bg-white px-5 py-4 shadow-xl text-center space-y-1">
            <p className="text-sm font-semibold text-[#1F1F1F]">
              코치님의 초대로 가입 중입니다
            </p>
            <p className="text-xs text-[#6F6F6F]">
              가입 완료 시 코치와 자동으로 연결됩니다
            </p>
          </div>
        )}

        <div className="bg-white rounded-3xl p-6 shadow-xl sm:p-8 space-y-6">
          <StepIndicator current={step} />

          <h2 className="text-2xl font-bold text-[#1F1F1F] text-center">
            {step === 1 && '이메일 인증'}
            {step === 2 && '가입 정보를 확인해요'}
          </h2>

          {/* Step 1: 이메일 + OTP */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-[#4A4A4A]">
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
                    className="px-4 h-[52px] rounded-full bg-[#5F0080] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {otpSent ? '발송됨' : '인증 요청'}
                  </button>
                </div>
              </div>

              {otpSent && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[#4A4A4A] text-center">
                    6자리 인증 코드를 입력해주세요
                  </label>
                  <OtpInput value={otp} onChange={setOtp} disabled={loading} />
                  <button
                    type="button"
                    onClick={handleRequestOtp}
                    disabled={loading || cooldown.remaining > 0}
                    className="w-full text-xs text-[#6F6F6F] hover:text-[#4B0066]"
                  >
                    {cooldown.remaining > 0 ? `인증번호 다시 받기 (${cooldown.remaining}초)` : '인증번호 다시 받기'}
                  </button>
                  <button
                    type="button"
                    onClick={handleChangeEmail}
                    disabled={loading}
                    className="w-full text-xs text-[#6F6F6F] underline hover:text-[#4B0066]"
                  >
                    이메일 변경
                  </button>
                </div>
              )}

              {error && <p role="alert" className="text-red-500 text-sm text-center">{error}</p>}

              <button
                type="button"
                onClick={handleVerifyOtp}
                disabled={loading || !otpSent || otp.length !== 6}
                className="w-full h-[52px] rounded-full bg-[#5F0080] text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '확인 중...' : '다음'}
              </button>
            </div>
          )}

          {/* Step 3: 개인정보 + 비밀번호 + 상담사 코드 */}
          {step === 2 && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="block text-sm font-medium text-[#4A4A4A]">
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
                <span className="block text-sm font-medium text-[#4A4A4A]">성별</span>
                <div className="flex gap-2">
                  {GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setGender(opt.value)}
                      disabled={loading}
                      className={`flex-1 h-11 rounded-xl border text-sm font-medium transition-colors ${
                        gender === opt.value
                          ? 'border-[#5F0080] bg-[#5F0080]/10 text-[#5F0080]'
                          : 'border-[#D4D4D4] text-[#4A4A4A] hover:bg-[#F3E9F8]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <BirthDateInput
                  id="birthDate"
                  value={birthDate}
                  onChange={(iso) => setBirthDate(iso)}
                  disabled={loading}
                  labelClassName="block text-sm font-medium text-[#4A4A4A]"
                  inputClassName={inputClass}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-[#4A4A4A]">
                  비밀번호
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="영문+숫자+특수문자 8자 이상"
                  disabled={loading}
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="passwordConfirm" className="block text-sm font-medium text-[#4A4A4A]">
                  비밀번호 확인
                </label>
                <input
                  id="passwordConfirm"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>

              {!isInviteRegistration && (
                <div className="space-y-2">
                  <label htmlFor="counselorCode" className="block text-sm font-medium text-[#4A4A4A]">
                    초대 코치 코드
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="counselorCode"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={counselorCode}
                      onChange={(e) => {
                        setCounselorCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                        setMatchedCounselor(null);
                      }}
                      placeholder="6자리 숫자"
                      maxLength={6}
                      disabled={loading}
                      className={`flex-1 font-mono tracking-widest ${inputClass}`}
                    />
                    <button
                      type="button"
                      onClick={handleCheckCode}
                      disabled={loading || codeChecking || counselorCode.trim().length !== 6}
                      className="px-4 h-[52px] rounded-full bg-[#5F0080] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                    >
                      {codeChecking ? '확인 중...' : '코드 확인'}
                    </button>
                  </div>
                  {matchedCounselor ? (
                    <div className="rounded-xl border border-[#5F0080]/30 bg-[#5F0080]/5 px-4 py-3 text-sm">
                      <p className="font-semibold text-[#1F1F1F]">
                        {matchedCounselor.counselor_name} 코치와 연결하여 가입합니다
                      </p>
                      {matchedCounselor.organization_name && (
                        <p className="text-xs text-[#6F6F6F] mt-0.5">
                          {matchedCounselor.organization_name}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#6F6F6F]">
                      코드가 없다면 초대한 코치에게 코드를 요청해 주세요. (6자리 숫자)
                    </p>
                  )}
                </div>
              )}

              {error && <p role="alert" className="text-red-500 text-sm text-center">{error}</p>}

              <ConsentCheckList consents={consents} onChange={setConsents} />

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={loading}
                  className="flex-1 h-[52px] rounded-full border border-[#D4D4D4] text-[#4A4A4A] font-semibold hover:bg-[#F3E9F8]"
                >
                  이전
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim() || !gender || checkBirthDate(birthDate) !== 'ok' || !hasRequiredConsents(consents)}
                  className="flex-1 h-[52px] rounded-full bg-[#5F0080] text-white font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? '가입 중...' : '동의하고 가입하기'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-white/90">
          이미 계정이 있으신가요?{' '}
          <Link to="/login?role=client" className="font-semibold text-white underline">
            로그인
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
