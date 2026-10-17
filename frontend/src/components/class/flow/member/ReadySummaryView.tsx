// SDD-209 M2 — FM06e 준비 완료 요약. 행을 누르면 해당 단계로 돌아가 다시 바꾼다.
import { Activity, ChevronRight, CircleCheck, Lock, Mic, MicOff, MapPin, Shield, Smile } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SummaryIcon, SummaryRow } from '../../../../lib/class/flow/member-prep';
import type { WizardKey } from '../../../../lib/class/flow/member-machine';
import { FlowButton, FlowH1, FlowSub } from '../shared/flow-primitives';
import { MemberFlowFrame, type MemberFlowSteps } from './MemberFlowFrame';

const ICONS: Record<SummaryIcon, ReactNode> = {
  shield: <Shield size={24} aria-hidden="true" />,
  lock: <Lock size={24} aria-hidden="true" />,
  smile: <Smile size={24} aria-hidden="true" />,
  activity: <Activity size={24} aria-hidden="true" />,
  mic: <Mic size={24} aria-hidden="true" />,
  micOff: <MicOff size={24} aria-hidden="true" />,
  pin: <MapPin size={24} aria-hidden="true" />,
};

interface ReadySummaryViewProps {
  displayName: string;
  rows: readonly SummaryRow[];
  steps: MemberFlowSteps;
  place?: 'online' | 'offline';
  backdropSrc?: string;
  onGoto: (step: WizardKey) => void;
  onReady: () => void;
  onBack: () => void;
  onExit: () => void;
}

function RowBody({ row }: { row: SummaryRow }) {
  return (
    <>
      {ICONS[row.icon]}
      {row.label ? (
        <>
          <b>{row.label}</b>
          <span className="v">{row.value}</span>
        </>
      ) : (
        <span className="wide">{row.value}</span>
      )}
    </>
  );
}

export function ReadySummaryView({ displayName, rows, steps, place = 'online', backdropSrc, onGoto, onReady, onBack, onExit }: ReadySummaryViewProps) {
  return (
    <MemberFlowFrame
      wizard
      place={place}
      backdropSrc={backdropSrc}
      steps={steps}
      onBack={onBack}
      onExit={onExit}
      foot={
        <>
          <FlowButton kind="primary" onClick={onReady}>입장 대기</FlowButton>
          <p className="fl-note fm-slot">항목을 눌러 다시 바꿀 수 있어요.</p>
        </>
      }
    >
      <div className="fm-head">
        <span className="fm-hi"><CircleCheck size={28} aria-hidden="true" /></span>
        <FlowH1>준비를 마쳤어요</FlowH1>
        <FlowSub>{displayName}님, 상담사가 시작하면 자동으로 입장해요.</FlowSub>
      </div>
      <div className="fm-sumlist">
        {rows.map((row) =>
          row.goto === null ? (
            <div key={row.key} className="fm-srow"><RowBody row={row} /></div>
          ) : (
            <button key={row.key} type="button" className="fm-srow" onClick={() => onGoto(row.goto as WizardKey)}>
              <RowBody row={row} />
              <ChevronRight className="chev" size={20} aria-hidden="true" />
            </button>
          ),
        )}
      </div>
    </MemberFlowFrame>
  );
}
