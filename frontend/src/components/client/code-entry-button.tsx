// 회원 홈·내 클래스의 [코드로 바로 입장] 버튼 — /join(코드 입장)으로 이동한다.
// 문구는 로그인 화면 코드 입장 카드(SDD-227)와 같은 '코드로 바로 입장'을 쓴다.
// SDD-310: 모바일은 헤더 한 줄을 차지하지 않도록 본문 흐름(body)에서 강조 버튼(48px, 진한 보라 배경+흰 글씨)으로 보여 주고,
// 데스크톱(≥768px)은 헤더 우측(header)에 둔다. 두 배치 모두 sticky/fixed 를 쓰지 않는다.
import { Link } from 'react-router-dom';
import { Key } from 'lucide-react';

import { buttonClass, headerButtonClass } from '../ui/styles';

export type CodeEntryPlacement = 'header' | 'body' | 'inline';

const INLINE_CLASS = buttonClass({ variant: 'primary', tone: 'default', size: 'lg', className: 'w-full rounded-full md:w-auto md:self-end' });
const BODY_CLASS = buttonClass({ variant: 'primary', tone: 'default', size: 'lg', className: 'w-full rounded-full md:hidden' });

export function CodeEntryButton({ variant = 'primary', placement = 'header' }: { variant?: 'primary' | 'secondary'; placement?: CodeEntryPlacement }) {
  if (placement === 'body' || placement === 'inline') {
    return (
      <Link to="/join" data-testid="enter-with-code" data-code-entry={placement} className={placement === 'body' ? BODY_CLASS : INLINE_CLASS}>
        <Key size={16} aria-hidden="true" />코드로 바로 입장
      </Link>
    );
  }
  return (
    <Link to="/join" data-testid="enter-with-code" data-code-entry="header" data-header-action={variant} className={`${headerButtonClass(variant === 'primary')} mobile:hidden`}>
      <Key size={16} aria-hidden="true" />코드로 바로 입장
    </Link>
  );
}
