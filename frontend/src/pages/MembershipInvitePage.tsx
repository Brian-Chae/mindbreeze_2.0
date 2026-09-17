// SDD-079: 기존 상담사 "소속 추가 초대" 수락 페이지
// 이메일 링크의 일회용 토큰으로 수락한다 — 비밀번호 설정 없이 기존 계정에 소속만 추가된다.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../lib/api/client';
import { acceptMembershipInvite } from '../lib/api/org';

export default function MembershipInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(!token);
  const [acceptedOrgName, setAcceptedOrgName] = useState<string | null>(null);

  const handleAccept = async (): Promise<void> => {
    if (!token) {
      setLinkExpired(true);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await acceptMembershipInvite(token);
      setAcceptedOrgName(res.org_name);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 401 || err.status === 410)) {
        setLinkExpired(true);
      } else if (err instanceof ApiError) {
        setError(err.message || '소속 초대 수락에 실패했습니다');
      } else {
        setError('네트워크 오류가 발생했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen font-sans">
      <img
        src="/mb-design/assets/images/background3.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 to-black/35" />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-[18px] px-6">
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2.5 group" aria-label="랜딩 페이지로 이동">
            <img
              src="/mb-design/assets/logo_symbol_dark.svg"
              width={32}
              height={14}
              alt=""
              className="brightness-0 invert"
            />
            <span className="font-extrabold text-[17px] text-white tracking-tight opacity-90 group-hover:opacity-100 transition-opacity">
              Mind&nbsp;Breeze
            </span>
          </Link>
          <Link
            to="/login"
            className="text-[13px] text-white/90 hover:text-white font-medium px-4 py-2 rounded-full border border-white/30 hover:border-white/60 transition-colors"
          >
            상담사 로그인
          </Link>
        </div>

        <img
          src="/mb-design/assets/logo_symbol_dark.svg"
          width={64}
          height={29}
          alt=""
          className="brightness-0 invert opacity-80"
        />
        <div className="font-extrabold text-[22px] text-white/70 tracking-tight">Mind&nbsp;Breeze</div>
        <h1 className="text-[36px] font-extrabold text-white tracking-tighter leading-tight">
          기관 소속 초대
        </h1>

        {acceptedOrgName ? (
          <div className="flex flex-col items-center gap-4 text-center max-w-[360px]">
            <div className="text-[15px] text-white/80">
              <strong className="text-white">{acceptedOrgName}</strong> 소속 초대를 수락했습니다.
              <br />
              기존 계정으로 로그인하면 새 소속 기관에서 활동할 수 있습니다.
            </div>
            <Link
              to="/login"
              className="h-[52px] w-[280px] flex items-center justify-center rounded-full bg-[#5F0080] hover:bg-[#4B0066] active:bg-[#3F0055] text-white font-semibold text-[15px] transition-colors"
            >
              로그인하기
            </Link>
          </div>
        ) : linkExpired ? (
          <div className="flex flex-col items-center gap-4 text-center max-w-[320px]">
            <p className="text-[15px] text-white bg-red-500/80 rounded-full px-4 py-2" role="alert">
              초대 링크가 만료되었거나 유효하지 않습니다. 기관 담당자에게 재발송을 요청하세요.
            </p>
            <Link
              to="/login"
              className="text-[13px] text-white/85 hover:text-white underline-offset-2 hover:underline"
            >
              로그인 페이지로 이동
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center max-w-[360px]">
            <div className="text-[15px] text-white/60">
              기관의 소속 상담사 초대 링크로 접속하셨습니다.
              <br />
              수락하면 기존 계정에 소속이 추가됩니다. 비밀번호 설정은 필요 없습니다.
            </div>
            {error && (
              <p className="text-[13px] text-white bg-red-500/80 rounded-full px-4 py-1.5" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={loading}
              className="h-[52px] w-[280px] rounded-full bg-[#5F0080] hover:bg-[#4B0066] active:bg-[#3F0055] disabled:opacity-60 text-white font-semibold text-[15px] transition-colors"
            >
              {loading ? '수락 중…' : '소속 초대 수락하기'}
            </button>
            <div className="text-[12px] text-white/70">
              초대를 원하지 않으시면 이 페이지를 닫아주세요. 소속은 추가되지 않습니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
