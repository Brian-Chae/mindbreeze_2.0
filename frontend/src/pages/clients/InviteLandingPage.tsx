import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getInviteInfo, type InviteInfoResponse } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';
import type { User } from '../../lib/api/auth';
import GoogleLoginButton from '../../components/auth/GoogleLoginButton';
import AppleLoginButton from '../../components/auth/AppleLoginButton';
import { useSocialSignupStore, type SocialCredential } from '../../stores/social-signup-store';

type InviteProblem = 'invalid' | 'expired' | 'network';

// 서버는 없는 초대와 만료·사용 완료 초대를 모두 404 로 주고 문구만 다르다.
function classifyInviteError(err: unknown): InviteProblem {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 410) return /만료|사용/.test(err.message) ? 'expired' : 'invalid';
  }
  return 'network';
}

const PROBLEM_COPY: Record<InviteProblem, { title: string; body: string }> = {
  invalid: { title: '확인할 수 없는 링크예요', body: '링크가 잘못되었거나 지워졌을 수 있어요. 상담사님께 새 초대를 요청해 주세요.' },
  expired: { title: '만료되었거나 이미 사용한 초대예요', body: '이미 가입했다면 로그인해 주세요. 아니라면 상담사님께 새 초대를 요청해 주세요.' },
  network: { title: '초대 정보를 불러오지 못했어요', body: '연결이 잠시 끊겼어요. 다시 시도해 주세요.' },
};

export default function InviteLandingPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const beginSocialSignup = useSocialSignupStore((s) => s.begin);

  const [info, setInfo] = useState<InviteInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<InviteProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setProblem(null);
    if (!token) {
      setProblem('invalid');
      setLoading(false);
      return;
    }
    let cancelled = false;
    getInviteInfo(token)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch((err) => {
        if (!cancelled) setProblem(classifyInviteError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

  const handleSuccess = (user: User | null): void => {
    if (!user) {
      navigate('/');
      return;
    }
    if (user.onboarding_completed) {
      navigate(user.role === 'client' ? '/app' : '/dashboard');
    } else if (user.role === 'client') {
      // 초대 경로: source=invite로 Step 4 연결 확인 UI 진입 (code는 fallback용)
      const codeQuery = info?.counselor_code ? `&code=${info.counselor_code}` : '';
      navigate(`/onboarding/client?source=invite${codeQuery}`);
    } else {
      navigate('/onboarding/counselor');
    }
  };

  // 신규 가입이면 인증 직후 공통 "가입 정보 확인" 화면에서 생년월일·동의를 받는다. 초대 토큰은 그대로 유지된다.
  const goToConfirm = (credential: SocialCredential): void => {
    beginSocialSignup({ credential, inviteToken: token, rememberMe: true, inviteCode: info?.counselor_code });
    navigate('/signup/confirm');
  };

  return (
    <div className="relative min-h-screen font-sans">
      <img src="/mb-design/assets/images/background3.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/60" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[440px] flex-col justify-center px-5 py-10">
        <main className="rounded-3xl bg-white p-6 text-center shadow-xl">
          {loading && (
            <div className="py-8" role="status">
              <div className="mb-3 inline-block h-8 w-8 animate-spin rounded-full border-2 border-[#5F0080] border-t-transparent" />
              <p className="text-[#6F6F6F]">가입 정보를 확인하고 있어요</p>
            </div>
          )}

          {!loading && problem && (
            <>
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[#F3E9F8] text-xl font-bold text-[#5F0080]" aria-hidden="true">!</div>
              <h1 className="mb-2 text-xl font-bold text-[#1F1F1F]">{PROBLEM_COPY[problem].title}</h1>
              <p className="mb-6 text-sm text-[#6F6F6F]">{PROBLEM_COPY[problem].body}</p>
              <div className="flex flex-col gap-2">
                {problem === 'network' && (
                  <button onClick={() => setReloadKey((k) => k + 1)} className="h-[52px] rounded-full bg-[#5F0080] text-[15px] font-semibold text-white hover:bg-[#4B0066]">다시 시도</button>
                )}
                <Link to="/login?role=client" className="flex h-[52px] items-center justify-center rounded-full border border-[#D4D4D4] text-[15px] font-semibold text-[#5F0080]">로그인하기</Link>
              </div>
            </>
          )}

          {!loading && info && (
            <>
              <p className="text-xs font-semibold text-[#5F0080]">상담사님이 초대했어요</p>
              <div className="mx-auto mt-3 grid h-16 w-16 place-items-center rounded-full bg-[#F3E9F8] text-2xl font-bold text-[#5F0080]" aria-hidden="true">
                {info.counselor_name.slice(0, 1)}
              </div>
              <h1 className="mt-3 text-2xl font-bold text-[#1F1F1F]">{info.counselor_name} 상담사</h1>
              {info.organization && <p className="mt-1 text-sm text-[#6F6F6F]">{info.organization}</p>}
              <p className="mt-1 text-xs text-[#6F6F6F]">상담사 코드 {info.counselor_code}</p>
              <p className="mb-5 mt-4 text-sm text-[#6F6F6F]">인증 후 생년월일과 동의 항목을 확인해요. 가입하면 자동으로 상담사와 연결돼요.</p>

              <div className="flex flex-col gap-3">
                <GoogleLoginButton inviteToken={token} onSuccess={handleSuccess} onNeedsSignupInfo={goToConfirm} onError={(e) => setError(e.message)} />
                <AppleLoginButton
                  inviteToken={token}
                  role="client"
                  onSuccess={handleSuccess}
                  onNeedsSignupInfo={(_code, credential) => credential && goToConfirm(credential)}
                  onError={setError}
                />
              </div>
              {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

              <p className="mt-5 text-sm text-[#6F6F6F]">
                또는{' '}
                <Link to={`/register/client?token=${token}&type=client&code=${info.counselor_code ?? ''}`} className="font-semibold text-[#5F0080] underline">
                  이메일로 가입하기
                </Link>
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
