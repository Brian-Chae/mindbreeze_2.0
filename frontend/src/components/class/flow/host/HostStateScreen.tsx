// SDD-209 H8 — FH10 닫힘·오류 화면(상담사). 서버 오류 원문은 받지 않는다(문구는 HostStateKind 로만 정해진다).
import { AlertTriangle, ChevronLeft, Clock, Copy, DoorClosed, Home, Link2, List, Lock, RefreshCw, User, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { hostStateCopy, type HostRowIcon, type HostStateAction, type HostStateIcon, type HostStateKind } from '../../../../lib/class/flow/host-state-model';
import { FlowStateScreen } from '../shared/FlowStateScreen';

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
    <FlowStateScreen
      bar={{ title: copy.top, sub: title, left: { label: '홈으로', icon: <ChevronLeft size={20} aria-hidden="true" />, onClick: () => onAction('home') } }}
      icon={HEAD_ICON[copy.icon]}
      warn={copy.warn}
      heading={copy.heading}
      lead={copy.lead}
      rows={copy.rows.map((row) => ({ icon: ROW_ICON[row.icon], title: row.title, sub: row.sub }))}
      primary={{ label: copy.primary.label, icon: ACTION_ICON[copy.primary.action], onClick: () => onAction(copy.primary.action) }}
      secondary={{ label: copy.secondary.label, onClick: () => onAction(copy.secondary.action) }}
      backdropSrc={backdropSrc}
    />
  );
}
