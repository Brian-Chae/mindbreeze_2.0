// SDD-208 — 톤(info·caution·coral·live) 안내 칩/배너. 상태를 색만으로 전달하지 않도록 아이콘과 텍스트를 함께 받는다.
import type { ReactNode } from 'react';
import './player-shared.css';

export type NoticeTone = 'info' | 'caution' | 'coral' | 'live';

interface NoticeBannerProps {
  tone: NoticeTone;
  icon: ReactNode;
  children: ReactNode;
  /** chip = 링 아래 안내 pill, banner = 화면 상단/본문 폭 배너 */
  variant?: 'chip' | 'banner';
  /** 측정 훅 이름. 기본값은 chip=guide, banner=banner */
  pz?: string;
  /** 우측 액션 슬롯(예: "마이크 켜기") */
  action?: ReactNode;
}

export function NoticeBanner({ tone, icon, children, variant = 'chip', pz, action }: NoticeBannerProps) {
  return (
    <div
      className="pz-notice"
      role="status"
      data-tone={tone}
      data-variant={variant}
      data-has-action={action ? 'true' : undefined}
      data-pz={pz ?? (variant === 'banner' ? 'banner' : 'guide')}
    >
      <span className="pz-notice__icon" aria-hidden="true">{icon}</span>
      <span className="pz-notice__text">{children}</span>
      {action ? <span className="pz-notice__action">{action}</span> : null}
    </div>
  );
}
