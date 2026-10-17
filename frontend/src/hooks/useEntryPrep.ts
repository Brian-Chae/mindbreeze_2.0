// SDD-209 M2 — 준비 마법사 초안 + 서버 저장(리포트 반영 선택·연구 동의). 저장 실패가 진행을 막는 일은 없다.
import { useCallback, useRef, useState } from 'react';
import { setReportChoice, setResearchConsent } from '../lib/api/class-flow';
import {
  REPORT_NOTICE_VERSION, RESEARCH_NOTICE_VERSION, emptyPrepDraft, type PrepDraft, type ReportChoice,
} from '../lib/class/flow/member-prep';

interface UseEntryPrepOptions {
  sessionId: string;
  credential: string | null;
  participantId: string | null;
}

export interface UseEntryPrepResult {
  draft: PrepDraft;
  patch: (partial: Partial<PrepDraft>) => void;
  chooseReport: (choice: Exclude<ReportChoice, null>) => void;
  /** 확인하고 계속하기 — 고지를 확인했다는 증빙과 함께 선택을 1회 보낸다. 실패해도 던지지 않는다 */
  commitReportChoice: () => Promise<void>;
  /** 연구 동의 체크 — 즉시 저장하고, 실패하면 이전 값(미동의)으로 두고 안내만 한다 */
  changeResearch: (consented: boolean) => Promise<void>;
}

export function useEntryPrep({ sessionId, credential, participantId }: UseEntryPrepOptions): UseEntryPrepResult {
  const [draft, setDraft] = useState<PrepDraft>(emptyPrepDraft);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const patch = useCallback((partial: Partial<PrepDraft>): void => {
    setDraft((prev) => {
      const next = { ...prev, ...partial };
      draftRef.current = next;
      return next;
    });
  }, []);

  const chooseReport = useCallback((choice: Exclude<ReportChoice, null>): void => patch({ reportChoice: choice, reportSaveFailed: false }), [patch]);

  const commitReportChoice = useCallback(async (): Promise<void> => {
    if (!participantId) return;
    try {
      await setReportChoice(sessionId, credential, {
        participantId,
        reportIncluded: draftRef.current.reportChoice === 'included',
        noticeAcknowledged: true,
        noticeVersion: REPORT_NOTICE_VERSION,
      });
      patch({ reportSaveFailed: false });
    } catch {
      patch({ reportSaveFailed: true });
    }
  }, [sessionId, credential, participantId, patch]);

  const changeResearch = useCallback(
    async (consented: boolean): Promise<void> => {
      const previous = draftRef.current.researchConsent;
      patch({ researchConsent: consented, researchSaveFailed: false });
      if (!participantId) return;
      try {
        await setResearchConsent(sessionId, credential, { participantId, consented, noticeVersion: RESEARCH_NOTICE_VERSION });
      } catch {
        patch({ researchConsent: previous, researchSaveFailed: true });
      }
    },
    [sessionId, credential, participantId, patch],
  );

  return { draft, patch, chooseReport, commitReportChoice, changeResearch };
}
