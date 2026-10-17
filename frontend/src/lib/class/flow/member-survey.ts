// SDD-209 M3 — FM06b 오늘의 상태(집중·편안함·감정 3축 5단계 + 상담사에게 전할 말). 점수가 아니라 느낌 라벨만 보여 준다.
import { SAM_AXES, type AxisKey, type SamValue } from '../../api/checkin';

export const SURVEY_NOTE_MAX = 200;

export type SurveyAnswers = Record<AxisKey, SamValue | null>;

export interface SurveyDraft {
  answers: SurveyAnswers;
  note: string;
}

export function emptySurveyDraft(): SurveyDraft {
  return { answers: { arousal: null, valence: null, emotion: null }, note: '' };
}

export interface SurveyQuestion {
  axis: AxisKey;
  chip: string;
  heading: string;
  options: ReadonlyArray<{ value: SamValue; label: string }>;
}

const HEADINGS: Record<AxisKey, string> = {
  arousal: '지금 집중은 어떤가요?',
  valence: '지금 몸은 얼마나 편안한가요?',
  emotion: '지금 기분은 어떤가요?',
};

export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = SAM_AXES.map((axis) => ({
  axis: axis.key,
  chip: axis.label,
  heading: HEADINGS[axis.key],
  options: ([1, 2, 3, 4, 5] as const).map((value) => ({ value, label: axis.steps[value] })),
}));

export const NOTE_CHIP = '전할 말';

export function surveyHasValue(draft: SurveyDraft): boolean {
  const { arousal, valence, emotion } = draft.answers;
  return arousal !== null || valence !== null || emotion !== null || draft.note.trim().length > 0;
}

export interface SurveyPayload {
  phase: 'before';
  arousal: SamValue | null;
  valence: SamValue | null;
  emotion: SamValue | null;
  note: string | null;
  participant_id: string;
}

/** 요청 바디. 미입력은 0·빈 문자열이 아니라 null 로 보존한다 */
export function surveyPayload(draft: SurveyDraft, participantId: string): SurveyPayload {
  const note = draft.note.trim().slice(0, SURVEY_NOTE_MAX);
  return {
    phase: 'before',
    arousal: draft.answers.arousal,
    valence: draft.answers.valence,
    emotion: draft.answers.emotion,
    note: note.length > 0 ? note : null,
    participant_id: participantId,
  };
}
