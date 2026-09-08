// 완료 화면 — 1.0 GuestCompleteScreen 패리티 + 2.0 리포트 메일(OTP)
// 배경 #F5EDFC, 리포트 마퀴, 이메일 OTP → report-email

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api/client';
import { requestOtp, verifyOtp } from '../../lib/api/auth';
import { requestReportEmail } from '../../lib/api/session';
import { InfiniteScrollingImages } from './InfiniteScrollingImages';

type FormPhase = 'intro' | 'email' | 'otp' | 'success';

interface GuestCompletePanelProps {
  sessionId: string | null;
  sessionTitle: string | null;
  participantId: string | null;
  participantToken: string | null;
  /** 로그인 회원 계정 이메일 — 있으면 입력 생략(사전 채움) */
  accountEmail: string | null;
  isLoggedIn: boolean;
  error: string | null;
  onReset: () => void;
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

export function GuestCompletePanel({
  sessionId,
  sessionTitle,
  participantId,
  participantToken,
  accountEmail,
  isLoggedIn,
  error,
  onReset,
}: GuestCompletePanelProps) {
  const [phase, setPhase] = useState<FormPhase>('intro');
  const [email, setEmail] = useState(accountEmail ?? '');
  const [otp, setOtp] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState(
    '상담사 승인 후 메일로 발송됩니다',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canRequest =
    Boolean(sessionId && participantId) &&
    (isLoggedIn || Boolean(participantToken));

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
      setFormError(
        err instanceof ApiError && err.message
          ? err.message
          : '인증 코드 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      );
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
    const code = otp.trim();
    if (!/^\d{6}$/.test(code)) {
      setFormError('6자리 인증 코드를 입력해 주세요.');
      return;
    }
    setFormError(null);
    setIsSubmitting(true);
    try {
      const verifyRes = await verifyOtp(email.trim(), code);
      const token = verifyRes.email_verify_token;

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

      // BE 카피 우선, pending_review는 1.0/Brian 확정 문구로 통일
      if (reportRes.status === 'pending_review') {
        setSuccessMessage('상담사 승인 후 메일로 발송됩니다');
      } else if (reportRes.message) {
        setSuccessMessage(reportRes.message);
      }
      setPhase('success');
    } catch (err) {
      setFormError(reportEmailErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[color:var(--mb-purple-cream)] px-5 py-12 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={onReset}
            className="rounded-xl bg-white/60 px-4 py-2 text-sm font-medium text-[color:var(--mb-label-70)]"
          >
            종료
          </button>
          <p className="truncate px-3 text-sm font-medium text-[color:var(--mb-fg-muted)]">
            {sessionTitle ?? '클래스'}
          </p>
          <div className="w-[4.5rem]" aria-hidden="true" />
        </header>

        {phase === 'success' ? (
          <section className="mt-16 text-center">
            <h1 className="text-[clamp(22px,4vw,28px)] font-semibold text-[color:var(--mb-label-70)]">
              리포트 신청이 완료되었어요.
            </h1>
            <p className="mt-4 text-base leading-7 text-[color:var(--mb-lavender)]">
              {successMessage}
            </p>
            <p className="mt-3 text-sm leading-6 text-[color:var(--mb-fg-muted)]">
              마인드브리즈 AI가 데이터를 검수한 뒤, 상담사 승인 후 입력하신 이메일로
              리포트를 보내 드립니다.
            </p>
            <Link
              to="/"
              className="mb-btn mt-10 inline-flex h-[52px] w-full max-w-md items-center justify-center rounded-xl px-6 text-base"
            >
              홈으로
            </Link>
            <button
              type="button"
              onClick={onReset}
              className="mt-4 w-full max-w-md py-2 text-sm font-semibold text-[color:var(--mb-fg-muted)]"
            >
              다른 클래스 코드 입력하기
            </button>
          </section>
        ) : (
          <>
            <section className="mt-10 text-center">
              <h1 className="text-[clamp(20px,3.5vw,24px)] font-semibold leading-snug text-[color:var(--mb-label-70)]">
                수업이 종료되었습니다. 리포트를 받아보시려면 이메일을 입력해주세요.
              </h1>
              <p className="mt-3 text-[clamp(14px,2vw,16px)] leading-6 text-[color:var(--mb-lavender)]">
                리포트는 데이터 검수 후 입력하신 이메일로 발송되며 영업일 기준 1 ~ 2일 이내
                받아보실 수 있습니다.
              </p>
            </section>

            <div className="mt-8">
              <InfiniteScrollingImages />
            </div>

            {phase === 'intro' && (
              <div className="mx-auto mt-9 max-w-md">
                <button
                  type="button"
                  onClick={() => setPhase('email')}
                  disabled={!canRequest}
                  className="mb-btn h-[60px] w-full justify-center rounded-xl px-6 text-xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  리포트 받아보기
                </button>
                {!canRequest && (
                  <p className="mt-3 text-center text-sm text-[color:var(--mb-danger-deep)]">
                    참가 정보가 없어 리포트를 신청할 수 없습니다.
                  </p>
                )}
              </div>
            )}

            {phase === 'email' && (
              <form
                className="mx-auto mt-9 max-w-md space-y-4"
                onSubmit={(e) => void handleRequestOtp(e)}
              >
                <label
                  htmlFor="report-email"
                  className="block text-left text-sm font-semibold text-[color:var(--mb-label-70)]"
                >
                  이메일
                </label>
                <input
                  id="report-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={isLoggedIn && Boolean(accountEmail)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  className="w-full rounded-xl border border-[color:var(--mb-border)] bg-white px-4 py-3 text-base text-[color:var(--mb-label-70)] outline-none focus:border-[color:var(--mb-primary)] focus:ring-2 focus:ring-[color:var(--mb-purple-cream)] read-only:bg-[color:var(--mb-bg-10)]"
                />
                {isLoggedIn && accountEmail && (
                  <p className="text-left text-xs text-[color:var(--mb-fg-muted)]">
                    로그인 계정 이메일로 리포트를 받습니다.
                  </p>
                )}
                {formError && (
                  <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {formError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? '인증 코드 발송 중...' : '인증 코드 받기'}
                </button>
              </form>
            )}

            {phase === 'otp' && (
              <form
                className="mx-auto mt-9 max-w-md space-y-4"
                onSubmit={(e) => void handleVerifyAndSubmit(e)}
              >
                <p className="text-sm text-[color:var(--mb-fg-muted)]">
                  <span className="font-semibold text-[color:var(--mb-label-70)]">{email}</span>
                  으로 보낸 6자리 코드를 입력해 주세요.
                </p>
                <label
                  htmlFor="report-otp"
                  className="block text-left text-sm font-semibold text-[color:var(--mb-label-70)]"
                >
                  인증 코드
                </label>
                <input
                  id="report-otp"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  className="w-full rounded-xl border border-[color:var(--mb-border)] bg-white px-4 py-3 text-center font-mono text-2xl tracking-[0.35em] text-[color:var(--mb-label-70)] outline-none focus:border-[color:var(--mb-primary)] focus:ring-2 focus:ring-[color:var(--mb-purple-cream)]"
                />
                {formError && (
                  <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {formError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mb-btn h-[52px] w-full justify-center rounded-xl px-6 text-base disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? '신청 중...' : '제출하기'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPhase('email');
                    setOtp('');
                    setFormError(null);
                  }}
                  className="w-full py-2 text-sm font-semibold text-[color:var(--mb-fg-muted)]"
                >
                  이메일 다시 입력
                </button>
              </form>
            )}
          </>
        )}

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700"
          >
            {error}
          </p>
        )}

        {phase !== 'success' && (
          <div className="mt-10 text-center">
            <Link
              to="/"
              className="text-sm font-semibold text-[color:var(--mb-fg-muted)] hover:text-[color:var(--mb-label-70)]"
            >
              홈으로
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
