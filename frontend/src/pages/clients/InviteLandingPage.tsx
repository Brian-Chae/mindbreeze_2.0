import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getInviteInfo, type InviteInfoResponse } from '../../lib/api/clients';
import { ApiError } from '../../lib/api/client';
import type { User } from '../../lib/api/auth';
import GoogleLoginButton from '../../components/auth/GoogleLoginButton';

export default function InviteLandingPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [info, setInfo] = useState<InviteInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('잘못된 초대 링크입니다');
      setLoading(false);
      return;
    }
    let cancelled = false;
    getInviteInfo(token)
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '초대 정보를 확인할 수 없습니다');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleGoogleSuccess = (user: User | null): void => {
    if (!user) {
      navigate('/');
      return;
    }
    if (user.onboarding_completed) {
      if (user.role === 'client') {
        navigate('/app');
      } else {
        navigate('/dashboard');
      }
    } else if (user.role === 'client') {
      navigate(`/onboarding/client?code=${info?.counselor_code ?? ''}`);
    } else {
      navigate('/onboarding/counselor');
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {loading && (
          <div className="py-8">
            <div className="inline-block w-8 h-8 border-2 border-[#5F0080] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-[#6F6F6F]">확인 중...</p>
          </div>
        )}

        {!loading && error && (
          <>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#EFEFEF] flex items-center justify-center">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6F6F6F"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-[#1F1F1F] mb-2">초대가 만료되었습니다</h1>
            <p className="text-sm text-[#6F6F6F] mb-6">{error}</p>
            <button
              onClick={() => navigate('/')}
              className="rounded-xl px-6 py-3 font-semibold bg-white text-[#6F6F6F] border border-[#D4D4D4] hover:bg-[#EFEFEF] transition-colors"
            >
              홈으로
            </button>
          </>
        )}

        {!loading && info && (
          <>
            {/* 상담사 프로필 카드 */}
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[#5F0080]/10 flex items-center justify-center">
              <span className="text-3xl">🌿</span>
            </div>
            <h1 className="text-2xl font-bold text-[#1F1F1F] mb-1">{info.counselor_name}</h1>
            {info.organization && (
              <p className="text-[#6F6F6F] text-sm mb-2">{info.organization}</p>
            )}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#5F0080]/10 text-[#5F0080] rounded-full text-xs font-medium mb-6">
              상담사 코드: {info.counselor_code}
            </div>

            <p className="text-sm text-[#6F6F6F] mb-6">
              상담사님이 MIND BREEZE에 초대했습니다.
            </p>

            {/* Google 로그인 CTA */}
            <div className="mb-4">
              <GoogleLoginButton
                inviteToken={token}
                onSuccess={handleGoogleSuccess}
              />
            </div>

            {/* 이메일 가입 보조 링크 */}
            <p className="text-sm text-[#6F6F6F]">
              또는{' '}
              <Link
                to={`/register?token=${token}&type=client&code=${info.counselor_code ?? ''}`}
                className="text-[#5F0080] underline hover:text-[#4A0066] transition-colors"
              >
                이메일로 가입하기
              </Link>
            </p>

            <p className="text-xs text-[#6F6F6F] mt-4">
              가입 후 자동으로 상담사와 연결됩니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
