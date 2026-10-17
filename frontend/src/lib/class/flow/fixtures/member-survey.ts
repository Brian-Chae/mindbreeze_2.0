// SDD-209 M3 — FM06b 오늘의 상태 케이스 픽스처(q1~q4 · 시작 후 시트).
import { createElement } from 'react';
import { StartedSheet } from '../../../../components/class/flow/member/StartedSheet';
import { SurveyStepView } from '../../../../components/class/flow/member/SurveyStepView';
import { buildSteps } from '../member-machine';
import { remainingPrepLabels } from '../member-prep';
import { emptySurveyDraft, type SurveyDraft } from '../member-survey';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { prepCaseOf } from './member-common';

const noop = (): void => undefined;

const REFS = [
  'on-group-opt-member-q1', 'on-group-opt-member-q2', 'on-group-opt-member-q3', 'on-group-opt-member-q4',
  'off-group-none-member-q1', 'on-solo-req-member-q4', 'on-group-opt-member-q2-started', 'off-group-none-member-q1-started',
];

/** 시안 시연 선택값: q1 = 집중, q2 = 보통, q3 = 아직, q4 = 전할 말 20자 */
function draftFor(question: 1 | 2 | 3 | 4): SurveyDraft {
  const base = emptySurveyDraft();
  if (question === 1) return { ...base, answers: { ...base.answers, arousal: 4 } };
  if (question === 2) return { ...base, answers: { ...base.answers, valence: 3 } };
  if (question === 4) return { ...base, note: '목이 조금 불편해서 소리를 내기 어려워요.' };
  return base;
}

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const key of REFS) {
  const c = prepCaseOf(`FM06b:${key}`);
  const question = Number(/-q([1-4])/.exec(key)?.[1] ?? 1) as 1 | 2 | 3 | 4;
  flowCases[`FM06b:${key}`] = {
    description: `${c.place === 'online' ? '온라인' : '오프라인'}·${c.size === 'group' ? '그룹' : '1:1'}·밴드 ${c.bandMode} · ${question === 4 ? '전할 말' : `질문 ${question}`}${c.started ? ' · 시작 후 시트' : ''}`,
    render: (ctx: FlowCaseContext) => {
      const steps = buildSteps(c.place, c.bandMode);
      return createElement(SurveyStepView, {
        question, draft: draftFor(question), steps: { total: steps.length, current: steps.indexOf('b') }, place: c.place,
        saving: false, errorText: null, backdropSrc: ctx.backdropSrc,
        startedSheet: c.started
          ? createElement(StartedSheet, { open: true, remaining: remainingPrepLabels(steps, 'b'), onEnterNow: noop, onContinue: noop })
          : null,
        sheetOpen: c.started,
        onSelect: noop, onNote: noop, onNext: noop, onSkip: noop, onBack: noop, onExit: noop,
      });
    },
  };
}
