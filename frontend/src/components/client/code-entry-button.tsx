// 회원 홈·내 클래스 상단의 [코드로 바로 입장] 버튼 — /join(코드 입장)으로 이동한다.
// 문구는 로그인 화면 코드 입장 카드(SDD-227)와 같은 '코드로 바로 입장'을 쓴다.
import { Link } from 'react-router-dom';
import { Key } from 'lucide-react';

import { headerButtonClass } from '../ui/styles';

export function CodeEntryButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  return (
    <Link to="/join" data-testid="enter-with-code" data-header-action={variant} className={headerButtonClass(variant === 'primary')}>
      <Key size={16} aria-hidden="true" />코드로 바로 입장
    </Link>
  );
}
