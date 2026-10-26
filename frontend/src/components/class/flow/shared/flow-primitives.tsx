// SDD-209 T2a — 몰입형(사전·사후 흐름) 레이아웃 프리미티브.
// 구조: PlayerShell(flow) > [상단 바 PlayerTopBar variant=flow] + FlowBody > FlowCol + dock=FlowFoot.
// data-pz 계약: flow-col · flow-card · flow-foot · flow-cta · flow-steps · flow-list · flow-sheet (e2e/class-flow 측정 훅).
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { PlayerSheet } from '../../player/shared/PlayerSheet';
import './flow-shared.css';

export function FlowBody({ children }: { children: ReactNode }) {
  return <div className="fl-body" data-pz="flow-body">{children}</div>;
}

export function FlowCol({ children }: { children: ReactNode }) {
  return <div className="fl-col" data-pz="flow-col">{children}</div>;
}

/** 하단 고정 CTA 영역. PlayerShell 의 dock 슬롯에 넣는다 */
export function FlowFoot({ children }: { children: ReactNode }) {
  return <div className="fl-foot" data-pz="flow-foot">{children}</div>;
}

export function FlowH1({ children }: { children: ReactNode }) {
  return <h1 className="fl-h1">{children}</h1>;
}

export function FlowH2({ children }: { children: ReactNode }) {
  return <h2 className="fl-h2">{children}</h2>;
}

export function FlowSub({ children }: { children: ReactNode }) {
  return <p className="fl-sub">{children}</p>;
}

export function FlowNote({ children }: { children: ReactNode }) {
  return <p className="fl-note">{children}</p>;
}

interface FlowCardProps {
  strong?: boolean;
  size?: 'md' | 'sm';
  children: ReactNode;
}

export function FlowCard({ strong, size = 'md', children }: FlowCardProps) {
  return (
    <div className="fl-card" data-pz="flow-card" data-strong={strong ? 'true' : undefined} data-size={size === 'sm' ? 'sm' : undefined}>
      {children}
    </div>
  );
}

interface FlowButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> {
  kind?: 'primary' | 'soft' | 'ghost' | 'danger';
  children: ReactNode;
}

/** 주 버튼(primary)만 flow-cta 로 측정된다 — 단계가 바뀌어도 위치가 같아야 한다(FR1) */
export function FlowButton({ kind = 'primary', children, ...rest }: FlowButtonProps) {
  return (
    <button {...rest} type="button" className="fl-btn" data-kind={kind} data-pz={kind === 'primary' ? 'flow-cta' : undefined}>
      {children}
    </button>
  );
}

interface FlowChipProps {
  tone?: 'neutral' | 'ok' | 'warn' | 'live';
  icon?: ReactNode;
  children: ReactNode;
}

export function FlowChip({ tone = 'neutral', icon, children }: FlowChipProps) {
  return (
    <span className="fl-chip" data-tone={tone}>
      {icon ? <span aria-hidden="true" style={{ display: 'inline-grid' }}>{icon}</span> : null}
      {children}
    </span>
  );
}

export function FlowChipRow({ children }: { children: ReactNode }) {
  return <div className="fl-chiprow">{children}</div>;
}

export function FlowList({ children }: { children: ReactNode }) {
  return <ul className="fl-list" data-pz="flow-list">{children}</ul>;
}

/** 진행 점: total 개, current(0부터) 이전은 done, 현재는 on */
export function FlowSteps({ total, current }: { total: number; current: number }) {
  return (
    <div className="fl-steps" data-pz="flow-steps" role="group" aria-label={`${total}단계 중 ${current + 1}단계`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < current ? 'done' : i === current ? 'on' : undefined} aria-current={i === current ? 'step' : undefined} />
      ))}
    </div>
  );
}

interface FlowSheetProps {
  sheetMode?: 'side' | 'bottom';
  open: boolean;
  title: string;
  sub?: string;
  onClose: () => void;
  /** 본문 스크롤 밖 고정 버튼 영역 */
  footer?: ReactNode;
  closeLabel?: string;
  dismissOnOutside?: boolean;
  children: ReactNode;
}

/** 사전 흐름 시트 — PlayerSheet 위임(바텀/사이드 판정 sheet-mode.ts 한 곳) */
export function FlowSheet({ children, ...rest }: FlowSheetProps) {
  return (
    <PlayerSheet {...rest} pz="flow-sheet">
      {children}
    </PlayerSheet>
  );
}
