// SDD-209 M3 — FM06b 오늘의 상태. 한 번에 한 축씩 느낌 라벨 5단계로 고르고, 마지막에 상담사에게 전할 말(선택).
// 건너뛰어도 입장은 막히지 않는다.
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AxisKey, SamValue } from '../../../../lib/api/checkin';
import { NOTE_CHIP, SURVEY_NOTE_MAX, SURVEY_QUESTIONS, type SurveyDraft } from '../../../../lib/class/flow/member-survey';
import { FlowButton, FlowH1, FlowSub } from '../shared/flow-primitives';
import { MemberFlowFrame, type MemberFlowSteps } from './MemberFlowFrame';

export interface SurveyStepViewProps {
  /** 1~3 = 축 질문, 4 = 전할 말 */
  question: 1 | 2 | 3 | 4;
  draft: SurveyDraft;
  steps: MemberFlowSteps;
  place?: 'online' | 'offline';
  saving: boolean;
  errorText: string | null;
  backdropSrc?: string;
  /** 시작 후 시트(StartedSheet) — 열려 있으면 하단 푸터는 inert */
  startedSheet?: ReactNode;
  sheetOpen?: boolean;
  onSelect: (axis: AxisKey, value: SamValue) => void;
  onNote: (note: string) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
  onExit: () => void;
}

export function SurveyStepView({
  question, draft, steps, place = 'online', saving, errorText, backdropSrc, startedSheet = null, sheetOpen = false,
  onSelect, onNote, onNext, onSkip, onBack, onExit,
}: SurveyStepViewProps) {
  const chips = [...SURVEY_QUESTIONS.map((q) => q.chip), NOTE_CHIP];
  const axes = (
    <div className="fm-axes" role="list" aria-label="체크인 문항 진행">
      {chips.map((chip, i) => (
        <div key={chip} className="fm-ax" role="listitem" aria-current={i === question - 1 ? 'step' : undefined} data-state={i < question - 1 ? 'done' : i === question - 1 ? 'on' : undefined}>
          {chip}
          <i />
        </div>
      ))}
    </div>
  );
  const isNote = question === 4;
  const current = isNote ? null : SURVEY_QUESTIONS[question - 1]!;
  const selected = current ? draft.answers[current.axis] : null;
  return (
    <MemberFlowFrame
      wizard
      survey
      place={place}
      backdropSrc={backdropSrc}
      steps={steps}
      onBack={onBack}
      onExit={onExit}
      sheet={startedSheet}
      sheetOpen={sheetOpen}
      foot={
        <>
          {errorText ? <div className="fm-err" role="alert"><CircleAlert size={16} aria-hidden="true" />{errorText}</div> : null}
          <FlowButton kind="primary" disabled={saving || (!isNote && selected === null)} onClick={onNext}>
            {isNote ? '남기고 계속하기' : '다음'}
          </FlowButton>
          <FlowButton kind="ghost" disabled={saving} onClick={onSkip}>건너뛰기</FlowButton>
        </>
      }
    >
      <div className="fm-head">
        <FlowH1>{current ? current.heading : '상담사에게 전하고 싶은 말이 있나요?'}</FlowH1>
        <FlowSub>{current ? '가장 가까운 느낌을 하나 골라 주세요.' : '선택이에요. 적지 않아도 괜찮아요.'}</FlowSub>
      </div>
      {axes}
      {current ? (
        <div className="fm-opts" role="radiogroup" aria-label={current.chip}>
          {current.options.map((option, index) => (
            <button
              key={option.value} type="button" role="radio" className="fm-opt" aria-checked={selected === option.value}
              tabIndex={selected === option.value || (selected === null && index === 0) ? 0 : -1}
              onKeyDown={(event) => {
                const last = current.options.length - 1;
                const target = event.key === 'Home' ? 0 : event.key === 'End' ? last
                  : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % (last + 1)
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + last) % (last + 1) : null;
                if (target === null) return;
                event.preventDefault();
                onSelect(current.axis, current.options[target]!.value);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[target]?.focus();
              }}
              onClick={() => onSelect(current.axis, option.value)}
            >
              <span className="fm-radio" />
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="fm-field">
          <textarea
            className="fm-ta" maxLength={SURVEY_NOTE_MAX} aria-label="상담사에게 전하고 싶은 말" placeholder="예: 오늘 목이 조금 불편해서 소리를 내기 어려워요"
            value={draft.note} onChange={(e) => onNote(e.target.value)}
          />
          <p className="fm-count">{draft.note.length} / {SURVEY_NOTE_MAX}</p>
        </div>
      )}
    </MemberFlowFrame>
  );
}
