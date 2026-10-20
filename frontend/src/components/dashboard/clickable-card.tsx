// SDD-221 — 카드 전체 클릭. 오버레이 Link(absolute inset-0) 위에 내부 버튼/링크를 relative z-10 으로 올린다.
// 중첩 <a> 를 만들지 않고, 내부 컨트롤 클릭은 오버레이에 닿지 않아 카드 이동으로 번지지 않는다.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface ClickableCardProps {
  to: string;
  /** 오버레이 링크의 접근성 이름 (보통 카드 제목) */
  label: string;
  className?: string;
  children: ReactNode;
}

export function ClickableCard({ to, label, className = '', children }: ClickableCardProps) {
  return (
    <div className={`group relative ${className}`}>
      <Link
        to={to}
        aria-label={label}
        className="absolute inset-0 z-0 rounded-[inherit] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080]"
      />
      {children}
    </div>
  );
}

/** 카드 안에서 오버레이 위로 올라오는 영역(내부 버튼·링크용) */
export function CardAction({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`relative z-10 ${className}`}>{children}</div>;
}
