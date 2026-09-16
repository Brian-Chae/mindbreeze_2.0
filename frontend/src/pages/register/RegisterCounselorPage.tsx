// 상담사 가입 — 기관 초대 안내 + 개인 상담사 신청 (SDD-073)

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../../components/ThemeToggle';
import { OtpInput } from '../../components/auth/OtpInput';
import { requestOtp, verifyOtp } from '../../lib/api/auth';
import { submitIndividualCounselorApplication } from '../../lib/api/signup';
import { ApiError } from '../../lib/api/client';

type Mode = 'select' | 'org' | 'individual';

const inputClass =
  'w-full h-11 px-4 rounded-xl bg-surface-raised border border-border-default text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15 disabled:opacity-60';

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
    } catch {
      setError('인증 코드 발송에 실패했습니다');
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
    } catch {
      setError('인증 코드가 올바르지 않습니다');
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
    if (!privacyAgreed) {
      setError('개인정보 수집·이용에 동의해야 신청할 수 있습니다');
      return;
    }
    setLoading(true);
    try {
      const res = await submitIndividualCounselorApplication({
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
        if (err.status === 409) {
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
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-4 sm:p-8 relative">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[520px] space-y-8">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-3xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
          </Link>
          <p className="text-sm text-ink-tertiary">상담사 가입</p>
          <p className="text-xs text-ink-tertiary">
            <Link to="/register" className="underline hover:text-brand-primary">
              다른 유형으로 가입하기
            </Link>
          </p>
        </div>

        {/* 신청 완료 화면 */}
        {applicationId ? (
          <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 text-center space-y-4">
            <p className="text-lg font-bold text-ink-primary">신청이 접수되었습니다</p>
            <p className="text-sm text-ink-tertiary leading-relaxed">
              검토 후 등록하신 이메일로 이용 안내를 보내드립니다.
              <br />
              승인이 완료되면 비밀번호 설정 메일이 발송됩니다.
            </p>
            <p className="text-xs text-ink-tertiary font-mono">접수 번호: {applicationId}</p>
            <Link
              to="/"
              className="inline-block w-full h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 flex items-center justify-center"
            >
              홈으로 돌아가기
            </Link>
          </div>
        ) : mode === 'select' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setMode('org')}
              className="block w-full text-left bg-surface-raised rounded-2xl border border-border-default p-6 hover:border-brand-primary transition-colors"
            >
              <p className="text-lg font-bold text-ink-primary">기관 소속 상담사</p>
              <p className="text-sm text-ink-tertiary mt-1">
                소속 기관의 초대를 받아 가입해요.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode('individual')}
              className="block w-full text-left bg-surface-raised rounded-2xl border border-border-default p-6 hover:border-brand-primary transition-colors"
            >
              <p className="text-lg font-bold text-ink-primary">개인 상담사</p>
              <p className="text-sm text-ink-tertiary mt-1">
                개인 상담사 이용을 신청하고 승인 후 시작해요.
              </p>
            </button>
          </div>
        ) : mode === 'org' ? (
          <div className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-4">
            <p className="text-ink-primary font-semibold text-center">
              상담사는 기관 담당자의 초대로 가입합니다
            </p>
            <ol className="text-sm text-ink-tertiary leading-relaxed list-decimal pl-5 space-y-1.5">
              <li>소속 기관 담당자에게 초대를 요청해 주세요.</li>
              <li>담당자가 기관 관리 화면에서 이름·이메일로 초대합니다.</li>
              <li>초대 메일의 링크에서 비밀번호를 설정하면 바로 이용할 수 있습니다.</li>
              <li>초대 메일을 받지 못했거나 만료됐다면 담당자에게 재발송을 요청해 주세요.</li>
            </ol>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setMode('select')}
                className="flex-1 h-11 rounded-pill border border-border-default text-ink-secondary font-semibold hover:bg-surface-elevated"
              >
                이전
              </button>
              <Link
                to="/login?role=counselor"
                className="flex-1 h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 flex items-center justify-center"
              >
                로그인으로 이동
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-surface-raised rounded-2xl border border-border-default p-6 sm:p-8 space-y-4"
          >
            <h2 className="text-xl font-bold text-ink-primary text-center">개인 상담사 이용 신청</h2>
            <p className="text-xs text-ink-tertiary text-center leading-relaxed">
              신청 검토 후 승인되면 이메일로 이용 안내(비밀번호 설정)를 보내드립니다.
            </p>

            <div className="space-y-2">
              <label htmlFor="ind-name" className="block text-sm font-medium text-ink-secondary">
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
              <label htmlFor="ind-email" className="block text-sm font-medium text-ink-secondary">
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
                  className="px-4 h-11 rounded-pill bg-brand-primary text-ink-on-brand text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {otpSent ? '발송됨' : '인증 요청'}
                </button>
              </div>
            </div>

            {otpSent && !emailVerifyToken && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-ink-secondary text-center">
                  6자리 인증 코드를 입력해주세요
                </label>
                <OtpInput value={otp} onChange={setOtp} disabled={loading} />
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={loading || otp.length !== 6}
                  className="w-full h-11 rounded-pill bg-brand-primary text-ink-on-brand text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? '확인 중...' : '이메일 인증 완료'}
                </button>
              </div>
            )}

            {emailVerifyToken && (
              <p className="text-xs text-brand-primary text-center font-medium">
                이메일 인증이 완료되었습니다
              </p>
            )}

            <div className="space-y-2">
              <label htmlFor="ind-phone" className="block text-sm font-medium text-ink-secondary">
                전화번호 <span className="font-normal text-ink-tertiary">(선택)</span>
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
              <label htmlFor="ind-display" className="block text-sm font-medium text-ink-secondary">
                활동명/상담소명 <span className="font-normal text-ink-tertiary">(선택)</span>
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
              <label htmlFor="ind-specialties" className="block text-sm font-medium text-ink-secondary">
                전문 분야 <span className="font-normal text-ink-tertiary">(선택)</span>
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

            <label className="flex items-start gap-2 text-sm text-ink-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={privacyAgreed}
                onChange={(e) => setPrivacyAgreed(e.target.checked)}
                disabled={loading}
                className="mt-0.5"
              />
              <span>
                (필수) 개인정보 수집·이용에 동의합니다. 입력한 정보는 신청 검토·연락 목적으로만
                사용되며, 미승인 신청 정보는 접수 후 90일 이내 삭제됩니다.
              </span>
            </label>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setMode('select')}
                disabled={loading}
                className="flex-1 h-11 rounded-pill border border-border-default text-ink-secondary font-semibold hover:bg-surface-elevated"
              >
                이전
              </button>
              <button
                type="submit"
                disabled={loading || !emailVerifyToken}
                className="flex-1 h-11 rounded-pill bg-brand-deep text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '신청 중...' : '개인 상담사 이용 신청'}
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-sm text-ink-tertiary">
          이미 계정이 있으신가요?{' '}
          <Link to="/login?role=counselor" className="text-brand-primary hover:text-brand-primary-hover font-medium">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
