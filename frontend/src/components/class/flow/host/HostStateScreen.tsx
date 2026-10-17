// SDD-209 H8 — FH10 닫힘·오류 화면(상담사). 서버 오류 원문은 받지 않는다(문구는 HostStateKind 로만 정해진다).
import { AlertTriangle, ChevronLeft, Clock, Copy, DoorClosed, Home, Link2, List, Lock, RefreshCw, User, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { hostStateCopy, type HostRowIcon, type HostStateAction, type HostStateIcon, type HostStateKind } from '../../../../lib/class/flow/host-state-model';
import { FlowButton } from '../shared/flow-primitives';
import { HostFlowFrame } from './HostFlowFrame';

const HEAD_ICON: Readonly<Record<HostStateIcon, ReactNode>> = {
  'door-closed': <DoorClosed size={24} aria-hidden="true" />, alert: <AlertTriangle size={24} aria-hidden="true" />,
  lock: <Lock size={24} aria-hidden="true" />, 'wifi-off': <WifiOff size={24} aria-hidden="true" />,
};
const ROW_ICON: Readonly<Record<HostRowIcon, ReactNode>> = {
  clock: <Clock size={20} aria-hidden="true" />, copy: <Copy size={20} aria-hidden="true" />, list: <List size={20} aria-hidden="true" />,
  refresh: <RefreshCw size={20} aria-hidden="true" />, link: <Link2 size={20} aria-hidden="true" />, user: <User size={20} aria-hidden="true" />,
  'wifi-off': <WifiOff size={20} aria-hidden="true" />,
};
const ACTION_ICON: Readonly<Record<HostStateAction, ReactNode>> = {
  clone: <Copy size={20} aria-hidden="true" />, retry: <RefreshCw size={20} aria-hidden="true" />, list: <List size={20} aria-hidden="true" />, home: <Home size={20} aria-hidden="true" />,
};

export interface HostStateScreenProps {
  kind: HostStateKind;
  /** 방금 닫은 경우 대기 회원 수 */
  waiting?: number;
  /** 방금 닫은 경우 클라이언트 시각 문구 */
  closedAtText?: string | null;
  title: string;
  backdropSrc?: string;
  onAction: (action: HostStateAction) => void;
}

export function HostStateScreen({ kind, waiting, closedAtText, title, backdropSrc, onAction }: HostStateScreenProps) {
  const copy = hostStateCopy(kind, { waiting, closedAtText });
  return (
    <HostFlowFrame
      title={copy.top}
      sub={title}
      backdropSrc={backdropSrc}
      left={{ label: '홈으로', icon: <ChevronLeft size={20} aria-hidden="true" />, onClick: () => onAction('home') }}
      foot={
        <>
          <FlowButton kind="primary" onClick={() => onAction(copy.primary.action)}>{ACTION_ICON[copy.primary.action]}{copy.primary.label}</FlowButton>
          <FlowButton kind="soft" onClick={() => onAction(copy.secondary.action)}>{copy.secondary.label}</FlowButton>
        </>
      }
    >
      <div className="fhb-scene" role={copy.warn ? 'alert' : undefined}>
        <span className={copy.warn ? 'fhb-ico lg warn' : 'fhb-ico lg'}>{HEAD_ICON[copy.icon]}</span>
        <h1 className="fl-h1">{copy.heading}</h1>
        <p className="fl-sub">{copy.lead}</p>
      </div>
      {copy.rows.map((r) => (
        <div className="fhb-row" key={r.title}>
          <span className="fhb-ico">{ROW_ICON[r.icon]}</span>
          <div className="fhb-rt"><b>{r.title}</b><span>{r.sub}</span></div>
        </div>
      ))}
    </HostFlowFrame>
  );
}
