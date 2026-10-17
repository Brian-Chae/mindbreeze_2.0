// SDD-208 — 44px 원형 아이콘 버튼. 아이콘 전용이므로 label(aria-label)을 필수로 받는다.
import type { ReactNode } from 'react';
import './player-shared.css';

interface IconCircleButtonProps {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  /** 측정 훅(data-pz) 이름 — 예: leave, conn, btn-close */
  pz?: string;
  disabled?: boolean;
  pressed?: boolean;
  variant?: 'solid' | 'ghost' | 'primary';
}

export function IconCircleButton({ label, icon, onClick, pz, disabled, pressed, variant = 'solid' }: IconCircleButtonProps) {
  return (
    <button
      type="button"
      className="pz-circle-btn"
      data-variant={variant}
      data-pz={pz}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="pz-circle-btn__icon" aria-hidden="true">{icon}</span>
    </button>
  );
}
