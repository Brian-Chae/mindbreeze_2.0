// SDD-219 — 상담 라우트 게이트. 비공개 시 클래스 홈으로 보낸다.
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isCounselingEnabled } from '../../lib/feature-flags';

interface CounselingGateProps {
  /** 회원 영역(/app/*)이면 member, 그 외 host */
  area: 'host' | 'member';
  children: ReactNode;
}

export function counselingFallbackPath(area: 'host' | 'member'): string {
  return area === 'member' ? '/app/classes' : '/classes';
}

export function CounselingGate({ area, children }: CounselingGateProps) {
  if (!isCounselingEnabled()) return <Navigate to={counselingFallbackPath(area)} replace />;
  return <>{children}</>;
}
