// SDD-209 M1 — FM05 입장 확인(몰입형). 개인정보는 FM04b 에서 이미 받았으므로 이 화면에는 입력 요소가 없다.
import { CircleCheck, Clock, Info, LogIn, MapPin, User } from 'lucide-react';
import type { FlowBandMode, FlowPlace, FlowSize } from '../../../../lib/class/flow/types';
import { FlowButton, FlowCard } from '../shared/flow-primitives';
import { MemberFlowFrame } from './MemberFlowFrame';
import { MethodChips } from './MethodChips';

interface EntryConfirmViewProps {
  title: string;
  startLabel: string | null;
  hostName: string | null;
  /** 오프라인 방문 주소 */
  address: string | null;
  place: FlowPlace;
  size: FlowSize;
  bandMode: FlowBandMode;
  displayName: string;
  /** account = 계정 정보로 확인 / input = 입력한 정보로 확인 */
  identitySource: 'account' | 'input';
  /** 아직 열리지 않았다 — 열리면 자동으로 입장한다 */
  wait: boolean;
  backdropSrc?: string;
  onEnter: () => void;
  onBack?: () => void;
}

export function EntryConfirmView({
  title, startLabel, hostName, address, place, size, bandMode, displayName, identitySource, wait, backdropSrc, onEnter, onBack,
}: EntryConfirmViewProps) {
  return (
    <MemberFlowFrame
      place={place}
      backdropSrc={backdropSrc}
      title="입장 확인"
      onBack={onBack}
      colClassName="fm-narrow"
      foot={
        <>
          <div className="fm-fnote">
            {wait ? <Clock size={16} aria-hidden="true" /> : <CircleCheck size={16} aria-hidden="true" />}
            {wait ? '열리면 자동으로 입장해요 · 이 화면을 열어 두세요' : '지금 입장할 수 있어요 · 준비는 2분이면 끝나요'}
          </div>
          {wait ? (
            <FlowButton kind="primary" disabled>열리면 자동으로 입장해요</FlowButton>
          ) : (
            <FlowButton kind="primary" onClick={onEnter}><LogIn size={20} aria-hidden="true" />입장하기</FlowButton>
          )}
        </>
      }
    >
      <FlowCard size="sm">
        <section className="fm-sum" aria-label="클래스 요약">
          <h2>{title}</h2>
          <div className="fm-sum__meta">
            {startLabel ? <span><Clock size={16} aria-hidden="true" />{startLabel}</span> : null}
            {hostName ? <span><User size={16} aria-hidden="true" />{hostName} 상담사 진행</span> : null}
            {address ? <span><MapPin size={16} aria-hidden="true" />{address}</span> : null}
          </div>
          <MethodChips place={place} size={size} bandMode={bandMode} tone="confirm" />
        </section>
      </FlowCard>
      <FlowCard size="sm">
        <section className="fm-who" aria-label="입장 정보">
          <div className="fm-who__id">
            <i><User size={24} aria-hidden="true" /></i>
            <div>
              <b>{displayName}님</b>
              <span className="s">{identitySource === 'account' ? '계정 정보로 확인했어요' : '입력한 정보로 확인했어요'}</span>
            </div>
            <CircleCheck className="ok" size={24} aria-hidden="true" />
          </div>
          <div className="fm-fnote left"><Info size={16} aria-hidden="true" />정보를 바꾸려면 이전 화면으로 돌아가요</div>
        </section>
      </FlowCard>
    </MemberFlowFrame>
  );
}
