// SDD-208 — 종료 화면의 "리포트 받기" 시트 본문. GuestCompletePanel 에서 분리한 이메일 신청(OTP) 흐름으로 동작은 같다:
// 로그인 회원이 계정 이메일을 쓰면 OTP 없이 신청, 그 외에는 이메일 → 인증 코드 → report-email 신청.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api/client';
import { requestOtp, verifyOtp } from '../../lib/api/auth';
import { requestReportEmail } from '../../lib/api/session';

type FormPhase = 'email' | 'otp' | 'success';

interface ReportEmailRequestPanelProps {
  sessionId: string | null;
  participantId: string | null;
  participantToken: string | null;
  /** 로그인 회원 계정 이메일 — 있으면 입력 생략(사전 채움) */
  accountEmail: string | null;
  isLoggedIn: boolean;
}

function reportEmailErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '이메일 인증이 필요합니다. 인증 코드를 다시 받아 주세요.';
    if (error.status === 403) return '참가자 확인에 실패했거나 인증 이메일이 일치하지 않습니다.';
    if (error.status === 409) {
      return error.message.includes('변경')
        ? '이미 등록된 리포트 수신 이메일은 변경할 수 없습니다.'
        : '완료된 세션에서만 리포트를 요청할 수 있습니다.';
    }
    if (error.status === 422) return '이메일 형식을 확인해 주세요.';
    if (error.message) return error.message;
  }
  return '리포트 신청에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

export function ReportEmailRequestPanel({ sessionId, participantId, participantToken, accountEmail, isLoggedIn }: ReportEmailRequestPanelProps) {
  const [phase, setPhase] = useState<FormPhase>('email');
  const [email, setEmail] = useState(accountEmail ?? '');
  const [otp, setOtp] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('상담사 승인 후 메일로 발송됩니다');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const canRequest = Boolean(sessionId && participantId) && (isLoggedIn || Boolean(participantToken));
  const useAccountEmail = isLoggedIn && Boolean(accountEmail);

  const handleRequestOtp = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setFormError('리포트를 받을 이메일을 입력해 주세요.');
      return;
    }
    setFormError(null);
    setIsSubmitting(true);
    try {
      await requestOtp(trimmed);
      setPhase('otp');
    } catch (err) {
      setFormError(err instanceof ApiError && err.message ? err.message : '인증 코드 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyAndSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!sessionId || !participantId) {
      setFormError('참가 정보가 없습니다. 다시 참여해 주세요.');
      return;
    }
    // 로그인 회원이 본인 계정 이메일로 신청하면 OTP 인증 생략
    const skipOtp = useAccountEmail && email.trim() === accountEmail;
    const code = otp.trim();
    if (!skipOtp && !/^\d{6}$/.test(code)) {
      setFormError('6자리 인증 코드를 입력해 주세요.');
      return;
    }
    setFormError(null);
    setIsSubmitting(true);
    try {
      const token = skipOtp ? null : (await verifyOtp(email.trim(), code)).email_verify_token;
      const reportRes = await requestReportEmail(
        sessionId,
        {
          participant_id: participantId,
          email: email.trim(),
          email_verify_token: token,
          participant_token: isLoggedIn ? null : participantToken,
        },
        { skipAuth: !isLoggedIn },
      );
      // BE 카피 우선, pending_review 는 확정 문구로 통일
      if (reportRes.status === 'pending_review') setSuccessMessage('상담사 승인 후 메일로 발송됩니다');
      else if (reportRes.message) setSuccessMessage(reportRes.message);
      setPhase('success');
    } catch (err) {
      setFormError(reportEmailErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async (): Promise<void> => {
    const trimmed = email.trim();
    if (!trimmed || resendCooldown > 0) return;
    setFormError(null);
    setResendCooldown(30);
    try {
      await requestOtp(trimmed);
    } catch (err) {
      setFormError(err instanceof ApiError && err.message ? err.message : '인증 코드 재발송에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const id = window.setInterval(() => setResendCooldown((c) => (c > 1 ? c - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [resendCooldown]);

  if (!canRequest) {
    return <p className="text-sm text-[color:var(--mb-danger-deep)]">참가 정보가 없어 리포트를 신청할 수 없습니다.</p>;
  }

  if (phase === 'success') {
    return (
      <section className="text-center">
        <h3 className="text-lg font-semibold text-[color:var(--mb-label-70)]">리포트 신청이 완료되었어요.</h3>
        <p className="mt-3 text-base leading-7 text-[color:var(--mb-lavender)]">{successMessage}</p>
        <p className="mt-2 text-sm leading-6 text-[color:var(--mb-fg-muted)]">
          마인드브리즈 AI가 데이터를 검수한 뒤, 상담사 승인 후 입력하신 이메일로 리포트를 보내 드립니다.
        </p>
      </section>
    );
  }

  const errorBox = formError ? (
    <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{formError}</p>
  ) : null;

  if (phase === 'email') {
    return (
      <form className="space-y-3" onSubmit={(e) => void (useAccountEmail ? handleVerifyAndSubmit(e) : handleRequestOtp(e))}>
        <p className="text-sm leading-6 text-[color:var(--mb-fg-muted)]">
          리포트는 데이터 검수 후 입력하신 이메일로 발송되며 영업일 기준 1 ~ 2일 이내 받아보실 수 있습니다.
        </p>
        <label htmlFor="report-email" className="block text-left text-sm font-semibold text-[color:var(--mb-label-70)]">이메일</label>
        <input
          id="report-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={useAccountEmail}
          placeholder="name@example.com"
          autoComplete="email"
          className="min-h-11 w-full rounded-xl border border-[color:var(--mb-border)] bg-white px-4 py-3 text-base text-[color:var(--mb-label-70)] outline-none focus:border-[color:var(--mb-primary)] read-only:bg-[color:var(--mb-bg-10)]"
        />
        {useAccountEmail ? <p className="text-left text-xs text-[color:var(--mb-fg-muted)]">로그인 계정 이메일로 리포트를 받습니다.</p> : null}
        {errorBox}
        <button type="submit" disabled={isSubmitting} className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed disabled:opacity-60">
          {isSubmitting ? (useAccountEmail ? '신청 중...' : '인증 코드 발송 중...') : useAccountEmail ? '리포트 신청' : '인증 코드 받기'}
        </button>
      </form>
    );
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void handleVerifyAndSubmit(e)}>
      <p className="text-sm text-[color:var(--mb-fg-muted)]">
        <span className="font-semibold text-[color:var(--mb-label-70)]">{email}</span>으로 보낸 6자리 코드를 입력해 주세요.
      </p>
      <label htmlFor="report-otp" className="block text-left text-sm font-semibold text-[color:var(--mb-label-70)]">인증 코드</label>
      <input
        id="report-otp"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="000000"
        autoComplete="one-time-code"
        className="min-h-11 w-full rounded-xl border border-[color:var(--mb-border)] bg-white px-4 py-3 text-center font-mono text-2xl tracking-[0.35em] text-[color:var(--mb-label-70)] outline-none focus:border-[color:var(--mb-primary)]"
      />
      {errorBox}
      <button type="submit" disabled={isSubmitting} className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed disabled:opacity-60">
        {isSubmitting ? '신청 중...' : '제출하기'}
      </button>
      <button
        type="button"
        onClick={() => void handleResendOtp()}
        disabled={resendCooldown > 0}
        className="min-h-11 w-full py-2 text-sm font-semibold text-[color:var(--mb-primary)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {resendCooldown > 0 ? `인증 코드 재발송 (${resendCooldown}초)` : '인증 코드 재발송'}
      </button>
      <button
        type="button"
        onClick={() => {
          setPhase('email');
          setOtp('');
          setFormError(null);
        }}
        className="min-h-11 w-full py-2 text-sm font-semibold text-[color:var(--mb-fg-muted)]"
      >
        이메일 다시 입력
      </button>
    </form>
  );
}
