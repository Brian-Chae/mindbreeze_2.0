// SDD-209 M2 — FM06a 시작 전에 확인해 주세요: 고지 + 리포트 반영 선택 + 연구 동의(별도 블록).
// 어느 선택이든(고르지 않아도, 저장에 실패해도) 주 버튼은 항상 활성이고 입장·녹음·영상·뇌파 업로드를 막지 않는다.
import { Activity, Check, CircleAlert, Clock, Mic, Users, Video } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ReportChoice } from '../../../../lib/class/flow/member-prep';
import type { FlowBandMode, FlowPlace, FlowSize } from '../../../../lib/class/flow/types';
import { FlowButton, FlowH1, FlowSheet, FlowSub } from '../shared/flow-primitives';
import { MemberFlowFrame, type MemberFlowSteps } from './MemberFlowFrame';
import { MethodChips } from './MethodChips';
import { PrivacyPolicyLink } from '../../../legal/PrivacyPolicyLink';
import './notice-step.css';

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
  /** SDD-220 — AI 기능 공개 여부. false 면 "AI 기록" 문구 없이 "녹음"만 안내한다(기본 true = 기존 문구) */
  aiEnabled?: boolean;
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
  sessionType, place, size, bandMode, title, hostName, retentionDays, reportChoice, researchConsent, researchSaveFailed, steps, backdropSrc, aiEnabled = true,
  onReportChoice, onResearchChange, onNext, onBack, onExit,
}: NoticeStepViewProps) {
  const [detail, setDetail] = useState<'record' | 'report' | 'research' | null>(null);
  const online = place === 'online';
  const closeDetail = () => setDetail(null);
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
      colClassName="fm-notice"
      sheetMode="bottom"
      sheetOpen={detail !== null}
      sheet={
        <FlowSheet open={detail !== null} sheetMode="bottom"
          title={detail === 'record' ? '기록과 열람 안내' : detail === 'report' ? '리포트 반영 안내' : '연구 목적 데이터 활용'}
          onClose={closeDetail} footer={<FlowButton onClick={closeDetail}>확인했어요</FlowButton>}
        >
          <div className="notice-detail">
            {detail === 'record' ? <section aria-label="고지">
              <h3>기록되는 것</h3>
              <NoticeRow
                icon={<Mic size={20} aria-hidden="true" />}
                label={aiEnabled ? '녹음과 AI 기록' : '녹음'}
                desc={aiEnabled
                  ? (online ? '음성을 녹음하고 AI가 기록지를 만들어요' : '현장 대화를 녹음하고 AI가 기록지를 만들어요')
                  : (online ? '음성을 녹음해 클래스 기록으로 보관해요' : '현장 대화를 녹음해 클래스 기록으로 보관해요')}
              />
              {bandMode === 'none' ? null : <NoticeRow icon={<Activity size={20} aria-hidden="true" />} label="뇌파 측정(LINK BAND를 쓸 때만)" />}
              {online ? <NoticeRow icon={<Video size={20} aria-hidden="true" />} label="영상(카메라를 켤 때만)" /> : null}
              {sessionType === 'meditation' && <div className="fm-rlist" aria-label="클래스 강사팀 열람 고지">
                <h3>볼 수 있는 사람</h3>
                <p className="fm-ft">이 클래스의 진행 지도사와 등록된 다른 지도사는 함께 진행하기 위해 기록지와 리포트를 읽을 수 있어요. 진행하지 않는 지도사에게는 전사 원문·음성 및 영상 원본·실시간 개인 뇌파 지표를 제공하지 않아요. 참관하는 지도사는 송출·녹음·발언권을 조작할 수 없어요.</p>
                <p className="fm-ft">센터 관리자는 명상 리포트를 읽을 수 있지만 수정하거나 승인할 수 없어요. 상담 본문은 공개되지 않아요.</p>
              </div>}
              <h3>보관 기간</h3>
              <p className="fm-ft hi">{retention}</p>
            </section> : detail === 'report' ? <section>
              <h3>내 기록을 리포트에 반영할까요?</h3>
              <p>반영하지 않아도 클래스에는 그대로 참여할 수 있어요</p>
              <p>이미 보낸 리포트는 되돌릴 수 없어요</p>
              <p>고르지 않으면 반영하지 않는 것으로 진행돼요</p>
              {reportChoice === 'included' ? <p>{confirmLine}</p> : null}
              <h3>선택을 바꾸려면</h3>
              <p>리포트 반영은 클래스가 끝나기 전까지 바꿀 수 있어요.</p>
            </section> : detail === 'research' ? <section>
              <h3>연구 목적 데이터 활용에 동의할까요? (선택)</h3>
                <p className="fm-ft">동의하면 비식별 처리한 뇌파·맥박·움직임 데이터와 지표, 암호화한 이름 ID·성별·생년·월이 삭제 기한 없이 계속 보관돼요</p>
                <p className="fm-ft">이메일·전화번호·이름·녹음 내용은 보관하지 않아요</p>
                <p className="fm-ft">동의하지 않아도 클래스에 참여할 수 있어요</p>
                <p className="fm-ft">철회하려면 운영팀에 요청해 주세요</p>
                <p className="fm-ft">비식별 처리해도 다른 정보와 결합하면 본인을 알아볼 가능성이 완전히 없지는 않아요</p>

            </section> : null}
          </div>
        </FlowSheet>
      }
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
      <div className="notice-cards">
        <section className="notice-card notice-record" aria-label="고지 요약">
          <div className="notice-cardhead"><h2>기록 안내</h2><button type="button" className="notice-more" aria-label="기록 안내 자세히 보기" onClick={() => setDetail('record')}>자세히 보기 ↗</button></div>
          <div className="notice-tiles" data-access={sessionType === 'meditation' ? 'true' : 'false'}>
            <div><Mic aria-hidden="true" /><small>기록되는 것</small><strong>{['녹음', ...(bandMode === 'none' ? [] : ['뇌파']), ...(online ? ['영상'] : [])].join('·')}</strong></div>
            {sessionType === 'meditation' ? <div><Users aria-hidden="true" /><small>볼 수 있는 사람</small><strong>지도사·관리자</strong></div> : null}
            <div><Clock aria-hidden="true" /><small>원본 보관</small><strong>{retentionDays === null ? '정해진 기간 후 삭제' : `${retentionDays}일 후 삭제`}</strong></div>
          </div>
          <div className="notice-conditions">
            <div>{bandMode === 'none' ? null : <span>뇌파: 밴드 착용 시에만</span>}{online ? <span>영상: 카메라 켤 때만</span> : null}</div>
            {sessionType === 'meditation' ? <p>관리자는 명상 리포트만 열람</p> : null}
          </div>
        </section>
        <section className="notice-card" aria-label="리포트 반영 선택">
          <div className="notice-cardhead"><h2>리포트 반영</h2><button type="button" className="notice-more" aria-label="리포트 반영 자세히 보기" onClick={() => setDetail('report')}>자세히 보기 ↗</button></div>
          <div className="fm-aseg" role="radiogroup" aria-label="리포트 반영" onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const choice = event.target instanceof HTMLElement && event.target.dataset.choice === 'excluded' ? 'included' : 'excluded';
            onReportChoice(choice);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)?.focus();
          }}>
            <button type="button" role="radio" data-choice="excluded" tabIndex={reportChoice === 'included' ? -1 : 0} aria-checked={reportChoice === 'excluded'} onClick={() => onReportChoice('excluded')}>반영하지 않아요</button>
            <button type="button" role="radio" data-choice="included" tabIndex={reportChoice === 'included' ? 0 : -1} aria-checked={reportChoice === 'included'} onClick={() => onReportChoice('included')}>반영해요</button>
          </div>
          <p className="notice-report-note">{confirmLine ?? '반영하지 않아도 참여할 수 있어요'}</p>
        </section>
        <section className="notice-card" aria-label="연구 동의">
          <div className="notice-cardhead"><h2>연구 데이터 활용 <span>선택</span></h2><button type="button" className="notice-more" aria-label="연구 데이터 활용 자세히 보기" onClick={() => setDetail('research')}>자세히 보기 ↗</button></div>
          <p className="notice-research-copy">비식별 뇌파·맥박·움직임 데이터와 지표,<br />암호화한 이름 ID·성별·생년·월을<br /><strong>삭제 기한 없이 보관</strong><br />철회: 운영팀 요청 · 미동의도 참여 가능</p>
          <button type="button" className="fm-check notice-consent" role="checkbox" aria-checked={researchConsent} onClick={() => onResearchChange(!researchConsent)}>
            <span className="fm-box"><Check aria-hidden="true" strokeWidth={3} /></span>동의해요 <span>(선택)</span>
          </button>
          {researchSaveFailed ? <p className="fm-failhint" role="status"><CircleAlert size={16} aria-hidden="true" /><span>연구 동의를 저장하지 못했어요. 미동의로 진행해요.</span></p> : null}
        </section>
      </div>
    </MemberFlowFrame>
  );
}
