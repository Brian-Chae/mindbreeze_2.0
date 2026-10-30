// 상담사 가입 — 기관 초대 안내 + 개인 상담사 신청 (SDD-073)

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from '../../components/auth/AuthShell';
import { BirthDateInput } from '../../components/auth/BirthDateInput';
import { OtpInput } from '../../components/auth/OtpInput';
import { apiErrorCode, requestOtp, verifyOtp } from '../../lib/api/auth';
import { BIRTH_DATE_MESSAGES, checkBirthDate } from '../../lib/auth/age';
import { submitIndividualCounselorApplication } from '../../lib/api/signup';
import { ApiError } from '../../lib/api/client';
import { PrivacyPolicyLink } from '../../components/legal/PrivacyPolicyLink';

type Mode = 'select' | 'org' | 'individual';

/**
 * OTP 요청·검증 실패 문구 — 서버 사유(err.message)를 우선 사용하고,
 * 사유가 없거나 일반 폴백일 때만 상태코드별 안내로 대체한다.
 */
function otpErrorMessage(err: unknown, fallback: string): string {
  const status = err instanceof ApiError ? err.status : null;
  const serverMessage = err instanceof Error && err.message ? err.message : '';
  const isGeneric = status !== null && serverMessage === `API 요청 실패 (${status})`;
  if (serverMessage && !isGeneric) return serverMessage;
  if (status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (status === 410) return '인증 코드가 만료되었습니다. 코드를 다시 요청해 주세요.';
  return fallback;
}

const inputClass =
  'w-full h-11 px-4 rounded-xl bg-white border border-[#D4D4D4] text-sm text-[#1F1F1F] placeholder:text-[#6F6F6F] outline-none focus:border-[#5F0080] focus:ring-2 focus:ring-[#5F0080]/15 disabled:opacity-60';

export default function RegisterCounselorPage() {
  const [mode, setMode] = useState<Mode>('select');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 개인 상담사 신청 폼
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [emailVerifyToken, setEmailVerifyToken] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  // SDD-220: 신규 계정이 만들어지므로 만 14세 확인용 생년월일을 받는다(서버가 최종 검증).
  const [birthDate, setBirthDate] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);

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
      setError(otpErrorMessage(err, '인증 코드 발송에 실패했습니다'));
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
    } catch (err) {
      setError(otpErrorMessage(err, '인증 코드가 올바르지 않습니다'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('이름을 입력해주세요');
      return;
    }
    if (!emailVerifyToken) {
      setError('이메일 인증을 완료해주세요');
      return;
    }
    const birthCheck = checkBirthDate(birthDate);
    if (birthCheck !== 'ok') {
      setError(BIRTH_DATE_MESSAGES[birthCheck]);
      return;
    }
    if (!privacyAgreed) {
      setError('개인정보 수집·이용에 동의해야 신청할 수 있습니다');
      return;
    }
    setLoading(true);
    try {
      const res = await submitIndividualCounselorApplication({
        birth_date: birthDate,
        name: name.trim(),
        email,
        email_verify_token: emailVerifyToken,
        phone: phone.trim() || undefined,
        display_name: displayName.trim() || undefined,
        specialties: specialties.trim() || undefined,
        consents: { privacy: true },
      });
      setApplicationId(res.application_id);
    } catch (err) {
      if (err instanceof ApiError) {
        if (apiErrorCode(err) === 'ACCOUNT_DELETION_PENDING') {
          setError('탈퇴 처리 중인 이메일이에요. 영구 삭제가 끝난 뒤 다시 신청할 수 있어요');
        } else if (err.status === 409) {
          setError('이미 등록되었거나 접수된 이메일입니다');
        } else {
          setError(err.message || '신청에 실패했습니다');
        }
      } else {
        setError('네트워크 오류가 발생했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="코치 가입" maxWidthClass="max-w-[520px]">
      <div className="space-y-5">

        {/* 신청 완료 화면 */}
        {applicationId ? (
          <div className="bg-white rounded-3xl p-6 shadow-xl sm:p-8 text-center space-y-4">
            <p className="text-lg font-bold text-[#1F1F1F]">신청이 접수되었습니다</p>
            <p className="text-sm text-[#6F6F6F] leading-relaxed">
              검토 후 등록하신 이메일로 이용 안내를 보내드립니다.
              <br />
              승인이 완료되면 비밀번호 설정 메일이 발송됩니다.
            </p>
            <p className="text-xs text-[#6F6F6F] font-mono">접수 번호: {applicationId}</p>
            <Link
              to="/"
              className="inline-block w-full h-[52px] rounded-full bg-[#5F0080] text-white font-semibold hover:opacity-90 flex items-center justify-center"
            >
              홈으로 돌아가기
            </Link>
          </div>
        ) : mode === 'select' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setMode('org')}
              className="block w-full text-left bg-white rounded-3xl border-2 border-transparent p-6 shadow-xl hover:border-[#5F0080] transition-colors"
            >
              <p className="text-lg font-bold text-[#1F1F1F]">기관 소속 코치</p>
              <p className="text-sm text-[#6F6F6F] mt-1">
                소속 기관의 초대를 받아 가입해요.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode('individual')}
              className="block w-full text-left bg-white rounded-3xl border-2 border-transparent p-6 shadow-xl hover:border-[#5F0080] transition-colors"
            >
              <p className="text-lg font-bold text-[#1F1F1F]">개인 코치</p>
              <p className="text-sm text-[#6F6F6F] mt-1">
                개인 코치 이용을 신청하고 승인 후 시작해요.
              </p>
            </button>
          </div>
        ) : mode === 'org' ? (
          <div className="bg-white rounded-3xl p-6 shadow-xl sm:p-8 space-y-4">
            <p className="text-[#1F1F1F] font-semibold text-center">
              코치는 기관 담당자의 초대로 가입합니다
            </p>
            <ol className="text-sm text-[#6F6F6F] leading-relaxed list-decimal pl-5 space-y-1.5">
              <li>소속 기관 담당자에게 초대를 요청해 주세요.</li>
              <li>담당자가 기관 관리 화면에서 이름·이메일로 초대합니다.</li>
              <li>초대 메일의 링크에서 비밀번호를 설정하면 바로 이용할 수 있습니다.</li>
              <li>초대 메일을 받지 못했거나 만료됐다면 담당자에게 재발송을 요청해 주세요.</li>
            </ol>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setMode('select')}
                className="flex-1 h-[52px] rounded-full border border-[#D4D4D4] text-[#4A4A4A] font-semibold hover:bg-[#F3E9F8]"
              >
                이전
              </button>
              <Link
                to="/login?role=counselor"
                className="flex-1 h-[52px] rounded-full bg-[#5F0080] text-white font-semibold hover:opacity-90 flex items-center justify-center"
              >
                로그인으로 이동
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-3xl p-6 shadow-xl sm:p-8 space-y-4"
          >
            <h2 className="text-xl font-bold text-[#1F1F1F] text-center">개인 코치 이용 신청</h2>
            <p className="text-xs text-[#6F6F6F] text-center leading-relaxed">
              신청 검토 후 승인되면 이메일로 이용 안내(비밀번호 설정)를 보내드립니다.
            </p>

            <div className="space-y-2">
              <label htmlFor="ind-name" className="block text-sm font-medium text-[#4A4A4A]">
                이름
              </label>
              <input
                id="ind-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="ind-email" className="block text-sm font-medium text-[#4A4A4A]">
                이메일
              </label>
              <div className="flex gap-2">
                <input
                  id="ind-email"
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

            {otpSent && !emailVerifyToken && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-[#4A4A4A] text-center">
                  6자리 인증 코드를 입력해주세요
                </label>
                <OtpInput value={otp} onChange={setOtp} disabled={loading} />
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={loading || otp.length !== 6}
                  className="w-full h-[52px] rounded-full bg-[#5F0080] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? '확인 중...' : '이메일 인증 완료'}
                </button>
              </div>
            )}

            {emailVerifyToken && (
              <p className="text-xs text-[#5F0080] text-center font-medium">
                이메일 인증이 완료되었습니다
              </p>
            )}

            <div className="space-y-2">
              <BirthDateInput
                id="ind-birth"
                value={birthDate}
                onChange={(iso) => setBirthDate(iso)}
                disabled={loading}
                labelClassName="block text-sm font-medium text-[#4A4A4A]"
                inputClassName={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="ind-phone" className="block text-sm font-medium text-[#4A4A4A]">
                전화번호 <span className="font-normal text-[#6F6F6F]">(선택)</span>
              </label>
              <input
                id="ind-phone"
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
              <label htmlFor="ind-display" className="block text-sm font-medium text-[#4A4A4A]">
                활동명/상담소명 <span className="font-normal text-[#6F6F6F]">(선택)</span>
              </label>
              <input
                id="ind-display"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={name.trim() ? `${name.trim()} 개인 상담실` : '예: 마음숲 상담실'}
                maxLength={200}
                disabled={loading}
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="ind-specialties" className="block text-sm font-medium text-[#4A4A4A]">
                전문 분야 <span className="font-normal text-[#6F6F6F]">(선택)</span>
              </label>
              <input
                id="ind-specialties"
                type="text"
                value={specialties}
                onChange={(e) => setSpecialties(e.target.value)}
                placeholder="예: 불안, 우울, 부부상담"
                maxLength={300}
                disabled={loading}
                className={inputClass}
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-[#4A4A4A] cursor-pointer">
              <input
                type="checkbox"
                checked={privacyAgreed}
                onChange={(e) => setPrivacyAgreed(e.target.checked)}
                disabled={loading}
                className="mt-0.5"
              />
              <span>
                (필수) 개인정보 수집·이용에 동의합니다. 입력한 정보는 신청 검토·연락 목적으로만
                사용되며, 미승인 신청 정보는 접수 후 90일 이내 삭제됩니다.{' '}
                <PrivacyPolicyLink>개인정보 처리방침 보기</PrivacyPolicyLink>
              </span>
            </label>

            {error && <p role="alert" className="text-red-500 text-sm text-center">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setMode('select')}
                disabled={loading}
                className="flex-1 h-[52px] rounded-full border border-[#D4D4D4] text-[#4A4A4A] font-semibold hover:bg-[#F3E9F8]"
              >
                이전
              </button>
              <button
                type="submit"
                disabled={loading || !emailVerifyToken}
                className="flex-1 h-[52px] rounded-full bg-[#5F0080] text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '신청 중...' : '개인 코치 이용 신청'}
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-sm text-white/90">
          이미 계정이 있으신가요?{' '}
          <Link to="/login?role=counselor" className="font-semibold text-white underline">
            로그인
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
