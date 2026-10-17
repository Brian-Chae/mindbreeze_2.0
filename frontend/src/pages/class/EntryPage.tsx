// SDD-209 M1 — `/class/:sessionId/enter` 참가자 입장 흐름 오케스트레이터(입장 자격 기반, 로그인 불필요).
// FM05 입장 확인 → (M2~M5 준비 마법사) → (M6 시작 대기) → (M7 대기열) → 진행 화면 → (M8 종료) 를 하나의 상태 머신으로 돌린다.
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EntryConfirmView } from '../../components/class/flow/member/EntryConfirmView';
import { BandStepContainer } from '../../components/class/flow/member/BandStepContainer';
import { MemberStateScreen } from '../../components/class/flow/member/MemberStateScreen';
import { NoticeStepView } from '../../components/class/flow/member/NoticeStepView';
import { ReadySummaryView } from '../../components/class/flow/member/ReadySummaryView';
import { StartedSheet } from '../../components/class/flow/member/StartedSheet';
import { SurveyStepView } from '../../components/class/flow/member/SurveyStepView';
import { useEntryPrep } from '../../hooks/useEntryPrep';
import { useEntryState } from '../../hooks/useEntryState';
import { useEntrySurvey } from '../../hooks/useEntrySurvey';
import { clearEntry, enterInvitedSession, entryFromResult, loadEntry, saveEntry, type StoredEntry } from '../../lib/api/class-flow';
import { formatStartLabel, formatWhen } from '../../lib/class/flow/member-format';
import { takeEntryHandoff } from '../../lib/class/flow/member-handoff';
import {
  buildSteps, deriveEnterStage, deriveFlowStateKind, entryReducer, initialEntryState, startedSheetApplies, type FlowStateKind,
} from '../../lib/class/flow/member-machine';
import { buildSummaryRows, parseRetentionDays, remainingPrepLabels, type SurveyOutcome } from '../../lib/class/flow/member-prep';
import type { FlowBandMode } from '../../lib/class/flow/types';
import { useAuthStore } from '../../stores/authStore';

const RETENTION_DAYS = parseRetentionDays(import.meta.env.VITE_RETENTION_RAW_DAYS as string | undefined);

function bandModeOf(mode: string | undefined): FlowBandMode {
  return mode === 'none' ? 'none' : mode === 'required' ? 'req' : 'opt';
}

export default function EntryPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [entry, setEntry] = useState<StoredEntry | null>(() => loadEntry(sessionId));
  const [entryChecked, setEntryChecked] = useState(entry !== null);
  const [machine, dispatch] = useReducer(entryReducer, undefined, initialEntryState);
  const [handoffName] = useState(() => takeEntryHandoff(sessionId)?.displayName ?? '');
  const prep = useEntryPrep({ sessionId, credential: entry?.credential ?? null, participantId: entry?.participantId ?? null });
  const survey = useEntrySurvey({ sessionId, credential: entry?.credential ?? null, participantId: entry?.participantId ?? null });
  // 시작 후 시트에서 `준비 이어서 하기`를 누르면 이후 단계에서는 다시 띄우지 않는다
  const [startedDismissed, setStartedDismissed] = useState(false);

  // 초대받은 로그인 회원의 편의 입장: 저장된 자격이 없으면 초대 행으로 같은 자격을 받는다(실패하면 만료 안내)
  useEffect(() => {
    if (entry || !sessionId || !isAuthenticated) {
      setEntryChecked(true);
      return undefined;
    }
    let cancelled = false;
    void enterInvitedSession(sessionId)
      .then((result) => {
        if (cancelled) return;
        const next = entryFromResult(result);
        if (next) {
          saveEntry(next);
          setEntry(next);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setEntryChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [entry, sessionId, isAuthenticated]);

  const terminalState = machine.phase === 'state' && (machine.stateKind === 'cancelled' || machine.stateKind === 'closed' || machine.stateKind === 'entry-expired');
  const polling = entry !== null && machine.phase !== 'end' && !terminalState;
  const { state: serverState, error: pollError, refresh } = useEntryState({
    sessionId, credential: entry?.credential ?? null, enabled: polling,
  });

  // 서버 상태 → 머신
  useEffect(() => {
    if (!serverState) return;
    dispatch({ type: 'sync', stage: deriveEnterStage({ status: serverState.status, isWaitlisted: serverState.is_waitlisted }) });
  }, [serverState]);

  // 만료·종료 같은 확정 오류는 상태 화면으로, 일시적 끊김은 화면을 유지한 채 안내만 한다
  const failureKind = useMemo<FlowStateKind | null>(
    () => (pollError ? deriveFlowStateKind({ error: pollError, online: typeof navigator === 'undefined' ? true : navigator.onLine }) : null),
    [pollError],
  );
  const connectionLost = failureKind === 'offline';
  useEffect(() => {
    if (failureKind && failureKind !== 'offline' && failureKind !== 'error') {
      if (failureKind === 'entry-expired') clearEntry(sessionId);
      dispatch({ type: 'showState', kind: failureKind });
    }
  }, [failureKind, sessionId]);
  useEffect(() => {
    if (entryChecked && !entry) dispatch({ type: 'showState', kind: 'entry-expired' });
  }, [entryChecked, entry]);

  const info = entry?.classInfo;
  const title = info?.title ?? '클래스';
  const homePath = isAuthenticated ? '/app' : '/';
  const listPath = isAuthenticated ? '/app/sessions' : '/';
  const displayName = handoffName || (isAuthenticated && user ? user.name : '참가자');

  const retry = useCallback(() => {
    dispatch({ type: 'resume' });
    void refresh();
  }, [refresh]);

  const showKind: FlowStateKind | null = machine.phase === 'state' ? machine.stateKind : connectionLost && machine.phase !== 'live' ? 'offline' : null;
  if (showKind) {
    const onPrimary = (): void => {
      if (showKind === 'cancelled' || showKind === 'closed') navigate(listPath);
      else if (showKind === 'entry-expired') navigate('/join', { replace: true });
      else retry();
    };
    const onSecondary = (): void => {
      navigate(showKind === 'offline' || showKind === 'entry-expired' ? '/' : homePath);
    };
    return (
      <MemberStateScreen
        kind={showKind} classTitle={title} whenLabel={formatWhen(info?.scheduledAt ?? null)}
        onPrimary={onPrimary} onSecondary={onSecondary}
      />
    );
  }

  if (!info || !entry) return null;
  const place = info.locationType;
  const size = info.participantMode === 'group' ? 'group' : 'solo';
  const bandMode = bandModeOf(info.linkbandMode);
  const steps = buildSteps(place, bandMode);
  const stepsView = { total: steps.length, current: Math.max(0, steps.indexOf(machine.step)) };
  const exit = (): void => {
    navigate(homePath);
  };

  if (machine.phase === 'wizard' && machine.step === 'a') {
    return (
      <NoticeStepView
        place={place} size={size} bandMode={bandMode} title={title} hostName={info.hostName} retentionDays={RETENTION_DAYS}
        reportChoice={prep.draft.reportChoice} researchConsent={prep.draft.researchConsent} researchSaveFailed={prep.draft.researchSaveFailed}
        steps={stepsView}
        onReportChoice={prep.chooseReport}
        onResearchChange={(next) => void prep.changeResearch(next)}
        onNext={() => {
          void prep.commitReportChoice();
          dispatch({ type: 'next', steps });
        }}
        onBack={() => dispatch({ type: 'back', steps })}
        onExit={exit}
      />
    );
  }
  const startedOpen = machine.stage === 'started' && !startedDismissed && machine.phase === 'wizard' && startedSheetApplies(machine.step);
  const startedSheet = (
    <StartedSheet
      open={startedOpen}
      remaining={remainingPrepLabels(steps, machine.step)}
      onEnterNow={() => dispatch({ type: 'enterNow' })}
      onContinue={() => setStartedDismissed(true)}
    />
  );
  if (machine.phase === 'wizard' && machine.step === 'b') {
    const done = (outcome: SurveyOutcome): void => {
      prep.patch({ survey: outcome });
      dispatch({ type: 'next', steps });
    };
    return (
      <SurveyStepView
        question={survey.question} draft={survey.draft} steps={stepsView} place={place} saving={survey.saving} errorText={survey.errorText}
        startedSheet={startedSheet} sheetOpen={startedOpen}
        onSelect={survey.select} onNote={survey.setNote}
        onNext={() => void survey.next(done)}
        onSkip={() => survey.skip(done)}
        onBack={() => {
          if (!survey.back()) dispatch({ type: 'back', steps });
        }}
        onExit={exit}
      />
    );
  }
  if (machine.phase === 'wizard' && machine.step === 'c' && bandMode !== 'none') {
    return (
      <BandStepContainer
        bandMode={bandMode} place={place} steps={stepsView}
        startedRemaining={startedOpen ? remainingPrepLabels(steps, 'c') : null}
        onDone={(outcome) => {
          prep.patch({ bandOutcome: outcome });
          dispatch({ type: 'next', steps });
        }}
        onStartedEnterNow={() => dispatch({ type: 'enterNow' })}
        onStartedContinue={() => setStartedDismissed(true)}
        onBack={() => dispatch({ type: 'back', steps })}
        onExit={exit}
      />
    );
  }
  if (machine.phase === 'wizard' && machine.step === 'e') {
    return (
      <ReadySummaryView
        place={place} displayName={displayName} steps={stepsView}
        rows={buildSummaryRows({ place, bandMode, draft: prep.draft })}
        onGoto={(step) => dispatch({ type: 'goto', step, fromSummary: true })}
        onReady={() => dispatch({ type: 'finishPrep' })}
        onBack={() => dispatch({ type: 'back', steps })}
        onExit={exit}
      />
    );
  }
  return (
    <EntryConfirmView
      title={title}
      startLabel={formatStartLabel(info.scheduledAt)}
      hostName={info.hostName}
      address={info.locationType === 'offline' ? info.locationAddress : null}
      place={place}
      size={size}
      bandMode={bandMode}
      displayName={displayName}
      identitySource={entry.isGuest ? 'input' : 'account'}
      wait={machine.stage === 'unopened'}
      onEnter={() => dispatch({ type: 'enter' })}
      onBack={() => navigate('/join')}
    />
  );
}
