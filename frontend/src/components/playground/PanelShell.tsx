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
  disconnected: 'bg-gray-800 text-gray-400',
  waiting: 'bg-amber-500/15 text-amber-300',
  ready: 'bg-emerald-500/15 text-emerald-300',
  error: 'bg-red-500/15 text-red-300',
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
    <section className="flex flex-col rounded-xl border border-gray-800 bg-gray-900">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-4 py-3">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? '패널 펼치기' : '패널 접기'}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:text-gray-200"
        >
          <Chevron down={!collapsed} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-gray-100">{title}</h2>
          {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
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
    <div className="flex h-24 items-center justify-center text-xs text-gray-500">{message}</div>
  );
}
