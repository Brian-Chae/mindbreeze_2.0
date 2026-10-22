// 회원 홈·내 클래스 상단의 [코드로 바로 입장] 버튼 — /join(코드 입장)으로 이동한다.
// 문구는 로그인 화면 코드 입장 카드(SDD-227)와 같은 '코드로 바로 입장'을 쓴다.
import { Link } from 'react-router-dom';
import { Key } from 'lucide-react';

const BASE = 'mobile:min-h-12 mobile:text-mb-label inline-flex h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080] focus-visible:ring-offset-2';
const VARIANT = {
  primary: 'bg-[#5F0080] text-white hover:bg-[#4B0066]',
  secondary: 'border border-[#5F0080] bg-white text-[#5F0080] hover:bg-[#F5EDFC]',
} as const;

export function CodeEntryButton({ variant = 'primary' }: { variant?: keyof typeof VARIANT }) {
  return (
    <Link to="/join" data-testid="enter-with-code" className={`${BASE} ${VARIANT[variant]}`}>
      <Key size={16} aria-hidden="true" />코드로 바로 입장
    </Link>
  );
}
