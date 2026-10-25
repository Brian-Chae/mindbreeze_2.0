// 데이터 센터 반출 본인 확인 — 이메일은 비밀번호, 구글·애플은 해당 서비스로 다시 로그인해 받은 1회용 proof.
// 탈퇴 화면(account-deletion.tsx)과 같은 웹·네이티브(Capacitor) 소셜 경로를 쓴다.
import { useGoogleLogin } from '@react-oauth/google';
import { reauthForDataExport } from '../../lib/api/account';
import { apiErrorCode, requestAppleChallenge } from '../../lib/api/auth';
import { isNativeApp } from '../../lib/native/platform';
import { nativeGoogleIdToken } from '../../lib/native/google';
import { isAppleLoginAvailable, nativeAppleCredential } from '../../lib/native/apple';

import type { ReauthProvider } from './use-export-reauth-provider';

interface SocialProps {
  provider: Exclude<ReauthProvider, 'email'>;
  disabled: boolean;
  onProof: (proof: string) => void;
  onError: (message: string) => void;
}

const FAILED = '본인 확인이 취소되었거나 실패했어요. 다시 시도해 주세요.';

async function issueProof(payload: Parameters<typeof reauthForDataExport>[0], onProof: (proof: string) => void, onError: (message: string) => void): Promise<void> {
  try {
    onProof((await reauthForDataExport(payload)).reauth_proof);
  } catch (err) {
    onError(apiErrorCode(err) === 'REAUTH_REQUIRED' ? '본인 확인에 실패했어요. 가입한 계정으로 다시 확인해 주세요.' : FAILED);
  }
}

// 웹 Google 은 useGoogleLogin 팝업 콜백 방식이라 별도 컴포넌트로 분리한다(웹에서만 마운트).
function WebGoogleButton({ disabled, onProof, onError }: Omit<SocialProps, 'provider'>) {
  const login = useGoogleLogin({
    prompt: 'select_account',
    onSuccess: (res) => void issueProof({ provider: 'google', access_token: res.access_token }, onProof, onError),
    onError: () => onError('Google 본인 확인에 실패했어요. 다시 시도해 주세요.'),
  });
  return <button type="button" disabled={disabled} onClick={() => login()}>Google로 본인 확인</button>;
}

function SocialReauthButton({ provider, disabled, onProof, onError }: SocialProps) {
  if (provider === 'apple') {
    if (!isAppleLoginAvailable()) return <p role="alert">이 기기에서는 Apple 본인 확인을 할 수 없어요. 아이폰 앱에서 진행해 주세요.</p>;
    const run = async (): Promise<void> => {
      try {
        const { nonce } = await requestAppleChallenge();
        const credential = await nativeAppleCredential(nonce);
        await issueProof({ provider: 'apple', id_token: credential.idToken, nonce: credential.nonce }, onProof, onError);
      } catch {
        onError(FAILED);
      }
    };
    return <button type="button" disabled={disabled} onClick={() => void run()}>Apple로 본인 확인</button>;
  }
  if (isNativeApp()) {
    const run = async (): Promise<void> => {
      try {
        await issueProof({ provider: 'google', id_token: await nativeGoogleIdToken() }, onProof, onError);
      } catch {
        onError(FAILED);
      }
    };
    return <button type="button" disabled={disabled} onClick={() => void run()}>Google로 본인 확인</button>;
  }
  return <WebGoogleButton disabled={disabled} onProof={onProof} onError={onError} />;
}

interface MethodProps {
  provider: ReauthProvider;
  credential: string;
  onCredential: (value: string) => void;
  disabled: boolean;
  onSocialProof: (proof: string) => void;
  onSocialError: (message: string) => void;
}

/** 계정 유형별 본인 확인 입력: 이메일=로그인 비밀번호, 구글·애플=소셜 재로그인 버튼. */
export function ReauthMethod({ provider, credential, onCredential, disabled, onSocialProof, onSocialError }: MethodProps) {
  if (provider === 'email') {
    return (
      <label>
        로그인 비밀번호
        <input type="password" autoComplete="current-password" value={credential} onChange={(e) => onCredential(e.target.value)} />
      </label>
    );
  }
  return <SocialReauthButton provider={provider} disabled={disabled} onProof={onSocialProof} onError={onSocialError} />;
}
