// 인증·가입 화면 공용 셸 — 자연 배경 이미지 + 보라 + 흰 카드 (SDD-249 가입 개편 화면과 동일 스타일)
import './signup-flow.css';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface AuthShellProps {
  title: string;
  variant?: 'member';
  subtitle?: string;
  maxWidthClass?: string;
  children: ReactNode;
}

export default function AuthShell({ title, subtitle, variant, maxWidthClass = 'max-w-[480px]', children }: AuthShellProps) {
  if (variant === 'member') return (
    <div className="signup-flow relative min-h-screen font-sans">
      <img src="/images/background8.webp" alt="" className="fixed inset-0 h-full w-full object-cover" />
      <div className="fixed inset-0" />
      <header className="signup-header relative z-10">
        <Link to="/register?role=client" className="signup-back" aria-label="가입 시작으로">‹</Link>
        <Link to="/" className="signup-brand"><img src="/mb-design/assets/logo_symbol_dark.svg" alt="" width={24} className="brightness-0 invert" />MIND BREEZE</Link>
      </header>
      <div className="signup-content relative z-10">
        <p className="mb-3 text-xs font-semibold text-[#D2AEFC]">{title}</p>
        {subtitle && <p className="mb-3 text-sm text-white/80">{subtitle}</p>}
        {children}
        <p className="mt-6 text-center text-xs"><Link to="/register" className="inline-block p-3 underline">다른 유형으로 가입하기</Link></p>
      </div>
    </div>
  );
  return (
    <div className="relative min-h-screen font-sans">
      <img src="/mb-design/assets/images/background3.jpg" alt="" className="fixed inset-0 h-full w-full object-cover" />
      <div className="fixed inset-0 bg-gradient-to-b from-black/20 to-black/60" />
      <div className={`relative z-10 mx-auto flex min-h-screen w-full ${maxWidthClass} flex-col justify-center px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-[calc(2.5rem+env(safe-area-inset-top))]`}>
        <div className="mb-5 space-y-1 text-center text-white">
          <Link to="/" className="inline-block text-sm font-semibold tracking-tight text-white/90">Mind Breeze</Link>
          <h1 className="text-[22px] font-bold text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.45)]">{title}</h1>
          {subtitle && <p className="text-sm text-white/80">{subtitle}</p>}
          <p className="text-xs text-white/90">
            <Link to="/register" className="text-white/90 underline">다른 유형으로 가입하기</Link>
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
