// SDD-209 M3 — 준비 중에 상담사가 클래스를 시작했을 때(FM06b·c·d `-started`). 단계를 막지 않고, 지금 입장하거나 준비를 이어갈 수 있다.
import { Clock, Play } from 'lucide-react';
import { FlowButton, FlowSheet } from '../shared/flow-primitives';

interface StartedSheetProps {
  open: boolean;
  /** 남은 준비 이름들(예: 오늘의 상태 · LINK BAND · 기기) */
  remaining: readonly string[];
  onEnterNow: () => void;
  onContinue: () => void;
}

export function StartedSheet({ open, remaining, onEnterNow, onContinue }: StartedSheetProps) {
  return (
    <FlowSheet
      open={open}
      title="코치가 클래스를 시작했어요"
      onClose={onContinue}
      dismissOnOutside={false}
      footer={
        <div className="fm-stack" style={{ gap: 8 }}>
          <FlowButton kind="primary" onClick={onEnterNow}><Play size={20} aria-hidden="true" />지금 입장하기</FlowButton>
          <FlowButton kind="soft" onClick={onContinue}>준비 이어서 하기</FlowButton>
        </div>
      }
    >
      <div className="fm-stack">
        {remaining.length > 0 ? <div className="fm-li"><Clock size={20} aria-hidden="true" /><span>남은 준비: {remaining.join(' · ')}</span></div> : null}
        <p className="fm-sheet-sub">건너뛴 준비는 입장한 뒤 진행 화면의 도구에서 이어서 할 수 있어요.</p>
      </div>
    </FlowSheet>
  );
}
