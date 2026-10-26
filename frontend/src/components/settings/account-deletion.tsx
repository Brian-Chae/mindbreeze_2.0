// 설정 > 계정 삭제 — 안내 → 본인 확인(비밀번호/소셜 재인증) → 최종 확인. 설정 화면에서 2탭 이내로 진입한다.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuthStore } from '../../stores/authStore';
import { ApiError } from '../../lib/api/client';
import { apiErrorCode, requestAppleChallenge } from '../../lib/api/auth';
import { deleteMyAccount, reauthForDeletion } from '../../lib/api/account';
import { DELETION_BLOCK_HINTS, DELETION_NOTICE_LINES } from '../../lib/account-deletion-copy';
import { isNativeApp } from '../../lib/native/platform';
import { nativeGoogleIdToken } from '../../lib/native/google';
import { isAppleLoginAvailable, nativeAppleCredential } from '../../lib/native/apple';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import { buttonClass } from '../../components/ui';

type Step = 'closed' | 'notice' | 'reauth' | 'confirm';

function errorMessage(err: unknown): string {
  const code = apiErrorCode(err);
  if (code && DELETION_BLOCK_HINTS[code]) return DELETION_BLOCK_HINTS[code];
  if (err instanceof ApiError && err.message) return err.message;
  return '계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

export function AccountDeletionSection() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const provider = user?.auth_provider ?? 'email';
  const [step, setStep] = useState<Step>('closed');
  const [password, setPassword] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    if (busy) return;
    setStep('closed');
    setPassword('');
    setProof(null);
    setError(null);
  };
  const dialogRef = useDialogA11y(step !== 'closed', close);

  const googleReauth = useGoogleLogin({
    prompt: 'select_account',
    onSuccess: (res) => void runReauth({ provider: 'google', access_token: res.access_token }),
    onError: () => setError('Google 본인 확인에 실패했어요. 다시 시도해 주세요.'),
  });

  const runReauth = async (payload: Parameters<typeof reauthForDeletion>[0]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await reauthForDeletion(payload);
      setProof(res.reauth_proof);
      setStep('confirm');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSocialReauth = async (): Promise<void> => {
    setError(null);
    try {
      if (provider === 'apple') {
        const { nonce } = await requestAppleChallenge();
        const credential = await nativeAppleCredential(nonce);
        await runReauth({ provider: 'apple', id_token: credential.idToken, nonce: credential.nonce });
      } else if (isNativeApp()) {
        await runReauth({ provider: 'google', id_token: await nativeGoogleIdToken() });
      } else {
        googleReauth();
      }
    } catch {
      setError('본인 확인이 취소되었거나 실패했어요. 다시 시도해 주세요.');
    }
  };

  const handleDelete = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount(provider === 'email' ? { password } : { reauth_proof: proof ?? undefined });
      // 로컬 토큰·스토어·푸시 등록을 정리한다(서버는 이미 모든 토큰을 폐기했다).
      await logout();
      navigate('/login?role=client');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const canSocial = provider === 'google' || (provider === 'apple' && isAppleLoginAvailable());

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => setStep('notice')}
        className="w-full py-3 text-center text-sm font-medium text-[#6F6F6F] bg-white rounded-2xl border border-[#EFEFEF] hover:bg-[#F5F5F5] transition-colors"
      >
        계정 삭제
      </button>

      {step !== 'closed' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-deletion-title"
            className="bg-white rounded-2xl p-6 max-w-md mx-4 w-full max-h-[90vh] overflow-y-auto"
          >
            <h2 id="account-deletion-title" className="text-[17px] font-bold text-[#1F1F1F] mb-3">
              {step === 'confirm' ? '정말 삭제할까요?' : '계정 삭제 안내'}
            </h2>

            {step === 'notice' && (
              <>
                <ul className="space-y-2 text-[14px] text-[#3F3F3F] list-disc pl-5">
                  {DELETION_NOTICE_LINES.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="flex gap-3 justify-end mt-6">
                  <button type="button" onClick={close} className="px-4 py-2 text-[15px] text-[#6F6F6F] font-medium rounded-lg">
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep('reauth')}
                    className={buttonClass({ variant: 'primary' })}
                  >
                    계속
                  </button>
                </div>
              </>
            )}

            {step === 'reauth' && (
              <>
                <p className="text-[14px] text-[#3F3F3F] mb-4">본인 확인을 위해 다시 인증해 주세요.</p>
                {provider === 'email' ? (
                  <label className="block text-sm text-[#3F3F3F]">
                    비밀번호
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      className="mt-1 h-11 w-full rounded-xl border border-[#DDDEE7] px-3 outline-none focus:ring-2 focus:ring-[#5F0080]"
                    />
                  </label>
                ) : canSocial ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSocialReauth()}
                    className="w-full h-11 rounded-xl border border-[#DDDEE7] text-[15px] font-semibold disabled:opacity-50"
                  >
                    {provider === 'apple' ? 'Apple로 본인 확인' : 'Google로 본인 확인'}
                  </button>
                ) : (
                  <p className="text-[14px] text-[#B42318]">이 기기에서는 Apple 본인 확인을 할 수 없어요. 아이폰 앱에서 진행해 주세요.</p>
                )}
                <div className="flex gap-3 justify-end mt-6">
                  <button type="button" onClick={close} disabled={busy} className="px-4 py-2 text-[15px] text-[#6F6F6F] font-medium rounded-lg">
                    취소
                  </button>
                  {provider === 'email' && (
                    <button
                      type="button"
                      disabled={busy || !password}
                      onClick={() => setStep('confirm')}
                      className={buttonClass({ variant: 'primary' })}
                    >
                      다음
                    </button>
                  )}
                </div>
              </>
            )}

            {step === 'confirm' && (
              <>
                <p className="text-[14px] text-[#3F3F3F]">
                  삭제하면 바로 로그아웃되고 되돌릴 수 없어요. 계속하려면 아래 버튼을 눌러 주세요.
                </p>
                <div className="flex gap-3 justify-end mt-6">
                  <button type="button" onClick={close} disabled={busy} className="px-4 py-2 text-[15px] text-[#6F6F6F] font-medium rounded-lg">
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDelete()}
                    className="px-4 py-2 text-[15px] bg-[#B42318] text-white font-medium rounded-lg disabled:opacity-50"
                  >
                    {busy ? '삭제 중…' : '계정 삭제'}
                  </button>
                </div>
              </>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
