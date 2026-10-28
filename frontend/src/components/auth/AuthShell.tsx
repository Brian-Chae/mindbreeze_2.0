// 인증·가입 화면 공용 셸 — 자연 배경 이미지 + 보라 + 흰 카드 (SDD-249 가입 개편 화면과 동일 스타일)
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: ReactNode;
}

export default function AuthShell({ title, subtitle, maxWidthClass = 'max-w-[480px]', children }: AuthShellProps) {
  return (
    <div className="relative min-h-screen font-sans">
      <img src="/mb-design/assets/images/background3.jpg" alt="" className="fixed inset-0 h-full w-full object-cover" />
      <div className="fixed inset-0 bg-gradient-to-b from-black/20 to-black/60" />
      <div className={`relative z-10 mx-auto flex min-h-screen w-full ${maxWidthClass} flex-col justify-center px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]`}>
        <div className="mb-5 space-y-1 text-center text-white">
          <Link to="/" className="inline-block text-sm font-semibold tracking-tight text-white/90">Mind Breeze</Link>
          <h1 className="text-[22px] font-bold">{title}</h1>
          {subtitle && <p className="text-sm text-white/80">{subtitle}</p>}
          <p className="text-xs">
            <Link to="/register" className="text-white/90 underline">다른 유형으로 가입하기</Link>
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
