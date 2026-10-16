// SDD-208 — 하단 도크. 항목 폭은 CSS(flex: 1 1 0)가 균등하게 나눈다(균형.md S6). 같은 항목을 다시 누르면 null(닫기)로 토글.
import type { ReactNode } from 'react';
import './player-shared.css';

export interface DockItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** 안읽음 수 등. 0 이면 숨기고 99 초과는 99+ */
  badge?: number;
}

interface PlayerDockProps {
  items: readonly DockItem[];
  active: string | null;
  onSelect: (key: string | null) => void;
  ariaLabel?: string;
}

export function PlayerDock({ items, active, onSelect, ariaLabel = '클래스 도구' }: PlayerDockProps) {
  return (
    <nav className="pz-dock" data-pz="dock" aria-label={ariaLabel}>
      {items.map((item) => {
        const badge = item.badge ?? 0;
        return (
          <button
            key={item.key}
            type="button"
            className="pz-dk"
            data-pz="dk"
            aria-pressed={active === item.key}
            aria-label={badge > 0 ? `${item.label}, 안읽음 ${badge}` : undefined}
            onClick={(e) => {
              // Safari 는 클릭해도 버튼에 포커스를 주지 않아, 시트가 닫힐 때 돌아갈 곳이 사라진다
              e.currentTarget.focus();
              onSelect(active === item.key ? null : item.key);
            }}
          >
            <span className="pz-dk__icon" aria-hidden="true">{item.icon}</span>
            <span className="pz-dk__label">{item.label}</span>
            {badge > 0 ? <i className="pz-dk__badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</i> : null}
          </button>
        );
      })}
    </nav>
  );
}
