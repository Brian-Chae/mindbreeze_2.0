// SDD-209 M2 — FM06a 시작 전에 확인해 주세요: 고지 + 리포트 반영 선택 + 연구 동의(별도 블록).
// 어느 선택이든(고르지 않아도, 저장에 실패해도) 주 버튼은 항상 활성이고 입장·녹음·영상·뇌파 업로드를 막지 않는다.
import { Activity, Check, CircleAlert, Mic, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ReportChoice } from '../../../../lib/class/flow/member-prep';
import type { FlowBandMode, FlowPlace, FlowSize } from '../../../../lib/class/flow/types';
import { FlowButton, FlowCard, FlowH1, FlowSub } from '../shared/flow-primitives';
import { MemberFlowFrame, type MemberFlowSteps } from './MemberFlowFrame';
import { MethodChips } from './MethodChips';
import { PrivacyPolicyLink } from '../../../legal/PrivacyPolicyLink';

export interface NoticeStepViewProps {
  sessionType?: string;
  place: FlowPlace;
  size: FlowSize;
  bandMode: FlowBandMode;
  title: string;
  hostName: string | null;
  /** 서버 설정 보관 기간(일). 모르면 null — 기간 숫자를 지어내지 않는다 */
  retentionDays: number | null;
  reportChoice: ReportChoice;
  researchConsent: boolean;
  /** 연구 동의를 저장하지 못했다 — 미동의로 진행한다 */
  researchSaveFailed: boolean;
  steps: MemberFlowSteps;
  backdropSrc?: string;
  onReportChoice: (choice: 'included' | 'excluded') => void;
  onResearchChange: (consented: boolean) => void;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
}

function NoticeRow({ icon, label, desc }: { icon: ReactNode; label: string; desc?: string }) {
  return (
    <div className="fm-nrow">
      {icon}
      <span className="tx">
        <span>{label}</span>
        {desc ? <span className="fm-ft">{desc}</span> : null}
      </span>
    </div>
  );
}

export function NoticeStepView({
  sessionType, place, size, bandMode, title, hostName, retentionDays, reportChoice, researchConsent, researchSaveFailed, steps, backdropSrc,
  onReportChoice, onResearchChange, onNext, onBack, onExit,
}: NoticeStepViewProps) {
  const online = place === 'online';
  const retention =
    retentionDays === null ? '기록 원본(뇌파·음성·영상)은 정해진 기간이 지나면 삭제돼요' : `기록 원본(뇌파·음성·영상)은 ${retentionDays}일이 지나면 삭제돼요`;
  const confirmLine =
    reportChoice === 'included'
      ? '이번 클래스의 내 기록이 리포트에 반영돼요'
      : reportChoice === null
        ? '고르지 않으면 반영하지 않는 것으로 진행돼요'
        : null;
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
          <FlowButton kind="primary" onClick={onNext}>확인하고 계속하기</FlowButton>
          <p className="fl-note fm-slot">리포트 반영은 클래스가 끝나기 전까지 바꿀 수 있어요.</p>
          <p className="fl-note fm-slot"><PrivacyPolicyLink>개인정보 처리방침 보기</PrivacyPolicyLink></p>
        </>
      }
    >
      <div className="fm-head fm-wiz-dense">
        <FlowH1>시작 전에 확인해 주세요</FlowH1>
        <FlowSub>{hostName ? `${hostName} 상담사와 함께하는 ${title}` : title}</FlowSub>
      </div>
      <MethodChips place={place} size={size} />
      <div className="fm-agrid">
        <div className="fm-acol">
          <FlowCard size="sm">
            <section className="fm-blk" aria-label="고지">
              <NoticeRow
                icon={<Mic size={20} aria-hidden="true" />}
                label="녹음과 AI 기록"
                desc={online ? '음성을 녹음하고 AI가 기록지를 만들어요' : '현장 대화를 녹음하고 AI가 기록지를 만들어요'}
              />
              {bandMode === 'none' ? null : <NoticeRow icon={<Activity size={20} aria-hidden="true" />} label="뇌파 측정(LINK BAND를 쓸 때만)" />}
              {online ? <NoticeRow icon={<Video size={20} aria-hidden="true" />} label="영상(카메라를 켤 때만)" /> : null}
              {sessionType === 'meditation' && <div className="fm-rlist" aria-label="클래스 강사팀 열람 고지">
                <p className="fm-ft">클래스 강사팀은 수업을 참관할 수 있어요. 참관 강사는 음성·영상을 송출하거나 수업을 제어하지 않으며, 실시간 개인 뇌파 지표를 볼 수 없어요.</p>
                <p className="fm-ft">리포트 반영을 선택하면 클래스 강사팀이 수업 후 내 기록지와 리포트를 읽을 수 있어요. 전사 원문과 음성·영상 원본은 열람하지 못해요.</p>
                <p className="fm-ft">센터 관리자는 명상 리포트를 읽을 수 있지만 수정하거나 승인할 수 없어요. 상담 본문은 공개되지 않아요.</p>
              </div>}
              <p className="fm-ft hi">{retention}</p>
            </section>
          </FlowCard>
          <FlowCard size="sm">
            <section className="fm-blk" aria-label="리포트 반영 선택">
              <b className="fm-qh">내 기록을 리포트에 반영할까요?</b>
              <div className="fm-aseg" role="radiogroup" aria-label="리포트 반영">
                <button type="button" role="radio" aria-checked={reportChoice === 'excluded'} onClick={() => onReportChoice('excluded')}>반영하지 않아요</button>
                <button type="button" role="radio" aria-checked={reportChoice === 'included'} onClick={() => onReportChoice('included')}>반영해요</button>
              </div>
              <div className="fm-rlist">
                <p className="fm-ft">반영하지 않아도 클래스에는 그대로 참여할 수 있어요</p>
                <p className="fm-ft">이미 보낸 리포트는 되돌릴 수 없어요</p>
                {confirmLine ? <p className="fm-ft hi">{confirmLine}</p> : null}
              </div>
            </section>
          </FlowCard>
        </div>
        <div className="fm-acol">
          <FlowCard size="sm">
            <section className="fm-blk" aria-label="연구 동의">
              <div className="fm-rhead">
                <b className="fm-qh">연구 목적 데이터 활용에 동의할까요? (선택)</b>
                <button type="button" className="fm-check" role="checkbox" aria-checked={researchConsent} onClick={() => onResearchChange(!researchConsent)}>
                  <span className="fm-box"><Check aria-hidden="true" strokeWidth={3} /></span>동의해요
                </button>
              </div>
              {researchSaveFailed ? (
                <p className="fm-failhint" role="status"><CircleAlert size={16} aria-hidden="true" /><span>연구 동의를 저장하지 못했어요. 미동의로 진행해요.</span></p>
              ) : null}
              <div className="fm-rlist">
                <p className="fm-ft">동의하면 비식별 처리한 뇌파·맥박·움직임 데이터와 지표, 암호화한 이름 ID·성별·생년·월이 삭제 기한 없이 계속 보관돼요</p>
                <p className="fm-ft">이메일·전화번호·이름·녹음 내용은 보관하지 않아요</p>
                <p className="fm-ft">동의하지 않아도 클래스에 참여할 수 있어요</p>
                <p className="fm-ft">철회하려면 운영팀에 요청해 주세요</p>
                <p className="fm-ft">비식별 처리해도 다른 정보와 결합하면 본인을 알아볼 가능성이 완전히 없지는 않아요</p>
              </div>
            </section>
          </FlowCard>
        </div>
      </div>
    </MemberFlowFrame>
  );
}
