// SDD-220 — AI 화면 게이트. AI 비공개면 children 을 mount 하지 않고 역할 홈/채팅 목록으로 replace 한다.
// 상담 게이트(counseling-gate)와 독립이다 — AI=true 가 상담 비공개를 해제하지 않는다.
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isAiEnabled } from '../../lib/feature-flags';

interface AiGateProps {
  /** AI 비공개 시 이동할 경로(기본: 일반 채팅 목록). 회원 영역은 /app/chat 을 넘긴다. */
  fallbackTo?: string;
  children: ReactNode;
}

export function AiGate({ fallbackTo = '/chat', children }: AiGateProps) {
  if (!isAiEnabled()) return <Navigate to={fallbackTo} replace />;
  return <>{children}</>;
}

/** AI 가 켜졌을 때만 렌더하는 인라인 게이트(CTA·카드·패널용). 비공개면 아무것도 mount 하지 않는다. */
export function AiOnly({ children }: { children: ReactNode }) {
  if (!isAiEnabled()) return null;
  return <>{children}</>;
}
