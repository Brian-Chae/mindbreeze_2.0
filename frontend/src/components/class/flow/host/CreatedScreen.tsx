// SDD-209 H3 — FH03 생성 완료: 입장 코드(4자리 큰 글자·복사) + 초대 결과(요청 결과만) + 클래스 열러 가기.
// 코드는 상담사 화면에서만 보이고, 참가자에게만 전달하도록 안내한다(D-4). QR 없음.
import { Bookmark, Calendar, Check, Copy, DoorOpen, File, Info, List, Mail, Send, UserPlus, X } from 'lucide-react';
import { BAND_LABEL } from '../../../../lib/class/class-wizard';
import { inviteHeading, inviteRowText, type CreatedInviteRow, type CreatedView } from '../../../../lib/class/flow/host-create-flow';
import { FlowButton, FlowChip, FlowChipRow, FlowH1, FlowH2, FlowSub } from '../shared/flow-primitives';
import { FhCard } from './host-flow-atoms';
import { HostFlowFrame } from './HostFlowFrame';

export type TemplateState = 'idle' | 'saving' | 'saved' | 'error';

export interface CreatedScreenProps {
  view: CreatedView;
  backdropSrc?: string;
  copied?: boolean;
  templateState?: TemplateState;
  /** 다시 시도 중인 행 key */
  retryingKey?: string | null;
  onCopyCode: () => void;
  onOpenClass: () => void;
  onDetail: () => void;
  onList: () => void;
  onInviteMore?: () => void;
  onRetry: (rowKey: string) => void;
  onSaveTemplate: () => void;
}

function InviteRow({ row, busy, onRetry }: { row: CreatedInviteRow; busy: boolean; onRetry: () => void }) {
  return (
    <div className={row.ok ? 'fh-inv' : 'fh-inv fail'}>
      <span className="av">{row.kind === 'email' ? <Mail size={20} aria-hidden="true" /> : row.label.slice(0, 1)}</span>
      <div>
        <div className="nm">{row.label}</div>
        <div className={row.ok ? 'sub' : 'sub bad'}>{inviteRowText(row)}</div>
      </div>
      {row.ok ? null : (
        <FlowButton kind="soft" disabled={busy} onClick={onRetry}><Send size={16} aria-hidden="true" />다시 시도</FlowButton>
      )}
    </div>
  );
}

export function CreatedScreen({
  view, backdropSrc, copied = false, templateState = 'idle', retryingKey = null, onCopyCode, onOpenClass, onDetail, onList, onInviteMore, onRetry, onSaveTemplate,
}: CreatedScreenProps) {
  const { heading, emptyHint } = inviteHeading(view.rows);
  const scheduled = view.scheduleText !== null;
  const sizeText = view.size === 'solo' ? '1:1' : `그룹 · 정원 ${view.capacity}명`;
  const placeText = view.place === 'online' ? '온라인' : '오프라인';
  const many = view.rows.length > 1;
  const templateText = templateState === 'saved' ? '템플릿 저장됨' : templateState === 'saving' ? '저장하는 중' : templateState === 'error' ? '다시 저장' : '템플릿 저장';
  return (
    <HostFlowFrame
      className="fh-wiz"
      place={view.place}
      backdropSrc={backdropSrc}
      fill={many}
      left={{ label: '목록으로', icon: <X size={24} />, onClick: onList }}
      title="클래스 만들기"
      foot={
        <>
          <FlowButton kind="primary" onClick={onOpenClass}><DoorOpen size={20} aria-hidden="true" />클래스 열러 가기</FlowButton>
          <div className="fh-ghostrow">
            <FlowButton kind="ghost" onClick={onDetail}><File size={16} aria-hidden="true" />상세 보기</FlowButton>
            <FlowButton kind="ghost" onClick={onList}><List size={16} aria-hidden="true" />목록으로</FlowButton>
            <FlowButton kind="ghost" disabled={templateState === 'saving' || templateState === 'saved'} onClick={onSaveTemplate}><Bookmark size={16} aria-hidden="true" />{templateText}</FlowButton>
          </div>
        </>
      }
    >
      <span className="fh-ok" aria-hidden="true"><Check size={24} /></span>
      <FlowH1>클래스를 만들었어요</FlowH1>
      <FlowChipRow>
        <FlowChip>{placeText}</FlowChip>
        <FlowChip>{sizeText}</FlowChip>
        {scheduled ? (
          <FlowChip icon={<Calendar size={16} />}>{view.scheduleText} 예정</FlowChip>
        ) : (
          <FlowChip>{BAND_LABEL[view.band]}</FlowChip>
        )}
      </FlowChipRow>
      <FhCard extra="fh-codecard">
        <span className="fl-label">입장 코드</span>
        <div className="fh-coderow">
          <b className="fh-codebig" aria-label={view.code ? `입장 코드 ${view.code.split('').join(' ')}` : '입장 코드 없음'} data-pz="host-code">{view.code ?? '----'}</b>
          <FlowButton kind="soft" disabled={!view.code} onClick={onCopyCode}>
            {copied ? <Check size={20} aria-hidden="true" /> : <Copy size={20} aria-hidden="true" />}
            {copied ? '복사했어요' : '코드 복사'}
          </FlowButton>
        </div>
        <div className="fh-note">
          <Info size={20} aria-hidden="true" />
          <span>{scheduled ? '열리면 사용할 수 있어요. ' : ''}코드는 참가자에게만 전달하세요</span>
        </div>
      </FhCard>
      <FhCard extra="fh-invcard">
        <FlowH2>{heading}</FlowH2>
        {emptyHint ? (
          <>
            <FlowSub>{emptyHint}</FlowSub>
            <FlowButton kind="soft" onClick={onInviteMore ?? onDetail}><UserPlus size={20} aria-hidden="true" />회원 초대하러 가기</FlowButton>
          </>
        ) : (
          <div className="fh-invlist fh-plist">
            {view.rows.map((row) => (
              <InviteRow key={row.key} row={row} busy={retryingKey === row.key} onRetry={() => onRetry(row.key)} />
            ))}
          </div>
        )}
      </FhCard>
    </HostFlowFrame>
  );
}
