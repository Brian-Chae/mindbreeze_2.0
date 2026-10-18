import type { ReactNode } from 'react';
import AppShell from '../../layout/AppShell';
import ClientShell from '../../client/ClientShell';
import type { TermArea } from '../../../lib/terms';
import './structure-shell.css';

export interface StructureShellProps {
  role: 'host' | 'member';
  title: string;
  sub?: string;
  rightSlot?: ReactNode;
  children?: ReactNode;
  area?: TermArea;
}

/** 기존 셸의 인증·알림·드로어 동작을 재사용하고 읽기 화면만 격리한다. */
export function StructureShell({ role, title, sub, rightSlot, children, area = 'meditation' }: StructureShellProps) {
  const Shell = role === 'member' ? ClientShell : AppShell;
  return (
    <div className="cs-structure h-full min-h-0" data-area={area}>
      <Shell title={title} sub={sub} rightSlot={rightSlot} variant="structure" noScroll contentPad="cs-structure-content">
        <div className="cs-structure-scroll">{children}</div>
      </Shell>
    </div>
  );
}
