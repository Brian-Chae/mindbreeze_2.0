// SDD-209 M0 — `/join` 코드 입장(몰입형, 로그인 불필요). ① 4자리 코드 확인(FM04) → ② 개인정보 입력(FM04b) → 입장 자격 발급.
// 코드·개인정보는 이 컴포넌트의 상태(메모리)에만 있다. URL·저장소에는 입장 자격만 남는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CodeEntryView, type CodeEntryStatus } from '../../components/class/flow/member/CodeEntryView';
import { ProfileEntryView, type EntrySummary } from '../../components/class/flow/member/ProfileEntryView';
import { ApiError } from '../../lib/api/client';
import { getClientProfile } from '../../lib/api/client-profile';
import { enterByCode, entryFromResult, saveEntry, verifyEntryCode, type EntryGender } from '../../lib/api/class-flow';
import { formatStartLabel } from '../../lib/class/flow/member-format';
import { setEntryHandoff } from '../../lib/class/flow/member-handoff';
import {
  classifyCodeError, emptyProfileDraft, isCompleteCode, sanitizeCodeInput, toEnterPayload, validateEntryProfile,
  type EntryProfileDraft, type EntryProfileErrors,
} from '../../lib/class/flow/member-entry';
import { useAuthStore } from '../../stores/authStore';

type Step = 'code' | 'profile';

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
  const [digits, setDigits] = useState('');
  const [status, setStatus] = useState<CodeEntryStatus>('idle');
  const [summary, setSummary] = useState<EntrySummary | null>(null);
  const [draft, setDraft] = useState<EntryProfileDraft>(emptyProfileDraft);
  const [errors, setErrors] = useState<EntryProfileErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
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
    try {
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
  }, [digits, status]);

  const mode = memberName ? 'member' : 'guest';

  const submitProfile = useCallback(async () => {
    if (submitting) return;
    const found = validateEntryProfile(draft, mode);
    setErrors(found);
    setSubmitError(null);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      const result = await enterByCode(toEnterPayload(digits, draft, mode));
      if (!aliveRef.current) return;
      const entry = entryFromResult(result);
      if (!entry) {
        setSubmitError('잠시 문제가 생겼어요. 다시 시도해 주세요');
        return;
      }
      saveEntry(entry);
      setEntryHandoff({ sessionId: entry.sessionId, displayName: draft.name.trim() || (memberName ?? '') });
      navigate(`/class/${encodeURIComponent(entry.sessionId)}/enter`, { replace: true });
    } catch (error) {
      if (!aliveRef.current) return;
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
  }, [digits, draft, memberName, mode, navigate, submitting]);

  if (step === 'profile' && summary) {
    return (
      <ProfileEntryView
        summary={summary}
        mode={mode}
        draft={draft}
        errors={errors}
        submitError={submitError}
        submitting={submitting}
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
