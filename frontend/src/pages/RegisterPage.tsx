// 회원가입 진입: 역할 선택 (회원 / 상담사 / 기관) — SDD-073
// 기존 ?role=client|counselor, ?type=client&token=... 주소는 역할별 페이지로 연결한다.

import { Link, Navigate, useSearchParams } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';

interface RoleCardProps {
  to: string;
  title: string;
  description: string;
  cta: string;
}

function RoleCard({ to, title, description, cta }: RoleCardProps) {
  return (
    <Link
      to={to}
      className="block bg-surface-raised rounded-2xl border border-border-default p-6 hover:border-brand-primary hover:shadow-sm transition-all group"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-lg font-bold text-ink-primary">{title}</p>
          <p className="text-sm text-ink-tertiary leading-relaxed">{description}</p>
        </div>
        <span className="text-sm font-semibold text-brand-primary whitespace-nowrap ml-4 group-hover:translate-x-0.5 transition-transform">
          {cta} →
        </span>
      </div>
    </Link>
  );
}

export default function RegisterPage() {
  const [params] = useSearchParams();
  const roleParam = params.get('role');
  const typeParam = params.get('type');
  const search = params.toString() ? `?${params.toString()}` : '';

  // 기존 주소 호환 — invite_token(code 포함) 등 쿼리를 보존한 채 역할별 페이지로 연결
  if (roleParam === 'client' || typeParam === 'client') {
    return <Navigate to={`/register/client${search}`} replace />;
  }
  if (roleParam === 'counselor') {
    return <Navigate to={`/register/counselor${search}`} replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-canvas p-4 sm:p-8 relative">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[520px] space-y-8">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-block">
            <h1 className="font-display text-3xl font-light text-ink-primary tracking-tight">
              Mind Breeze
            </h1>
          </Link>
          <p className="text-sm text-ink-tertiary">가입 유형을 선택해 주세요</p>
        </div>

        <div className="space-y-4">
          <RoleCard
            to="/register/client"
            title="회원 가입"
            description="상담사와 연결해 상담·명상 서비스를 이용해요."
            cta="가입하기"
          />
          <RoleCard
            to="/register/counselor"
            title="상담사 가입"
            description="기관 초대를 받았거나 개인 상담사로 시작해요."
            cta="시작하기"
          />
          <RoleCard
            to="/register/organization"
            title="기관 가입 상담"
            description="우리 기관의 MIND BREEZE 도입을 상담해요."
            cta="상담 신청"
          />
        </div>

        <p className="text-center text-sm text-ink-tertiary">
          이미 계정이 있으신가요?{' '}
          <Link to="/login" className="text-brand-primary hover:text-brand-primary-hover font-medium">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
