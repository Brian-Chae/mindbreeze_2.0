// 소셜 가입 정보 확인 — 인증 직후 생년월일·약관 동의를 한 화면에서 받는다(오류가 난 뒤 입력란이 나타나는 방식 폐기).
// 인증 자격은 메모리 스토어에서만 읽는다. 새로고침으로 사라졌다면 로그인 화면으로 안내한다.

import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useSocialSignupStore } from '../stores/social-signup-store';
import { ApiError } from '../lib/api/client';
import { apiErrorCode } from '../lib/api/auth';
import { toConsentPayload } from '../lib/auth/consents';
import { resolvePostLoginPath } from '../lib/auth-routing';
import { BIRTH_DATE_MESSAGES } from '../lib/auth/age';
import { SignupInfoForm } from '../components/auth/SignupInfoForm';
import { EMPTY_SIGNUP_INFO, isSignupInfoReady, type SignupInfoValue } from '../lib/auth/signup-info';

type Notice = { kind: 'link' | 'withdrawal' | 'error'; message: string };

export default function SignupConfirmPage() {
  const navigate = useNavigate();
  const pending = useSocialSignupStore((s) => s.pending);
  const clear = useSocialSignupStore((s) => s.clear);
  const loginGoogle = useAuthStore((s) => s.loginGoogle);
  const loginApple = useAuthStore((s) => s.loginApple);
  const [info, setInfo] = useState<SignupInfoValue>(EMPTY_SIGNUP_INFO);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [birthError, setBirthError] = useState<string | null>(null);

  if (!pending) return <Navigate to="/login?role=client" replace />;

  const ready = isSignupInfoReady(info) && !busy;
  const providerLabel = pending.credential.provider === 'google' ? 'Google' : 'Apple';

  const submit = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setNotice(null);
    setBirthError(null);
    const consents = toConsentPayload(info.consents);
    try {
      const cred = pending.credential;
      const user = cred.provider === 'google'
        ? await loginGoogle(cred.token, pending.inviteToken, pending.role, pending.rememberMe, consents, cred.tokenKind, info.birthDate)
        : await loginApple(
            {
              id_token: cred.idToken,
              nonce: cred.nonce,
              authorization_code: cred.authorizationCode,
              name: cred.name,
              invite_token: pending.inviteToken,
              role: pending.role,
              consents,
              birth_date: info.birthDate,
            },
            pending.rememberMe,
          );
      const inviteCode = pending.inviteCode;
      const invited = Boolean(pending.inviteToken);
      clear();
      if (invited && user.role === 'client' && !user.onboarding_completed) {
        navigate(`/onboarding/client?source=invite${inviteCode ? `&code=${inviteCode}` : ''}`);
      } else {
        navigate(resolvePostLoginPath(user));
      }
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === 'AGE_RESTRICTED') setBirthError(BIRTH_DATE_MESSAGES.underage);
      else if (code === 'INVALID_BIRTH_DATE' || code === 'BIRTH_DATE_REQUIRED') setBirthError(BIRTH_DATE_MESSAGES.invalid);
      else if (code === 'ACCOUNT_LINK_REQUIRED') setNotice({ kind: 'link', message: '이미 같은 이메일로 가입한 계정이 있어요. 기존 방법으로 로그인한 뒤 연결해 주세요.' });
      else if (code === 'ACCOUNT_DELETION_PENDING') setNotice({ kind: 'withdrawal', message: '탈퇴 처리 중인 이메일이에요. 영구 삭제가 끝난 뒤 다시 가입할 수 있어요.' });
      else if (err instanceof ApiError) setNotice({ kind: 'error', message: err.message || '가입에 실패했어요. 다시 시도해 주세요.' });
      else setNotice({ kind: 'error', message: '네트워크 오류가 발생했어요. 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen font-sans">
      <img src="/mb-design/assets/images/background3.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/60" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[440px] flex-col justify-center px-5 py-10">
        <Link to="/login?role=client" onClick={clear} className="mb-4 text-sm text-white/90 underline">← 시작으로</Link>
        <main className="rounded-3xl bg-white p-6 shadow-xl">
          <p className="text-xs font-semibold text-[#5F0080]">계정 만들기</p>
          <h1 className="mt-1 text-[22px] font-bold text-[#1F1F1F]">가입 정보 확인</h1>
          <p className="mt-2 text-sm text-[#6F6F6F]">{providerLabel} 인증이 끝났어요. 생년월일과 동의 항목을 확인해 주세요.</p>
          <div className="mt-5">
            <SignupInfoForm value={info} onChange={setInfo} disabled={busy} birthError={birthError} />
          </div>
          {notice && (
            <div role="alert" className="mt-4 rounded-2xl bg-[#FDECEC] px-4 py-3 text-sm text-[#B42318]">
              <p>{notice.message}</p>
              {(notice.kind === 'link' || notice.kind === 'withdrawal') && (
                <Link to="/login?role=client" onClick={clear} className="mt-2 inline-block font-semibold underline">기존 방법으로 로그인</Link>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!ready}
            className="mt-5 h-[52px] w-full rounded-full bg-[#5F0080] text-[15px] font-semibold text-white hover:bg-[#4B0066] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '가입 중…' : '가입하기'}
          </button>
        </main>
      </div>
    </div>
  );
}
