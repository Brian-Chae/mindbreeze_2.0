// SDD-209 M3 — FM06b 오늘의 상태 진행(질문 1~4) + 저장. 저장 실패·건너뛰기 어느 쪽도 입장을 막지 않는다.
import { useCallback, useRef, useState } from 'react';
import { submitEntryCheckin } from '../lib/api/class-flow';
import type { AxisKey, SamValue } from '../lib/api/checkin';
import { SURVEY_NOTE_MAX, emptySurveyDraft, surveyHasValue, surveyPayload, type SurveyDraft } from '../lib/class/flow/member-survey';
import type { SurveyOutcome } from '../lib/class/flow/member-prep';

const SAVE_FAILED = '저장하지 못했어요. 건너뛰고 계속할 수 있어요.';

interface UseEntrySurveyOptions {
  sessionId: string;
  credential: string | null;
  participantId: string | null;
}

export interface UseEntrySurveyResult {
  question: 1 | 2 | 3 | 4;
  draft: SurveyDraft;
  saving: boolean;
  errorText: string | null;
  select: (axis: AxisKey, value: SamValue) => void;
  setNote: (note: string) => void;
  /** 다음 질문으로 — 마지막(전할 말)이면 저장하고 결과를 onDone 으로 알린다 */
  next: (onDone: (outcome: SurveyOutcome) => void) => Promise<void>;
  skip: (onDone: (outcome: SurveyOutcome) => void) => void;
  /** 이전 질문으로. 첫 질문이면 false(단계 이동은 호출부) */
  back: () => boolean;
  /** 단계에 다시 들어올 때 첫 질문부터(답은 유지) */
  restart: () => void;
}

export function useEntrySurvey({ sessionId, credential, participantId }: UseEntrySurveyOptions): UseEntrySurveyResult {
  const [question, setQuestion] = useState<1 | 2 | 3 | 4>(1);
  const [draft, setDraft] = useState<SurveyDraft>(emptySurveyDraft);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const select = useCallback((axis: AxisKey, value: SamValue): void => {
    setDraft((prev) => ({ ...prev, answers: { ...prev.answers, [axis]: value } }));
  }, []);

  const setNote = useCallback((note: string): void => {
    setDraft((prev) => ({ ...prev, note: note.slice(0, SURVEY_NOTE_MAX) }));
  }, []);

  const next = useCallback(
    async (onDone: (outcome: SurveyOutcome) => void): Promise<void> => {
      if (question < 4) {
        setQuestion((q) => (q === 1 ? 2 : q === 2 ? 3 : 4));
        return;
      }
      const current = draftRef.current;
      if (!surveyHasValue(current) || !participantId) {
        onDone('skipped');
        return;
      }
      setSaving(true);
      setErrorText(null);
      try {
        await submitEntryCheckin(sessionId, credential, surveyPayload(current, participantId));
        onDone('done');
      } catch {
        setErrorText(SAVE_FAILED);
      } finally {
        setSaving(false);
      }
    },
    [question, sessionId, credential, participantId],
  );

  const skip = useCallback((onDone: (outcome: SurveyOutcome) => void): void => {
    setErrorText(null);
    onDone('skipped');
  }, []);

  const back = useCallback((): boolean => {
    if (question === 1) return false;
    setErrorText(null);
    setQuestion((q) => (q === 4 ? 3 : q === 3 ? 2 : 1));
    return true;
  }, [question]);

  const restart = useCallback((): void => {
    setQuestion(1);
    setErrorText(null);
  }, []);

  return { question, draft, saving, errorText, select, setNote, next, skip, back, restart };
}
