// SDD-209 M0 — `/join` 코드 입장(몰입형, 로그인 불필요). ① 4자리 코드 확인(FM04) → ② 개인정보 입력(FM04b) → 입장 자격 발급.
// 코드·개인정보는 이 컴포넌트의 상태(메모리)에만 있다. URL·저장소에는 입장 자격만 남는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CodeEntryView, type CodeEntryStatus } from '../../components/class/flow/member/CodeEntryView';
import { ProfileEntryView, type EntrySummary } from '../../components/class/flow/member/ProfileEntryView';
import { ApiError } from '../../lib/api/client';
import { getClientProfile } from '../../lib/api/client-profile';
import { enterByCode, entryFromResult, saveEntry, verifyEntryCode, type EntryGender } from '../../lib/api/class-flow';
import { RECORDING_NOTICE_VERSION, isRecordingConsentRequired } from '../../lib/class/flow/recording-consent';
import { formatStartLabel, maskEmail } from '../../lib/class/flow/member-format';
import { setEntryHandoff } from '../../lib/class/flow/member-handoff';
import {
  classifyCodeError, emptyProfileDraft, isCompleteCode, sanitizeCodeInput, toEnterPayload, validateEntryProfile,
  type EntryProfileDraft, type EntryProfileErrors,
} from '../../lib/class/flow/member-entry';
import { useAuthStore } from '../../stores/authStore';
import { joinClassCode, resolveClassCode, type ClassCodeResult } from '../../lib/api/class-code';
import { MemberFlowFrame } from '../../components/class/flow/member/MemberFlowFrame';
import { FlowButton, FlowCard, FlowH1, FlowSub } from '../../components/class/flow/shared/flow-primitives';

type Step = 'code' | 'profile' | 'class';

function toGender(value: string | null | undefined): EntryGender | null {
  return value === 'female' || value === 'male' || value === 'other' ? value : null;
}

/** 계정의 생년월일(YYYY-MM-DD)을 화면 표기(YYYY.MM.DD)로 */
function toBirthText(value: string | null | undefined): string {
  return value ? value.slice(0, 10).replace(/-/g, '.') : '';
}

export default function CodeEntryPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const memberName = isAuthenticated && user ? user.name : null;

  const [step, setStep] = useState<Step>('code');
  const [classInfo, setClassInfo] = useState<ClassCodeResult | null>(null);
  const codeRequest = useRef<AbortController | null>(null);
  const [digits, setDigits] = useState('');
  const [status, setStatus] = useState<CodeEntryStatus>('idle');
  const [summary, setSummary] = useState<EntrySummary | null>(null);
  const [draft, setDraft] = useState<EntryProfileDraft>(emptyProfileDraft);
  const [errors, setErrors] = useState<EntryProfileErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // SDD-220 F1 — 녹음·녹화 필수 동의(체크 전에는 입장 불가)
  const [recordingConsent, setRecordingConsent] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      codeRequest.current?.abort();
    };
  }, []);

  // 로그인 회원: 계정 값으로 채운다(성별·생년월일은 프로필에서 가져오되 실패해도 입장은 계속된다)
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    setDraft((prev) => ({ ...prev, name: user.name, email: user.email, emailConfirm: user.email }));
    let cancelled = false;
    void getClientProfile()
      .then((profile) => {
        if (cancelled) return;
        setDraft((prev) => ({ ...prev, gender: toGender(profile.gender), birth: toBirthText(profile.birth_date) }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

  const changeDigits = useCallback((value: string) => {
    setDigits(sanitizeCodeInput(value));
    setStatus((prev) => (prev === 'throttled' ? prev : 'idle'));
  }, []);

  const submitCode = useCallback(async () => {
    if (!isCompleteCode(digits) || status === 'verifying' || status === 'throttled') return;
    setStatus('verifying');
    codeRequest.current?.abort();
    const controller = new AbortController();
    codeRequest.current = controller;
    try {
      if (isAuthenticated && user?.role === 'client') {
        const resolved = await resolveClassCode(digits, controller.signal);
        if (!aliveRef.current || controller.signal.aborted) return;
        if (resolved) {
          setClassInfo(resolved);
          setSubmitError(null);
          setStatus('idle');
          setStep('class');
          return;
        }
      }
      const result = await verifyEntryCode(digits);
      if (!aliveRef.current) return;
      setSummary({ title: result.title ?? '클래스', startLabel: formatStartLabel(result.scheduled_at), hostName: result.host_name });
      setStatus('idle');
      setStep('profile');
    } catch (error) {
      if (!aliveRef.current) return;
      const failure = classifyCodeError(error);
      setStatus(failure === 'invalid' ? 'error' : failure === 'throttled' ? 'throttled' : 'unavailable');
    }
  }, [digits, status, isAuthenticated, user?.role]);

  const joinClass = async () => {
    if (!classInfo || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const controller = new AbortController();
    codeRequest.current = controller;
    try {
      await joinClassCode(classInfo.class_id, digits, controller.signal);
      if (!aliveRef.current) return;
      const session = classInfo.sessions.length === 1 ? classInfo.sessions[0] : null;
      navigate(`/app/classes/${encodeURIComponent(classInfo.class_id)}${session ? `?sessionId=${encodeURIComponent(session.session_id)}` : ''}`, { replace: true });
    } catch (error) {
      if (!aliveRef.current) return;
      setSubmitError(error instanceof ApiError && error.status === 403
        ? '이 계정으로는 클래스에 가입할 수 없어요.'
        : error instanceof ApiError && error.status === 429
          ? '잠시 후 다시 시도해 주세요.' : '가입하지 못했어요. 코드를 확인하거나 다시 시도해 주세요.');
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  };

  const mode = memberName ? 'member' : 'guest';

  const submitProfile = useCallback(async () => {
    if (submitting) return;
    const found = validateEntryProfile(draft, mode);
    setErrors(found);
    setSubmitError(null);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      // SDD-220 F1: 녹음·녹화 필수 동의를 체크한 경우에만 이 요청이 만들어진다(서버가 다시 검증).
      const result = await enterByCode({
        ...toEnterPayload(digits, draft, mode),
        recording_consent: recordingConsent,
        recording_notice_version: RECORDING_NOTICE_VERSION,
      });
      if (!aliveRef.current) return;
      const entry = entryFromResult(result);
      if (!entry) {
        setSubmitError('잠시 문제가 생겼어요. 다시 시도해 주세요');
        return;
      }
      saveEntry(entry);
      setEntryHandoff({
        sessionId: entry.sessionId,
        displayName: draft.name.trim() || (memberName ?? ''),
        maskedEmail: entry.isGuest ? maskEmail(draft.email.trim()) : null,
      });
      navigate(`/class/${encodeURIComponent(entry.sessionId)}/enter`, { replace: true });
    } catch (error) {
      if (!aliveRef.current) return;
      if (isRecordingConsentRequired(error)) {
        setRecordingConsent(false);
        setSubmitError('녹음·녹화 동의가 필요해요. 동의를 확인해 주세요');
        return;
      }
      if (error instanceof ApiError && error.status === 422) {
        setSubmitError('입력한 정보를 다시 확인해 주세요');
        return;
      }
      const failure = error instanceof ApiError && (error.status === 404 || error.status === 409) ? 'invalid' : classifyCodeError(error);
      if (failure === 'invalid') {
        // 그 사이 코드가 닫혔다 — 코드 입력으로 돌아간다(구분 없는 같은 안내)
        setStep('code');
        setStatus('error');
      } else if (failure === 'throttled') {
        setSubmitError('잠시 후 다시 시도해 주세요');
      } else {
        setSubmitError('잠시 문제가 생겼어요. 다시 시도해 주세요');
      }
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  }, [digits, draft, memberName, mode, navigate, submitting, recordingConsent]);

  if (step === 'class' && classInfo) {
    return <MemberFlowFrame title="클래스 가입" onBack={() => { if (!submitting) setStep('code'); }} colClassName="fm-narrow"
      foot={<FlowButton disabled={submitting} onClick={() => void joinClass()}>{submitting ? '가입 중…' : '클래스 가입하기'}</FlowButton>}>
      <FlowCard>
        <FlowH1>{classInfo.title ?? '명상 클래스'}</FlowH1>
        <FlowSub>클래스에 가입하면 앞으로의 일정을 내 클래스에서 확인할 수 있어요.</FlowSub>
        <p className="my-5 text-sm text-stone-600">{classInfo.sessions.length > 0
          ? `지금 열려 있는 회차가 ${classInfo.sessions.length}개 있어요. 가입 후 선택해 주세요.`
          : classInfo.next_session ? `다음 일정: ${formatStartLabel(classInfo.next_session.scheduled_at)}` : '새 일정이 정해지면 내 클래스에서 확인할 수 있어요.'}</p>
        {submitError && <p role="alert" className="mb-4 text-sm text-red-700">{submitError}</p>}
      </FlowCard>
    </MemberFlowFrame>;
  }
  if (step === 'profile' && summary) {
    return (
      <ProfileEntryView
        summary={summary}
        mode={mode}
        draft={draft}
        errors={errors}
        submitError={submitError}
        submitting={submitting}
        recordingConsent={recordingConsent}
        onRecordingConsentChange={setRecordingConsent}
        onChange={(patch) => {
          setDraft((prev) => ({ ...prev, ...patch }));
          setErrors({});
          setSubmitError(null);
        }}
        onSubmit={() => void submitProfile()}
        onBack={() => setStep('code')}
      />
    );
  }
  return (
    <CodeEntryView
      digits={digits}
      status={status}
      memberName={memberName}
      onChange={changeDigits}
      onSubmit={() => void submitCode()}
      onBack={() => navigate(-1)}
    />
  );
}
