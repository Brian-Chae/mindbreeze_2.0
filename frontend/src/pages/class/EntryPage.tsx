// SDD-209 M1 — `/class/:sessionId/enter` 참가자 입장 흐름 오케스트레이터(입장 자격 기반, 로그인 불필요).
// FM05 입장 확인 → (M2~M5 준비 마법사) → (M6 시작 대기) → (M7 대기열) → 진행 화면 → (M8 종료) 를 하나의 상태 머신으로 돌린다.
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Key } from 'lucide-react';
import { FlowStateScreen } from '../../components/class/flow/shared/FlowStateScreen';
import { ApiError } from '../../lib/api/client';
import { EntryConfirmView } from '../../components/class/flow/member/EntryConfirmView';
import { BandStepContainer } from '../../components/class/flow/member/BandStepContainer';
import { DeviceStepContainer } from '../../components/class/flow/member/DeviceStepContainer';
import { MemberStateScreen } from '../../components/class/flow/member/MemberStateScreen';
import { NoticeStepView } from '../../components/class/flow/member/NoticeStepView';
import { ReadySummaryView } from '../../components/class/flow/member/ReadySummaryView';
import { StartedSheet } from '../../components/class/flow/member/StartedSheet';
import { SurveyStepView } from '../../components/class/flow/member/SurveyStepView';
import { EndContainer } from '../../components/class/flow/member/EndContainer';
import { MemberClassContainer } from '../../components/class/player/member/MemberClassContainer';
import { WaitlistView } from '../../components/class/flow/member/WaitlistView';
import { WaitStartContainer } from '../../components/class/flow/member/WaitStartContainer';
import { useWakeLock } from '../../hooks/useWakeLock';
import { useEntryPrep } from '../../hooks/useEntryPrep';
import { useWaitingRoomPresence } from '../../hooks/useWaitingRoomPresence';
import { useEntryState } from '../../hooks/useEntryState';
import { useEntrySurvey } from '../../hooks/useEntrySurvey';
import { cancelWaitlist, clearEntry, enterInvitedSession, entryFromResult, loadEntry, saveEntry, setEegCollectionConsent, type StoredEntry } from '../../lib/api/class-flow';
import { RecordingConsentGateView } from '../../components/class/flow/member/RecordingConsentGateView';
import { EEG_COLLECTION_NOTICE_VERSION, RECORDING_NOTICE_VERSION, isRecordingConsentRequired } from '../../lib/class/flow/recording-consent';
import { isAiEnabled } from '../../lib/feature-flags';
import { durationMinutes, formatStartLabel, formatWhen, maskEmail } from '../../lib/class/flow/member-format';
import { takeEntryHandoff } from '../../lib/class/flow/member-handoff';
import {
  buildSteps, deriveEnterStage, deriveFlowStateKind, entryReducer, initialEntryState, startedSheetApplies, type FlowStateKind,
} from '../../lib/class/flow/member-machine';
import { RAW_RETENTION_DAYS } from '../../lib/privacy-policy';
import { buildSummaryRows, remainingPrepLabels, type SurveyOutcome } from '../../lib/class/flow/member-prep';
import { buildMemberReadiness, type BandSnapshot } from '../../lib/class/flow/member-presence';
import type { FlowBandMode } from '../../lib/class/flow/types';
import { useAuthStore } from '../../stores/authStore';

/** 방침(/privacy)과 같은 보관 기간 — 환경 변수로 달리 표시하지 않는다 */
const RETENTION_DAYS = RAW_RETENTION_DAYS;

function bandModeOf(mode: string | undefined): FlowBandMode {
  return mode === 'none' ? 'none' : mode === 'required' ? 'req' : 'opt';
}

export default function EntryPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  // 회차를 바꾸면 자격·준비 초안·폴링·늦은 응답까지 이전 회차와 분리한다.
  return <SessionEntryPage key={sessionId} sessionId={sessionId} />;
}

function SessionEntryPage({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [entry, setEntry] = useState<StoredEntry | null>(() => {
    const stored = loadEntry(sessionId);
    return stored?.sessionId === sessionId && stored.credential ? stored : null;
  });
  const [entryChecked, setEntryChecked] = useState(entry !== null);
  const [invitationError, setInvitationError] = useState<FlowStateKind | null>(null);
  const [invitationAttempt, setInvitationAttempt] = useState(0);
  // SDD-220 F1 — 서버가 녹음·녹화 동의 없음으로 거부하면 동의 화면을 먼저 보여 준다(동의 전에는 입장 자격이 없다)
  const [recordingGate, setRecordingGate] = useState(false);
  // 뇌파 수집 선택 현황 — undefined 면(구 응답) 사전 선택 화면을 띄우지 않고, true 면 이미 동의한 것이라 건너뛴다.
  const [eegChoiceOverride, setEegChoiceOverride] = useState<boolean | null | undefined>(undefined);
  const eegChoice = eegChoiceOverride !== undefined ? eegChoiceOverride : entry?.eegCollectionConsented;
  const [recordingChecked, setRecordingChecked] = useState(false);
  const [recordingSubmitting, setRecordingSubmitting] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [machine, dispatch] = useReducer(entryReducer, undefined, initialEntryState);
  const [handoff] = useState(() => takeEntryHandoff(sessionId));
  const handoffName = handoff?.displayName ?? '';
  const prep = useEntryPrep({ sessionId, sessionType: entry?.classInfo?.sessionType, credential: entry?.credential ?? null, participantId: entry?.participantId ?? null });
  const survey = useEntrySurvey({ sessionId, credential: entry?.credential ?? null, participantId: entry?.participantId ?? null });
  // 시작 후 시트에서 `준비 이어서 하기`를 누르면 이후 단계에서는 다시 띄우지 않는다
  const [startedDismissed, setStartedDismissed] = useState(false);
  /** 밴드 단계에서 본 마지막 상태 — 준비 현황(presence)으로 상담사 로비에 중계된다(서버 저장 없음) */
  const [bandSnapshot, setBandSnapshot] = useState<BandSnapshot | null>(null);

  // 초대받은 로그인 회원의 편의 입장: 저장된 자격이 없으면 초대 행으로 같은 자격을 받는다(자격이 없으면 코드 입장 안내)
  useEffect(() => {
    if (entry || !sessionId || !isAuthenticated) {
      setEntryChecked(true);
      return undefined;
    }
    let cancelled = false;
    setEntryChecked(false);
    setInvitationError(null);
    void enterInvitedSession(sessionId)
      .then((result) => {
        if (cancelled) return;
        const next = entryFromResult(result);
        if (next?.sessionId === sessionId) {
          saveEntry(next);
          setEntry(next);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isRecordingConsentRequired(error)) {
          setRecordingGate(true);
          return;
        }
        // 초대 자격이 없는 이메일 수신자는 코드로 확인한다. 통신 장애는 재시도할 수 있게 구분한다.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return;
        setInvitationError(deriveFlowStateKind({ error, online: navigator.onLine }));
      })
      .finally(() => {
        if (!cancelled) setEntryChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [entry, sessionId, isAuthenticated, invitationAttempt]);

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

  const info = entry?.classInfo;
  const title = info?.title ?? '클래스';
  const homePath = isAuthenticated ? '/app' : '/';
  const listPath = isAuthenticated ? '/app/sessions' : '/';
  const displayName = handoffName || (isAuthenticated && user ? user.name : '참가자');

  // 대기·진행 중에는 화면이 꺼지지 않게 한다(class-join-page 와 같은 기준)
  useWakeLock(machine.phase === 'wait' || machine.phase === 'live');

  // 준비 중(마법사·시작 대기)인 동안 상담사 로비에 내 준비 현황을 알린다. 대기열·진행·종료·상태 화면에서는 보내지 않는다.
  const presenceReadiness = useMemo(
    () => buildMemberReadiness({
      place: info?.locationType ?? 'online',
      bandMode: info ? bandModeOf(info.linkbandMode) : 'none',
      survey: prep.draft.survey,
      bandOutcome: prep.draft.bandOutcome,
      mic: prep.draft.mic,
      band: bandSnapshot,
    }),
    [info, prep.draft.survey, prep.draft.bandOutcome, prep.draft.mic, bandSnapshot],
  );
  useWaitingRoomPresence({
    sessionId,
    participantId: entry?.participantId ?? null,
    nickname: displayName,
    readiness: presenceReadiness,
    enabled: entry !== null && (machine.phase === 'wizard' || machine.phase === 'wait'),
    skipAuth: !isAuthenticated,
    entryCredential: entry?.credential ?? null,
  });

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const confirmCancel = useCallback(async (): Promise<void> => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelWaitlist(sessionId, entry?.credential ?? null);
      clearEntry(sessionId);
      navigate('/join', { replace: true });
    } catch {
      setCancelError('대기를 취소하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setCancelling(false);
    }
  }, [cancelling, sessionId, entry, navigate]);

  const confirmRecordingConsent = useCallback(async (): Promise<void> => {
    if (recordingSubmitting || !recordingChecked) return;
    setRecordingSubmitting(true);
    setRecordingError(null);
    try {
      const result = await enterInvitedSession(sessionId, { recordingConsent: true, recordingNoticeVersion: RECORDING_NOTICE_VERSION });
      const next = entryFromResult(result);
      if (next?.sessionId === sessionId) {
        saveEntry(next);
        setEntry(next);
        setRecordingGate(false);
      }
    } catch {
      // 저장에 실패하면 동의한 것으로 보지 않는다 — 입장도 열리지 않는다.
      setRecordingError('동의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setRecordingSubmitting(false);
    }
  }, [recordingSubmitting, recordingChecked, sessionId]);

  const retry = useCallback(() => {
    dispatch({ type: 'resume' });
    void refresh();
  }, [refresh]);

  if (!entry) {
    if (!entryChecked) return <p role="status">입장 정보를 확인하고 있어요.</p>;
    if (recordingGate) {
      return <RecordingConsentGateView title="클래스" checked={recordingChecked} submitting={recordingSubmitting} error={recordingError}
        onChange={setRecordingChecked} onConfirm={() => void confirmRecordingConsent()} onBack={() => navigate(homePath)} />;
    }
    if (invitationError) {
      return <MemberStateScreen kind={invitationError} classTitle="클래스" whenLabel={null}
        onPrimary={() => invitationError === 'closed' || invitationError === 'cancelled'
          ? navigate(listPath) : setInvitationAttempt((attempt) => attempt + 1)}
        onSecondary={() => navigate(homePath)} />;
    }
    return <FlowStateScreen icon={<Key size={28} />} warn={false}
      heading="초대받은 클래스에 입장해 주세요"
      lead={<>초대 이메일의 참여 코드를 입력해 입장할 수 있어요.<br />회원으로 초대받았다면 로그인한 뒤 초대 링크를 다시 열어 주세요.</>}
      note="참여 코드가 없으면 진행자에게 문의해 주세요."
      primary={{ label: '코드 입력하기', onClick: () => navigate('/join', { replace: true }) }}
      secondary={isAuthenticated
        ? { label: '내 클래스 보기', onClick: () => navigate('/app/classes') }
        : { label: '로그인하기', onClick: () => navigate('/login?role=client') }} />;
  }

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

  if (machine.phase === 'live') {
    // 진행 화면은 입장 자격으로 상태·상담사 영상·밴드 업로드·손들기 소유를 증명한다(6자리 코드·참여자 토큰 경로 없음)
    return (
      <div className="min-h-screen bg-black">
        <MemberClassContainer
          title={info.title}
          startedAt={serverState?.started_at ?? info.startedAt}
          durationMin={info.durationMin}
          onLeave={() => navigate(homePath, { replace: true })}
          sessionId={sessionId}
          participantId={entry.participantId}
          entryCredential={entry.credential}
          hostName={info.hostName}
          locationType={info.locationType}
          participantMode={info.participantMode}
          maxParticipants={info.maxParticipants}
          linkbandMode={info.linkbandMode}
        />
      </div>
    );
  }
  if (machine.phase === 'end') {
    const reportMode = !serverState?.report_included ? 'excluded' : entry.isGuest ? 'guest' : 'member';
    const minutes = durationMinutes(serverState?.started_at ?? info.startedAt, serverState?.ended_at ?? null);
    return (
      <EndContainer
        sessionId={sessionId} credential={entry.credential} participantId={entry.participantId} place={place} title={title}
        duration={minutes === null ? null : `${minutes}분`}
        reportMode={reportMode}
        maskedEmail={entry.isGuest ? (handoff?.maskedEmail ?? null) : maskEmail(user?.email ?? '')}
        accountEmail={entry.isGuest ? null : (user?.email ?? null)}
        onHome={() => {
          clearEntry(sessionId);
          navigate(homePath, { replace: true });
        }}
      />
    );
  }
  if (machine.phase === 'waitlist') {
    return (
      <WaitlistView
        place={place} title={title} hostName={info.hostName} whenLabel={formatWhen(info.scheduledAt)}
        placeName={info.locationType === 'offline' ? (info.locationAddress?.split(',').pop()?.trim() ?? null) : null}
        cancelOpen={cancelOpen} cancelling={cancelling} cancelError={cancelError}
        onAskCancel={() => {
          setCancelError(null);
          setCancelOpen(true);
        }}
        onKeepWaiting={() => setCancelOpen(false)}
        onConfirmCancel={() => void confirmCancel()}
      />
    );
  }
  if (machine.phase === 'wait') {
    return (
      <WaitStartContainer
        place={place} size={size} bandMode={bandMode} title={title} hostName={info.hostName} scheduledAt={info.scheduledAt}
        address={info.locationType === 'offline' ? info.locationAddress : null}
        onRecheck={() => dispatch({ type: 'recheck' })}
        onExit={exit}
      />
    );
  }
  if (machine.phase === 'wizard' && machine.step === 'a') {
    return (
      <NoticeStepView
        sessionType={info.sessionType} place={place} size={size} bandMode={bandMode} title={title} hostName={info.hostName} retentionDays={RETENTION_DAYS}
        aiEnabled={isAiEnabled()}
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
        onBandChange={setBandSnapshot}
        onEegChoice={eegChoice === undefined || eegChoice === true ? undefined : async (agree) => {
          await setEegCollectionConsent(sessionId, entry.credential, { consented: agree, noticeVersion: EEG_COLLECTION_NOTICE_VERSION });
          setEegChoiceOverride(agree);
        }}
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
  if (machine.phase === 'wizard' && machine.step === 'd' && place === 'online') {
    return (
      <DeviceStepContainer
        solo={size === 'solo'} steps={stepsView}
        startedRemaining={startedOpen ? remainingPrepLabels(steps, 'd') : null}
        onDone={(result) => {
          prep.patch({ mic: result.mic, camOn: result.camOn });
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
