/**
 * Playground 패널 공통 프레임.
 * lucide 대신 인라인 SVG chevron 사용.
 */

import { useState, type ReactNode } from 'react';
import type { PanelState } from '../../types/playground';

interface Props {
  title: string;
  subtitle?: string;
  state: PanelState;
  actions?: ReactNode;
  children: ReactNode;
}

const STATE_LABEL: Record<PanelState, string> = {
  disconnected: '미연결',
  waiting: '대기',
  ready: '정상',
  error: '오류',
};

const STATE_CLASS: Record<PanelState, string> = {
  disconnected: 'bg-[#F2F3F8] text-[#6F6F6F]',
  waiting: 'bg-[#FFF4DC] text-[#8A6B1F]',
  ready: 'bg-[#E6F8F3] text-[#1F8A5B]',
  error: 'bg-[#FDECEC] text-[#B3261E]',
};

function Chevron({ down }: { down: boolean }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      {down ? <path d="M6 9l6 6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}

export function PanelShell({ title, subtitle, state, actions, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="flex flex-col rounded-2xl border border-[#EFEFEF] bg-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-[#EFEFEF] px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? '패널 펼치기' : '패널 접기'}
          className="flex h-6 w-6 items-center justify-center rounded text-[#6F6F6F] hover:text-[#5F0080]"
        >
          <Chevron down={!collapsed} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-[#1F1F1F]">{title}</h2>
          {subtitle && <p className="truncate text-xs text-[#6F6F6F]">{subtitle}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_CLASS[state]}`}
        >
          {STATE_LABEL[state]}
        </span>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {!collapsed && <div className="p-4">{children}</div>}
    </section>
  );
}

export function PanelEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-24 items-center justify-center text-xs text-[#6F6F6F]">{message}</div>
  );
}
