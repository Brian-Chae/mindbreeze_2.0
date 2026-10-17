// SDD-209 M8 — FM09 컨테이너: 리포트 1탭 신청(회원)·오늘 상태 남기기(입장 자격 phase=after) 상태를 관리한다.
// 비회원은 이메일을 다시 묻지 않는다(자동 발송은 서버 몫). 실패 문구는 서버 원문을 쓰지 않는다.
import { useCallback, useState } from 'react';
import { submitEntryCheckin } from '../../../../lib/api/class-flow';
import type { AxisKey, SamValue } from '../../../../lib/api/checkin';
import { requestReportEmail } from '../../../../lib/api/session';
import { emptySurveyDraft, surveyPayload, type SurveyDraft } from '../../../../lib/class/flow/member-survey';
import { EndView, type EndReportMode, type EndSheet } from './EndView';

interface EndContainerProps {
  sessionId: string;
  credential: string | null;
  participantId: string | null;
  place: 'online' | 'offline';
  title: string;
  duration: string | null;
  reportMode: EndReportMode;
  maskedEmail: string | null;
  /** 로그인 회원 계정 이메일 — 리포트 신청 수신 주소(화면에는 마스킹만 보인다) */
  accountEmail: string | null;
  onHome: () => void;
}

const REPORT_FAILED = '신청하지 못했어요. 잠시 후 다시 시도해 주세요.';
const CHECKIN_FAILED = '저장하지 못했어요. 건너뛰고 계속할 수 있어요.';

export function EndContainer({ sessionId, credential, participantId, accountEmail, onHome, ...rest }: EndContainerProps) {
  const [sheet, setSheet] = useState<EndSheet>('none');
  const [draft, setDraft] = useState<SurveyDraft>(emptySurveyDraft);
  const [working, setWorking] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [checkinDone, setCheckinDone] = useState(false);
  const [reportRequested, setReportRequested] = useState(false);

  const open = useCallback((next: EndSheet): void => {
    setErrorText(null);
    setSheet(next);
  }, []);

  const requestReport = useCallback(async (): Promise<void> => {
    if (working || !participantId || !accountEmail) return;
    if (reportRequested) {
      setSheet('reportsent');
      return;
    }
    setWorking(true);
    setErrorText(null);
    try {
      await requestReportEmail(sessionId, { participant_id: participantId, email: accountEmail, email_verify_token: null });
      setReportRequested(true);
      setSheet('reportsent');
    } catch {
      setErrorText(REPORT_FAILED);
    } finally {
      setWorking(false);
    }
  }, [working, participantId, accountEmail, reportRequested, sessionId]);

  const submitCheckin = useCallback(async (): Promise<void> => {
    if (working || !participantId) return;
    setWorking(true);
    setErrorText(null);
    try {
      await submitEntryCheckin(sessionId, credential, { ...surveyPayload(draft, participantId), phase: 'after' });
      setCheckinDone(true);
      setSheet('none');
    } catch {
      setErrorText(CHECKIN_FAILED);
    } finally {
      setWorking(false);
    }
  }, [working, participantId, sessionId, credential, draft]);

  return (
    <EndView
      {...rest}
      sheet={sheet}
      checkinDraft={draft}
      checkinDone={checkinDone}
      working={working}
      errorText={errorText}
      onOpenReport={() => open(reportRequested ? 'reportsent' : 'report')}
      onOpenCheckin={() => open('checkin')}
      onCloseSheet={() => open('none')}
      onRequestReport={() => void requestReport()}
      onSelectAxis={(axis: AxisKey, value: SamValue) => setDraft((prev) => ({ ...prev, answers: { ...prev.answers, [axis]: value } }))}
      onNote={(note) => setDraft((prev) => ({ ...prev, note: note.slice(0, 200) }))}
      onSubmitCheckin={() => void submitCheckin()}
      onHome={onHome}
    />
  );
}
