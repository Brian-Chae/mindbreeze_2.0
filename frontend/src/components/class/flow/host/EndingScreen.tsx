// SDD-209 H8 — FH09 종료 확인 시트 + 종료 씬(같은 화면에서 리포트 진행 4단계). D-5① 독립 커밋.
import { AlertTriangle, CheckCircle2, Clock, FileText, Flag, Loader2, MinusCircle, Save, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { endConfirmLines, type EndStepUi, type EndingView } from '../../../../lib/class/flow/host-ending-model';
import { FlowButton, FlowChip, FlowSheet } from '../shared/flow-primitives';
import { HostFlowFrame, type HostFrameLeft } from './HostFlowFrame';

const STEP_ICON: Readonly<Record<EndStepUi, typeof Clock>> = { done: CheckCircle2, now: Loader2, todo: Clock, skip: MinusCircle, fail: AlertTriangle };

export interface EndConfirmProps {
  title: string;
  sub: string;
  headcount: number | null;
  busy?: boolean;
  left: HostFrameLeft;
  backdropSrc?: string;
  onEnd: () => void;
  onContinue: () => void;
}

/** 종료 확인: 진행 화면 위에 뜨는 시트. 끝내는 중에는 두 버튼 모두 잠근다 */
export function EndConfirmScreen({ title, sub, headcount, busy = false, left, backdropSrc, onEnd, onContinue }: EndConfirmProps) {
  const icons = [Save, FileText, Users];
  return (
    <HostFlowFrame
      title={title}
      sub={sub}
      left={left}
      backdropSrc={backdropSrc}
      sheetOpen
      sheet={
        <FlowSheet
          open
          title="클래스 종료 확인"
          dismissOnOutside={false}
          onClose={onContinue}
          footer={
            <div className="fhb-act">
              <FlowButton kind="danger" disabled={busy} aria-busy={busy} onClick={onEnd}>
                {busy ? <Loader2 size={20} aria-hidden="true" /> : <Flag size={20} aria-hidden="true" />}
                {busy ? '끝내는 중이에요' : '클래스 끝내기'}
              </FlowButton>
              <FlowButton kind="soft" disabled={busy} onClick={onContinue}>계속 진행</FlowButton>
            </div>
          }
        >
          <div className="fhb-ctr">
            <span className="fhb-ico lg"><Flag size={24} aria-hidden="true" /></span>
            <h2>클래스를 끝낼까요?</h2>
          </div>
          <div className="fhb-msgs">
            {endConfirmLines(headcount).map((line, i) => {
              const Icon = icons[i] ?? Users;
              return (
                <div className="fhb-row" key={line}>
                  <span className="fhb-ico"><Icon size={20} aria-hidden="true" /></span>
                  <div className="fhb-rt"><b style={{ fontSize: 13, lineHeight: '20px', fontWeight: 600 }}>{line}</b></div>
                </div>
              );
            })}
          </div>
        </FlowSheet>
      }
    >
      {null}
    </HostFlowFrame>
  );
}

export interface EndingSceneProps {
  view: EndingView;
  title: string;
  left: HostFrameLeft;
  backdropSrc?: string;
  onOpenRecord: () => void;
  isClassSession?: boolean;
}

/** 종료 씬: 같은 화면에서 4단계 진행 + `기록 보기`. 화면을 닫아도 리포트는 계속 만들어진다 */
export function EndingScene({ view, title, left, backdropSrc, onOpenRecord, isClassSession = view.isClassSession ?? false }: EndingSceneProps) {
  const body: ReactNode = (
    <>
      <div className="fhb-scene">
        <span className="fhb-ico lg ok"><Flag size={24} aria-hidden="true" /></span>
        <h1 className="fl-h1">{view.heading}</h1>
        <p className="fl-sub">{view.sub}</p>
      </div>
      <div className="fl-card strong fhb-endcard" data-pz="flow-card" data-size="sm">
        <div className="fhb-endhead">
          <b>{view.cardTitle}</b>
          {view.done ? <FlowChip tone="ok" icon={<CheckCircle2 size={16} />}>완료</FlowChip> : <FlowChip tone="neutral" icon={<Clock size={16} />}>보통 3~5분</FlowChip>}
        </div>
        <div className="fhb-bar" role="progressbar" aria-label="리포트 만드는 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.pct} style={{ ['--p' as string]: `${view.pct}%` }}><i /></div>
        <div className="fhb-steps" role="list">
          {view.steps.map((s) => {
            const Icon = STEP_ICON[s.ui];
            return (
              <div key={s.key} role="listitem" className={`fhb-step ${s.ui}`} data-step={s.key}>
                <Icon aria-hidden="true" />
                <span className="tx">{s.label}</span>
                <span className="st">{s.word}</span>
              </div>
            );
          })}
        </div>
      </div>
      {view.reasonText ? (
        <div className="fhb-row" role="status">
          <span className="fhb-ico warn"><AlertTriangle size={20} aria-hidden="true" /></span>
          <div className="fhb-rt"><b>{view.reasonText}</b></div>
        </div>
      ) : null}
      {view.excludedNotice ? (
        <div className="fhb-row">
          <span className="fhb-ico"><Users size={20} aria-hidden="true" /></span>
          <div className="fhb-rt"><b>{view.excludedNotice.title}</b><span>{view.excludedNotice.sub}</span></div>
        </div>
      ) : null}
    </>
  );
  return (
    <HostFlowFrame
      title="클래스 종료"
      sub={title}
      left={left}
      backdropSrc={backdropSrc}
      foot={
        <>
          <FlowButton kind="primary" onClick={onOpenRecord}><FileText size={20} aria-hidden="true" />{isClassSession ? '회차 요약 보기' : '기록 보기'}</FlowButton>
          <p className="fhb-fnote">{isClassSession && view.done ? '리포트는 회차 요약에서 언제든 볼 수 있어요' : view.foot}</p>
        </>
      }
    >
      {body}
    </HostFlowFrame>
  );
}
