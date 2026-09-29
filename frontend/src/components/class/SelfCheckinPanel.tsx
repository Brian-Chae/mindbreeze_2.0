// SDD-096 — 세션 직후 1탭 셀프 체크인 패널 (SAM 2축 5단계 + 선택형 한 줄 소감)
//
// 문제: 리포트에 EEG 객관 지표만 있어 밴드 미착용 회원은 남는 기록이 거의 없다.
// 해결: 종료 화면에서 각성·정서 2축을 1탭씩 남기게 하고, 선택형 소감·수업 전 예상을
//       함께 저장해 리포트의 '수업 전 예상 ↔ 수업 후' 대비로 연계한다. 스킵 가능.

import { useMemo, useState } from 'react';
import { ApiError } from '../../lib/api/client';
import {
  CHECKIN_SKIP_STORAGE_KEY,
  SAM_AXES,
  SAM_VALUES,
  buildSubjectiveComparison,
  parseSubjectiveState,
  submitCheckin,
  type CheckinPhase,
  type SamValue,
  type SubjectiveStateDto,
} from '../../lib/api/checkin';

interface SelfCheckinPanelProps {
  sessionId: string;
  participantId: string | null;
  participantToken: string | null;
  /** 로그인 회원이면 액세스 토큰으로 본인 확인, 게스트면 participant_token 소유 증명 */
  isLoggedIn: boolean;
  /** EEG 두뇌휴식도 — 밴드 미착용이면 null(주관 값만 병기) */
  relaxationIndex?: number | null;
  /** 체크인 완료 통지 — 종료 화면이 완료 상태를 유지/안내하는 데 쓴다 */
  onSubmitted?: (state: SubjectiveStateDto) => void;
}

interface AxisPickerProps {
  axisKey: 'arousal' | 'valence';
  value: SamValue | null;
  onChange: (next: SamValue) => void;
  idPrefix: string;
  disabled?: boolean;
  /** 같은 축이 두 시점(수업 전/후)에 나타나므로 접근성 라벨을 구분한다 */
  ariaLabelPrefix?: string;
}

function AxisPicker({
  axisKey,
  value,
  onChange,
  idPrefix,
  disabled,
  ariaLabelPrefix = '',
}: AxisPickerProps) {
  const axis = SAM_AXES.find((item) => item.key === axisKey);
  if (!axis) return null;
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-bold text-[color:var(--mb-label-70)]">{axis.label}</legend>
      {/* 좁은 화면(<360px)에서는 3+2 두 줄, 넓은 화면에서는 5단계 한 줄로 배치한다 */}
      <div className="mt-2 grid grid-cols-3 gap-1.5 min-[360px]:grid-cols-5 min-[360px]:gap-2">
        {SAM_VALUES.map((step) => {
          const selected = value === step;
          return (
            <button
              key={step}
              type="button"
              id={`${idPrefix}-${axisKey}-${step}`}
              aria-pressed={selected}
              aria-label={`${ariaLabelPrefix}${axis.label} ${step}단계 ${axis.steps[step]}`}
              disabled={disabled}
              onClick={() => onChange(step)}
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
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '클래스 참여 확인에 실패해 체크인을 저장하지 못했습니다.';
    if (error.status === 409) return '종료된 클래스에서만 체크인할 수 있습니다.';
    if (error.status === 422) return '체크인 값을 다시 확인해 주세요.';
    if (error.message) return error.message;
  }
  return '체크인 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

export function SelfCheckinPanel({
  sessionId,
  participantId,
  participantToken,
  isLoggedIn,
  relaxationIndex = null,
  onSubmitted,
}: SelfCheckinPanelProps) {
  const [arousal, setArousal] = useState<SamValue | null>(null);
  const [valence, setValence] = useState<SamValue | null>(null);
  const [note, setNote] = useState('');
  const [showBefore, setShowBefore] = useState(false);
  const [beforeArousal, setBeforeArousal] = useState<SamValue | null>(null);
  const [beforeValence, setBeforeValence] = useState<SamValue | null>(null);
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
  const [saved, setSaved] = useState<SubjectiveStateDto | null>(null);

  const trimmedNote = note.trim();
  const hasAfterValue = arousal !== null || valence !== null;
  const hasBeforeValue = beforeArousal !== null || beforeValence !== null;
  const comparison = useMemo(
    () => buildSubjectiveComparison(saved?.before ?? null, saved?.after ?? null),
    [saved],
  );

  const postPhase = async (target: CheckinPhase): Promise<SubjectiveStateDto | null> => {
    const res = await submitCheckin(
      sessionId,
      {
        phase: target,
        arousal: target === 'after' ? arousal : beforeArousal,
        valence: target === 'after' ? valence : beforeValence,
        note: target === 'after' ? (trimmedNote || null) : null,
        participant_id: participantId,
        participant_token: isLoggedIn ? null : participantToken,
      },
      { skipAuth: !isLoggedIn },
    );
    return parseSubjectiveState(res.subjective_state);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!hasAfterValue) {
      setError('지금 느낌을 각성·정서 중 최소 한 축 선택해 주세요.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const afterState = await postPhase('after');
      // 수업 전 예상은 선택 — 남겼을 때만 추가 저장해 '예상 ↔ 결과' 대비를 만든다.
      if (hasBeforeValue) {
        await postPhase('before');
      }
      const merged: SubjectiveStateDto = {
        scope: 'participant',
        before: hasBeforeValue
          ? {
              arousal: beforeArousal,
              valence: beforeValence,
              note: null,
              recorded_at: afterState?.before?.recorded_at ?? null,
            }
          : null,
        after: afterState?.after ?? {
          arousal,
          valence,
          note: trimmedNote || null,
          recorded_at: null,
        },
      };
      setSaved(merged);
      setPhase('done');
      onSubmitted?.(merged);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = (): void => {
    // 스킵은 존중한다 — 이 브라우저에서 다시 묻지 않도록 기록만 남긴다.
    try {
      window.localStorage.setItem(CHECKIN_SKIP_STORAGE_KEY, sessionId);
    } catch {
      // localStorage 미가용(사생활 보호 모드) — 이번 세션에서만 숨긴다.
    }
    setPhase('skipped');
  };

  if (phase === 'skipped') return null;

  if (phase === 'done') {
    return (
      <section
        data-testid="self-checkin-done"
        className="mx-auto mt-8 max-w-md rounded-2xl border border-[color:var(--mb-border,#E8D9EF)] bg-white p-5 text-left"
      >
        <h2 className="text-base font-bold text-[color:var(--mb-label-70)]">체크인을 남겼어요</h2>
        <p className="mt-2 text-sm leading-6 text-[color:var(--mb-fg-muted)]">
          {comparison.hasBefore
            ? comparison.summary
            : saved?.after?.arousal != null || saved?.after?.valence != null
              ? `수업 후 · 각성 ${saved?.after?.arousal ?? '-'} · 정서 ${saved?.after?.valence ?? '-'}`
              : '수업 후 느낌을 기록했습니다.'}
        </p>
        {saved?.after?.note && (
          <p className="mt-2 rounded-xl bg-[color:var(--mb-purple-cream,#F5EDFC)] px-4 py-3 text-sm text-[color:var(--mb-label-70)]">
            “{saved.after.note}”
          </p>
        )}
        <p className="mt-3 text-xs leading-5 text-[color:var(--mb-fg-muted)]">
          {relaxationIndex !== null
            ? `두뇌휴식도 ${relaxationIndex} 와 함께 리포트에 표시됩니다.`
            : 'LINK BAND 미착용 세션이라 주관 기록만 리포트에 표시됩니다.'}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="self-checkin"
      className="mx-auto mt-8 max-w-md rounded-2xl border border-[color:var(--mb-border,#E8D9EF)] bg-white p-5 text-left"
    >
      <h2 className="text-base font-bold text-[color:var(--mb-label-70)]">지금 어떤가요?</h2>
      <p className="mt-1 text-sm leading-6 text-[color:var(--mb-fg-muted)]">
        한 번만 눌러 주세요. 뇌파를 측정하지 않아도 이 기록은 리포트에 남습니다.
      </p>

      <AxisPicker
        axisKey="arousal"
        value={arousal}
        onChange={setArousal}
        idPrefix="checkin"
        disabled={isSubmitting}
      />
      <AxisPicker
        axisKey="valence"
        value={valence}
        onChange={setValence}
        idPrefix="checkin"
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

      <button
        type="button"
        onClick={() => setShowBefore((prev) => !prev)}
        aria-expanded={showBefore}
        disabled={isSubmitting}
        className="mt-4 text-xs font-semibold text-[color:var(--mb-fg-muted)] underline"
      >
        {showBefore ? '수업 전 예상 접기' : '수업 전 예상도 남기기 (선택)'}
      </button>

      {showBefore && (
        <div data-testid="checkin-before" className="mt-2 rounded-xl bg-[color:var(--mb-purple-cream,#F5EDFC)] p-4">
          <p className="text-xs leading-5 text-[color:var(--mb-fg-muted)]">
            수업 전에 기대한 느낌을 함께 남기면 리포트에서 ‘수업 전 예상 ↔ 수업 후’를 비교해 볼 수 있어요.
          </p>
          <AxisPicker
            axisKey="arousal"
            value={beforeArousal}
            onChange={setBeforeArousal}
            idPrefix="checkin-before"
            ariaLabelPrefix="수업 전 "
            disabled={isSubmitting}
          />
          <AxisPicker
            axisKey="valence"
            value={beforeValence}
            onChange={setBeforeValence}
            idPrefix="checkin-before"
            ariaLabelPrefix="수업 전 "
            disabled={isSubmitting}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || !hasAfterValue}
          className="mb-btn h-[48px] flex-1 justify-center rounded-xl px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? '저장 중...' : '체크인 남기기'}
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
