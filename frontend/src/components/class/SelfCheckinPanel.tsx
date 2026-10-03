// 세션 종료 후 사전·사후 설문 — '오늘의 클래스는 어떠셨나요?'
//
// 수업 전(사전)과 수업 후(사후)를 같은 축(집중·편안함·감정)으로 물어 변화를 비교한다.
// 완료 후에는 별도 카드 없이 종료 화면의 '수업이 종료되었습니다' 안내만 남긴다. 스킵 가능.

import { useState } from 'react';
import { ApiError } from '../../lib/api/client';
import {
  CHECKIN_SKIP_STORAGE_KEY,
  SAM_AXES,
  SAM_VALUES,
  submitCheckin,
  type CheckinPhase,
  type SamValue,
} from '../../lib/api/checkin';

interface SelfCheckinPanelProps {
  sessionId: string;
  participantId: string | null;
  participantToken: string | null;
  /** 로그인 회원이면 액세스 토큰으로 본인 확인, 게스트면 participant_token 소유 증명 */
  isLoggedIn: boolean;
  /** EEG 두뇌휴식도 — 완료 카드 제거로 현재 미사용(호환 유지) */
  relaxationIndex?: number | null;
  /** 설문 제출 통지 */
  onSubmitted?: () => void;
}

type AxisKey = 'arousal' | 'valence' | 'emotion';
type MoodState = Record<AxisKey, SamValue | null>;

const EMPTY_MOOD: MoodState = { arousal: null, valence: null, emotion: null };

function hasMoodValue(mood: MoodState): boolean {
  return mood.arousal !== null || mood.valence !== null || mood.emotion !== null;
}

interface MoodAxesProps {
  mood: MoodState;
  onChange: (key: AxisKey, value: SamValue) => void;
  idPrefix: string;
  ariaPrefix: string;
  disabled: boolean;
}

function MoodAxes({ mood, onChange, idPrefix, ariaPrefix, disabled }: MoodAxesProps) {
  return (
    <>
      {SAM_AXES.map((axis) => (
        <fieldset key={axis.key} className="mt-4">
          <legend className="text-sm font-bold text-[color:var(--mb-label-70)]">{axis.label}</legend>
          {/* 좁은 화면(<360px)에서는 3+2 두 줄, 넓은 화면에서는 5단계 한 줄로 배치한다 */}
          <div className="mt-2 grid grid-cols-3 gap-1.5 min-[360px]:grid-cols-5 min-[360px]:gap-2">
            {SAM_VALUES.map((step) => {
              const selected = mood[axis.key] === step;
              return (
                <button
                  key={step}
                  type="button"
                  id={`${idPrefix}-${axis.key}-${step}`}
                  aria-pressed={selected}
                  aria-label={`${ariaPrefix}${axis.label} ${step}단계 ${axis.steps[step]}`}
                  disabled={disabled}
                  onClick={() => onChange(axis.key, step)}
                  className={`flex h-14 flex-col items-center justify-center rounded-xl border text-base font-bold transition ${
                    selected
                      ? 'border-transparent bg-[color:var(--mb-primary,#5F0080)] text-white'
                      : 'border-[color:var(--mb-border,#E8D9EF)] bg-white text-[color:var(--mb-label-70)] hover:border-[color:var(--mb-primary,#5F0080)]'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <span aria-hidden="true">{step}</span>
                  <span className="mt-0.5 text-[10px] font-medium leading-tight opacity-80" aria-hidden="true">
                    {axis.steps[step]}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '클래스 참여 확인에 실패해 설문을 저장하지 못했습니다.';
    if (error.status === 409) return '종료된 클래스에서만 설문에 응답할 수 있습니다.';
    if (error.status === 422) return '설문 값을 다시 확인해 주세요.';
    if (error.message) return error.message;
  }
  return '설문 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

export function SelfCheckinPanel({
  sessionId,
  participantId,
  participantToken,
  isLoggedIn,
  onSubmitted,
}: SelfCheckinPanelProps) {
  const [before, setBefore] = useState<MoodState>(EMPTY_MOOD);
  const [after, setAfter] = useState<MoodState>(EMPTY_MOOD);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<'input' | 'done' | 'skipped'>(() => {
    // 이미 건너뛴 세션이면 다시 묻지 않는다(새로고침 포함).
    try {
      return window.localStorage.getItem(CHECKIN_SKIP_STORAGE_KEY) === sessionId ? 'skipped' : 'input';
    } catch {
      return 'input';
    }
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedNote = note.trim();
  const hasValue = hasMoodValue(before) || hasMoodValue(after);

  const setBeforeAxis = (key: AxisKey, value: SamValue): void =>
    setBefore((prev) => ({ ...prev, [key]: value }));
  const setAfterAxis = (key: AxisKey, value: SamValue): void =>
    setAfter((prev) => ({ ...prev, [key]: value }));

  const postPhase = async (target: CheckinPhase, mood: MoodState): Promise<void> => {
    await submitCheckin(
      sessionId,
      {
        phase: target,
        arousal: mood.arousal,
        valence: mood.valence,
        emotion: mood.emotion,
        note: target === 'after' ? trimmedNote || null : null,
        participant_id: participantId,
        participant_token: isLoggedIn ? null : participantToken,
      },
      { skipAuth: !isLoggedIn },
    );
  };

  const handleSubmit = async (): Promise<void> => {
    if (!hasValue) {
      setError('수업 전·후 중 최소 한 항목을 선택해 주세요.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      // 사후(수업 후)를 먼저, 사전(수업 전)은 남겼을 때만 저장해 '사전 → 사후' 변화를 만든다.
      if (hasMoodValue(after)) {
        await postPhase('after', after);
      }
      if (hasMoodValue(before)) {
        await postPhase('before', before);
      }
      setPhase('done');
      onSubmitted?.();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = (): void => {
    try {
      window.localStorage.setItem(CHECKIN_SKIP_STORAGE_KEY, sessionId);
    } catch {
      // localStorage 미가용(사생활 보호 모드) — 이번 세션에서만 숨긴다.
    }
    setPhase('skipped');
  };

  // 스킵·완료 모두 카드 없이 숨긴다 — 종료 화면의 '수업이 종료되었습니다' 안내만 남긴다.
  if (phase === 'skipped' || phase === 'done') return null;

  return (
    <section
      data-testid="self-checkin"
      className="mx-auto mt-8 max-w-md rounded-2xl border border-[color:var(--mb-border,#E8D9EF)] bg-white p-5 text-left"
    >
      <h2 className="text-base font-bold text-[color:var(--mb-label-70)]">오늘의 클래스는 어떠셨나요?</h2>
      <p className="mt-1 text-sm leading-6 text-[color:var(--mb-fg-muted)]">
        수업 전과 수업 후를 비교할 수 있도록 두 번 기록해 주세요. 뇌파를 측정하지 않아도 이 기록은 리포트에 남습니다.
      </p>

      <h3 className="mt-5 text-sm font-bold text-[color:var(--mb-label-70)]">수업 전에는 어땠나요?</h3>
      <MoodAxes
        mood={before}
        onChange={setBeforeAxis}
        idPrefix="checkin-before"
        ariaPrefix="수업 전 "
        disabled={isSubmitting}
      />

      <h3 className="mt-5 text-sm font-bold text-[color:var(--mb-label-70)]">수업 후에는 어땠나요?</h3>
      <MoodAxes
        mood={after}
        onChange={setAfterAxis}
        idPrefix="checkin-after"
        ariaPrefix="수업 후 "
        disabled={isSubmitting}
      />

      <label htmlFor="checkin-note" className="mt-4 block text-sm font-bold text-[color:var(--mb-label-70)]">
        한 줄 소감 <span className="font-normal text-[color:var(--mb-fg-muted)]">(선택)</span>
      </label>
      <input
        id="checkin-note"
        value={note}
        maxLength={200}
        disabled={isSubmitting}
        onChange={(event) => setNote(event.target.value)}
        placeholder="예: 몸이 가벼워졌어요"
        className="mt-2 w-full rounded-xl border border-[color:var(--mb-border,#E8D9EF)] bg-white px-4 py-3 text-sm text-[color:var(--mb-label-70)] outline-none focus:border-[color:var(--mb-primary,#5F0080)]"
      />

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || !hasValue}
          className="mb-btn h-[48px] flex-1 justify-center rounded-xl px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? '저장 중...' : '설문 남기기'}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={isSubmitting}
          className="h-[48px] px-4 text-sm font-semibold text-[color:var(--mb-fg-muted)]"
        >
          건너뛰기
        </button>
      </div>
    </section>
  );
}
