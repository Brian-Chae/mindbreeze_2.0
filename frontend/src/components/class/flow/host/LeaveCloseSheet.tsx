// SDD-209 H7 — FH08 나가기·클래스 닫기 시트. 닫기는 확인 단계를 한 번 더 거친다(확인 전 cancel 호출 0).
import { AlertTriangle, LogOut, XCircle } from 'lucide-react';
import { leaveCopy } from '../../../../lib/class/flow/host-start-model';
import { FlowButton, FlowSheet } from '../shared/flow-primitives';

export type LeaveStage = 'choose' | 'confirm';

export interface LeaveCloseSheetProps {
  open: boolean;
  stage: LeaveStage;
  /** 대기실에 있는 회원 수 */
  waiting: number;
  closing?: boolean;
  /** 나가기(클래스는 열린 채로 둠) */
  onLeave: () => void;
  /** `클래스 닫기` 선택 → 확인 단계로 */
  onAskClose: () => void;
  /** 확인 단계에서 실제로 닫기 */
  onConfirmClose: () => void;
  /** 계속 준비하기 / 시트 닫기 */
  onContinue: () => void;
  /** 확인 단계에서 취소 → 선택 단계로 */
  onBackToChoose: () => void;
}

export function LeaveCloseSheet({ open, stage, waiting, closing = false, onLeave, onAskClose, onConfirmClose, onContinue, onBackToChoose }: LeaveCloseSheetProps) {
  const copy = leaveCopy(waiting);
  if (stage === 'confirm') {
    return (
      <FlowSheet
        open={open}
        title="클래스를 정말 닫을까요?"
        onClose={onBackToChoose}
        dismissOnOutside={false}
        footer={
          <div className="fhb-act">
            <FlowButton kind="danger" disabled={closing} onClick={onConfirmClose}><XCircle size={20} aria-hidden="true" />{closing ? '닫는 중이에요' : '클래스 닫기'}</FlowButton>
            <FlowButton kind="soft" disabled={closing} onClick={onBackToChoose}>취소</FlowButton>
          </div>
        }
      >
        <div className="fhb-ctr">
          <span className="fhb-ico lg warn"><AlertTriangle size={24} aria-hidden="true" /></span>
          <p>{copy.confirmBody}</p>
        </div>
      </FlowSheet>
    );
  }
  return (
    <FlowSheet
      open={open}
      title="나갈까요?"
      onClose={onContinue}
      footer={<FlowButton kind="ghost" onClick={onContinue}>계속 준비하기</FlowButton>}
    >
      <div className="fhb-ctr"><p>{copy.intro}</p></div>
      <div className="fhb-act">
        <button type="button" className="fhb-opt" onClick={onLeave}>
          <LogOut size={20} aria-hidden="true" />
          <span className="fhb-ot"><b>나가기</b><span className="fhb-od">{copy.leaveDesc}</span></span>
        </button>
        <button type="button" className="fhb-opt danger" onClick={onAskClose}>
          <XCircle size={20} aria-hidden="true" />
          <span className="fhb-ot"><b>클래스 닫기</b><span className="fhb-od">{copy.closeDesc}</span></span>
        </button>
      </div>
    </FlowSheet>
  );
}
