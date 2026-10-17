// SDD-209 M7 — FM08 대기열(정원 초과). 순번·순위·경쟁 표현은 쓰지 않는다. `대기 취소`는 확인 시트를 거쳐 서버 대기열에서 제외한다.
// 화면을 닫는 것(시트 닫기·계속 대기하기)은 서버 호출이 없다.
import { CircleAlert, Clock } from 'lucide-react';
import { FlowButton, FlowH1, FlowSheet } from '../shared/flow-primitives';
import { MemberBrandMark } from '../../player/member/MemberBrandMark';
import { MemberFullFrame } from './MemberFlowFrame';

export interface WaitlistViewProps {
  place: 'online' | 'offline';
  title: string;
  hostName: string | null;
  /** `오늘 오후 3:00` */
  whenLabel: string | null;
  /** 오프라인 장소 이름(예: 5층 명상실) */
  placeName: string | null;
  cancelOpen: boolean;
  cancelling: boolean;
  cancelError: string | null;
  backdropSrc?: string;
  onAskCancel: () => void;
  onKeepWaiting: () => void;
  onConfirmCancel: () => void;
}

export function WaitlistView({
  place, title, hostName, whenLabel, placeName, cancelOpen, cancelling, cancelError, backdropSrc, onAskCancel, onKeepWaiting, onConfirmCancel,
}: WaitlistViewProps) {
  const off = place === 'offline';
  const sheet = (
    <FlowSheet
      open={cancelOpen}
      title="대기를 취소할까요?"
      onClose={onKeepWaiting}
      footer={
        <div className="fm-fbtns">
          <FlowButton kind="danger" disabled={cancelling} onClick={onConfirmCancel}>대기 취소</FlowButton>
          <FlowButton kind="soft" disabled={cancelling} onClick={onKeepWaiting}>계속 대기하기</FlowButton>
        </div>
      }
    >
      <p className="fm-sheet-sub">취소하면 자리가 나도 자동으로 입장하지 않아요. 다시 대기할 수 있어요.</p>
      {cancelError ? <div className="fm-err" role="alert"><CircleAlert size={16} aria-hidden="true" />{cancelError}</div> : null}
    </FlowSheet>
  );
  return (
    <MemberFullFrame place={place} backdropSrc={backdropSrc} sheet={sheet} sheetOpen={cancelOpen}>
      <section className="fm-fv" aria-labelledby="fm-wl-title">
        <MemberBrandMark className="fm-logo" />
        <span className="fm-ficon"><Clock size={28} aria-hidden="true" /></span>
        <div className="fm-ftx">
          <span id="fm-wl-title"><FlowH1>{off ? '현장 자리가 가득 찼어요' : '지금은 자리가 가득 찼어요'}</FlowH1></span>
          {off ? (
            <p>자리가 나면 이 화면에서 알려 드려요.<br />가까운 곳에서 잠시 기다려 주세요.</p>
          ) : (
            <p>자리가 나면 자동으로 입장해요.<br />이 화면을 열어 둬 주세요.</p>
          )}
        </div>
        <div className="fm-finfo">
          <div><span>클래스</span><b>{title}</b></div>
          <div><span>{off ? '장소' : '진행자'}</span><b>{off ? (placeName ?? '현장') : (hostName ?? '-')}</b></div>
          <div><span>시작</span><b>{whenLabel ?? '-'}</b></div>
        </div>
        {off ? null : <p className="fm-fnote2">자리가 나면 알림으로 알려 드려요.</p>}
        <div className="fm-fbtns">
          <FlowButton kind="soft" onClick={onAskCancel}>대기 취소</FlowButton>
        </div>
      </section>
    </MemberFullFrame>
  );
}
