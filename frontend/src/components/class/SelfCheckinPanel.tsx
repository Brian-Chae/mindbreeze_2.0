// 세션 종료 후 사후 설문 — '오늘 수업 이후 어떠신가요?'
//
// 수업 후 느낌을 집중·편안함·감정 3축으로 물어 리포트에 남긴다. 스킵 가능.
// (수업 전 설문은 입장 전 체크인에서 이미 물었으므로 종료 화면에서는 묻지 않는다.)
// 완료 후에는 별도 카드 없이 종료 화면의 '수업이 종료되었습니다' 안내만 남긴다.

import { useEffect, useState } from 'react';
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
                  <span className="mt-0.5 text-[12px] font-medium leading-tight opacity-80" aria-hidden="true">
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

// MB2-07: 건너뛴 세션을 JSON 배열(id 목록)로 누적 저장한다.
// 단일 값으로 덮어쓰면 다른 세션을 건너뛸 때 이전 세션의 스킵 기록이 사라져
// 그 세션에서 설문을 다시 묻게 된다. 세션 id 별로 독립 보존한다.
function readSkippedSessions(): string[] {
  try {
    const raw = window.localStorage.getItem(CHECKIN_SKIP_STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
      }
      if (typeof parsed === 'string' && parsed.length > 0) return [parsed];
    } catch {
      // JSON 이 아니면 구버전 단일 세션 id(원시 문자열)로 취급한다.
      return [raw];
    }
    return [];
  } catch {
    // localStorage 미가용(사생활 보호 모드) — 건너뛰기 기록을 읽지 못한다.
    return [];
  }
}

function isSessionSkipped(sessionId: string): boolean {
  return readSkippedSessions().includes(sessionId);
}

function markSessionSkipped(sessionId: string): void {
  try {
    const sessions = readSkippedSessions();
    if (!sessions.includes(sessionId)) sessions.push(sessionId);
    window.localStorage.setItem(CHECKIN_SKIP_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage 미가용(사생활 보호 모드) — 이번 세션에서만 숨긴다.
  }
}

export function SelfCheckinPanel({
  sessionId,
  participantId,
  participantToken,
  isLoggedIn,
  onSubmitted,
}: SelfCheckinPanelProps) {
  const [after, setAfter] = useState<MoodState>(EMPTY_MOOD);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<'input' | 'done' | 'skipped'>(() => {
    // 이미 건너뛴 세션이면 다시 묻지 않는다(새로고침 포함). 세션별로 독립 판정한다.
    return isSessionSkipped(sessionId) ? 'skipped' : 'input';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // MB2-07: 세션(라우트)이 바뀌면 이전 세션의 스킵/완료 상태를 새 세션에 이월하지 않는다.
  // 컴포넌트가 재사용돼도 새 세션 기준으로 다시 판정한다(초기값은 lazy init 과 동일해 깜빡임 없음).
  useEffect(() => {
    setPhase(isSessionSkipped(sessionId) ? 'skipped' : 'input');
  }, [sessionId]);

  const trimmedNote = note.trim();
  const hasValue = hasMoodValue(after);

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
      setError('수업 후 느낌을 최소 한 항목 선택해 주세요.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await postPhase('after', after);
      setPhase('done');
      onSubmitted?.();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = (): void => {
    markSessionSkipped(sessionId);
    setPhase('skipped');
  };

  // 스킵·완료 모두 카드 없이 숨긴다 — 종료 화면의 '수업이 종료되었습니다' 안내만 남긴다.
  if (phase === 'skipped' || phase === 'done') return null;

  return (
    <section
      data-testid="self-checkin"
      className="mx-auto mt-8 max-w-md rounded-2xl border border-[color:var(--mb-border,#E8D9EF)] bg-white p-5 text-left"
    >
      <h2 className="text-base font-bold text-[color:var(--mb-label-70)]">오늘 수업 이후 어떠신가요?</h2>
      <p className="mt-1 text-sm leading-6 text-[color:var(--mb-fg-muted)]">
        뇌파를 측정하지 않아도 이 기록은 리포트에 남습니다.
      </p>

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
