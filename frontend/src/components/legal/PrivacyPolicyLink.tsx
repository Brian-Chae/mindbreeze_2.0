// 개인정보 처리방침 링크 — 새 탭으로 열어 작성 중인 입력을 잃지 않게 한다

import type { ReactNode } from 'react';

interface PrivacyPolicyLinkProps {
  className?: string;
  children?: ReactNode;
}

export function PrivacyPolicyLink({ className, children }: PrivacyPolicyLinkProps) {
  return (
    <a href="/privacy" target="_blank" rel="noopener noreferrer" className={className ?? 'underline underline-offset-2'}>
      {children ?? '개인정보 처리방침'}
    </a>
  );
}
