// SDD-209 H7 — FH07 시작 확인 시트: 준비 인원·준비 중 회원·마이크(또는 장소)·기록 보관 고지·녹음 선택·익명 인원 수.
// 대기실이 비어도, 준비 중인 회원이 있어도 시작할 수 있다. 시작 직후 별도 동의 모달은 없다(이 시트가 대체).
import { AlertTriangle, Calendar, Check, CheckCircle2, Clock, Info, MapPin, MinusCircle, Mic, Play, Shield, Users } from 'lucide-react';
import { deriveStartSheet, type StartSheetInput } from '../../../../lib/class/flow/host-start-model';
import { FlowButton, FlowChip, FlowSheet } from '../shared/flow-primitives';

export interface StartConfirmSheetProps extends StartSheetInput {
  open: boolean;
  address: string | null;
  starting?: boolean;
  onClose: () => void;
  onStart: () => void;
  onToggleRecord: () => void;
  onTurnOnMic: () => void;
}

export function StartConfirmSheet({ open, address, starting = false, onClose, onStart, onToggleRecord, onTurnOnMic, ...input }: StartConfirmSheetProps) {
  const v = deriveStartSheet(input);
  const waiting = v.pending.length > 0 || v.empty;
  return (
    <FlowSheet
      open={open}
      title="시작 전에 확인해요"
      onClose={onClose}
      footer={
        <div className="fhb-act fhb-act-start">
          <FlowButton kind="primary" disabled={starting} onClick={onStart}><Play size={20} aria-hidden="true" />{starting ? '시작하는 중이에요' : v.primaryLabel}</FlowButton>
          <FlowButton kind="ghost" disabled={starting} onClick={onClose}>{v.secondaryLabel}</FlowButton>
        </div>
      }
    >
      <div className="fhb-stat">
        <div className="fhb-sr">
          <span className={waiting ? 'fhb-ico' : 'fhb-ico ok'}><Users size={20} aria-hidden="true" /></span>
          <div className="fhb-rt"><b>준비 인원</b><span>{v.peopleText}</span></div>
        </div>
        {v.empty ? (
          <div className="fhb-pl"><p className="fhb-pn" style={{ paddingTop: 0 }}>시작하면 초대한 회원이 이후에 입장해요</p></div>
        ) : v.pending.length ? (
          <div className="fhb-pl" aria-label={`준비 중인 회원 ${v.pending.length}명`}>
            {v.shown.map((m) => (
              <div className="fhb-pr" key={m.id}>
                <b>{m.name}</b>
                {m.chips.map((chip) => (
                  <span key={chip.label} className={chip.bad ? 'fhb-mchip bad' : 'fhb-mchip'}>
                    {chip.bad ? <AlertTriangle size={16} aria-hidden="true" /> : <Clock size={16} aria-hidden="true" />}{chip.label}
                  </span>
                ))}
              </div>
            ))}
            {v.moreCount > 0 ? <div className="fhb-pr fhb-pmore">외 {v.moreCount}명</div> : null}
            <p className="fhb-pn">준비 중인 회원은 시작 후에도 입장해서 이어서 준비할 수 있어요</p>
          </div>
        ) : null}
        {v.micRow === 'place' ? (
          <div className="fhb-sr">
            <span className="fhb-ico ok"><MapPin size={20} aria-hidden="true" /></span>
            <div className="fhb-rt"><b>장소</b><span>{address?.trim() || '클래스 상세에서 확인해요'}</span></div>
          </div>
        ) : v.micRow === 'off' ? (
          <div className="fhb-sr">
            <span className="fhb-ico warn"><Mic size={20} aria-hidden="true" /></span>
            <div className="fhb-rt"><b>마이크</b><span className="warn">꺼져 있어요</span></div>
            <FlowButton kind="soft" onClick={onTurnOnMic}><Mic size={20} aria-hidden="true" />켜기</FlowButton>
          </div>
        ) : (
          <div className="fhb-sr">
            <span className="fhb-ico ok"><Mic size={20} aria-hidden="true" /></span>
            <div className="fhb-rt"><b>마이크</b><span>켜져 있어요</span></div>
            <FlowChip tone="ok" icon={<CheckCircle2 size={16} />}>켜짐</FlowChip>
          </div>
        )}
      </div>
      <div className="fl-card fhb-consent" data-pz="flow-card" data-size="sm">
        <div className="fhb-facts">
          <span className="fhb-fact"><Calendar size={20} aria-hidden="true" />{v.retentionText}</span>
          <span className="fhb-fact"><Shield size={20} aria-hidden="true" />나와 담당 상담사만 열람</span>
        </div>
        {v.countRows.map((row) => (
          <div className="fhb-cnt" key={row.kind}>
            {row.kind === 'excluded' ? <MinusCircle size={16} aria-hidden="true" /> : <Shield size={16} aria-hidden="true" />}
            <span>{row.text}</span>
          </div>
        ))}
        <button type="button" className="fhb-row fhb-check" role="checkbox" aria-checked={v.checked} disabled={v.checkboxDisabled} onClick={onToggleRecord}>
          <span className={v.checked ? 'fhb-cb on' : v.checkboxDisabled ? 'fhb-cb dis' : 'fhb-cb'}><Check size={16} aria-hidden="true" /></span>
          <div className="fhb-rt"><b>녹음하고 AI 기록지를 만들어요</b></div>
        </button>
      </div>
      <p className="fl-note fhb-startnote">
        <Info size={16} aria-hidden="true" />
        {v.note}
      </p>
    </FlowSheet>
  );
}
